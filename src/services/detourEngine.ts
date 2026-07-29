import { prisma } from '../lib/prisma';
import { emitTripChanged } from '../realtime/events';
import { sendPush } from '../realtime/push';
import { findBestInsertion, type RemainingStop } from './detourInsertion';

const MAX_DETOUR_METERS = 5000;

export type DetourGuest = {
  id: string;
  groupSize: number;
  luggageUnits: number;
  originId: string;
  destinationId: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
};

const activeTripInclude = {
  driver: { include: { vehicle: true } },
  stops: {
    include: { location: true, guests: true },
    orderBy: { sequenceIndex: 'asc' as const },
  },
};

// Tries to fit a guest into a trip that's already ACCEPTED or IN_PROGRESS
// this is what makes detour insertion apply to live trips using the
// driver's real-time position
export async function tryDetourInsert(guest: DetourGuest): Promise<string | null> {
  const trips = await prisma.trip.findMany({
    where: { status: { in: ['ACCEPTED', 'IN_PROGRESS'] } },
    include: activeTripInclude,
  });

  type Candidate = {
    tripId: string;
    driverId: string;
    firstRemainingIndex: number;
    pickupGap: number;
    dropoffGap: number;
    addedMeters: number;
  };
  let best: Candidate | null = null;

  for (const trip of trips) {
    if (guest.groupSize > trip.driver.vehicle.seatCapacity || guest.luggageUnits > trip.driver.vehicle.luggageCapacity) {
      continue; // can never fit regardless of route
    }
    if (trip.driver.currentLat == null || trip.driver.currentLng == null) continue;

    const firstRemainingIndex = trip.stops.findIndex((s) => s.status !== 'COMPLETED');
    if (firstRemainingIndex === -1) continue; // nothing left to attach to

    const remaining = trip.stops.slice(firstRemainingIndex);
    const remainingStops: RemainingStop[] = remaining.map((s) => ({
      id: s.id,
      location: { lat: s.location.lat, lng: s.location.lng },
      seatDemand: s.guests.reduce((sum, g) => sum + (s.stopType === 'PICKUP' ? g.groupSize : -g.groupSize), 0),
      luggageDemand: s.guests.reduce((sum, g) => sum + (s.stopType === 'PICKUP' ? g.luggageUnits : -g.luggageUnits), 0),
    }));

    const onboardGuestIds = new Set(
      trip.stops.flatMap((s) => s.guests).filter((g) => g.status === 'IN_TRANSIT').map((g) => g.id),
    );
    const onboard = trip.stops
      .flatMap((s) => s.guests)
      .filter((g, i, arr) => onboardGuestIds.has(g.id) && arr.findIndex((x) => x.id === g.id) === i);
    const onboardSeats = onboard.reduce((sum, g) => sum + g.groupSize, 0);
    const onboardLuggage = onboard.reduce((sum, g) => sum + g.luggageUnits, 0);

    const result = findBestInsertion(
      { lat: trip.driver.currentLat, lng: trip.driver.currentLng },
      remainingStops,
      onboardSeats,
      onboardLuggage,
      trip.driver.vehicle.seatCapacity,
      trip.driver.vehicle.luggageCapacity,
      { seats: guest.groupSize, luggage: guest.luggageUnits, pickup: guest.origin, dropoff: guest.destination },
      MAX_DETOUR_METERS,
    );
    if (!result) continue;
    if (!best || result.addedMeters < best.addedMeters) {
      best = {
        tripId: trip.id,
        driverId: trip.driverId,
        firstRemainingIndex,
        pickupGap: result.pickupGap,
        dropoffGap: result.dropoffGap,
        addedMeters: result.addedMeters,
      };
    }
  }

  if (!best) return null;

  const trip = trips.find((t) => t.id === best!.tripId)!;
  const pickupAbsIndex = best.firstRemainingIndex + best.pickupGap;
  const dropoffAbsIndex = best.firstRemainingIndex + best.dropoffGap;

  await prisma.$transaction(async (tx) => {
    
    for (let i = trip.stops.length - 1; i >= pickupAbsIndex; i--) {
      const shift = i < dropoffAbsIndex ? 1 : 2;
      await tx.tripStop.update({ where: { id: trip.stops[i].id }, data: { sequenceIndex: i + shift } });
    }
    await tx.tripStop.create({
      data: {
        tripId: trip.id,
        sequenceIndex: pickupAbsIndex,
        stopType: 'PICKUP',
        locationId: guest.originId,
        guests: { connect: { id: guest.id } },
      },
    });
    await tx.tripStop.create({
      data: {
        tripId: trip.id,
        sequenceIndex: dropoffAbsIndex + 1,
        stopType: 'DROPOFF',
        locationId: guest.destinationId,
        guests: { connect: { id: guest.id } },
      },
    });
    await tx.guest.update({ where: { id: guest.id }, data: { status: 'MATCHED' } });
  });

  emitTripChanged({ driverId: best.driverId, guestIds: [guest.id] });

  const driver = trip.driver;
  await sendPush(driver.pushToken, {
    title: 'Route updated',
    body: 'A stop was added to your current trip along the way.',
  });
  const guestRecord = await prisma.guest.findUnique({ where: { id: guest.id } });
  await sendPush(guestRecord?.pushToken, {
    title: "You've been matched with a driver",
    body: `${driver.name} · ${driver.vehicle.plateNumber}`,
  });

  return trip.id;
}
