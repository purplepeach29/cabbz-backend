import { prisma } from '../lib/prisma';
import { solveBatch, type MatcherStop } from '../lib/matcher';
import { createTripRecord, type StopInput } from './tripAssignment';

export type MatchingRoundResult = {
  createdTrips: Awaited<ReturnType<typeof createTripRecord>>[];
  unassignedGuestIds: string[];
  message?: string;
};

export async function runMatchingRound(): Promise<MatchingRoundResult> {
  const guests = await prisma.guest.findMany({
    where: { status: { in: ['UNSCHEDULED', 'QUEUED'] } },
    include: { origin: true, destination: true },
  });

  const drivers = await prisma.driver.findMany({
    where: { status: 'AVAILABLE', currentLat: { not: null }, currentLng: { not: null } },
    include: { vehicle: true },
  });

  if (guests.length === 0) {
    return { createdTrips: [], unassignedGuestIds: [], message: 'No unassigned guests to match.' };
  }
  if (drivers.length === 0) {
    return {
      createdTrips: [],
      unassignedGuestIds: guests.map((g) => g.id),
      message: 'No available drivers with a known location — nothing to match against.',
    };
  }

  const guestsById = new Map(guests.map((g) => [g.id, g]));
  const now = Date.now();

  const { assignments, unassignedGuestIds } = await solveBatch(
    drivers.map((d) => ({
      id: d.id,
      seatCapacity: d.vehicle.seatCapacity,
      luggageCapacity: d.vehicle.luggageCapacity,
      lat: d.currentLat!,
      lng: d.currentLng!,
    })),
    guests.map((g) => ({
      id: g.id,
      groupSize: g.groupSize,
      luggageUnits: g.luggageUnits,
      originLat: g.origin.lat,
      originLng: g.origin.lng,
      destinationLat: g.destination.lat,
      destinationLng: g.destination.lng,
      
      waitMinutes: (now - (g.queuedSince ?? g.createdAt).getTime()) / 60_000,
    })),
  );
  
  //merge adjacent same-location stops into// one TripStop with multiple guests
  
  function mergeStops(stops: MatcherStop[]): StopInput[] {
    const merged: StopInput[] = [];
    for (const s of stops) {
      const guest = guestsById.get(s.guestIds[0])!;
      const locationId = s.stopType === 'PICKUP' ? guest.originId : guest.destinationId;
      const last = merged[merged.length - 1];
      if (last && last.stopType === s.stopType && last.locationId === locationId) {
        last.guestIds.push(...s.guestIds);
      } else {
        merged.push({ sequenceIndex: merged.length, stopType: s.stopType, locationId, guestIds: [...s.guestIds] });
      }
    }
    return merged.map((s, i) => ({ ...s, sequenceIndex: i }));
  }

  const createdTrips = [];
  for (const assignment of assignments) {
    const trip = await createTripRecord({
      driverId: assignment.vehicleId, 
      stops: mergeStops(assignment.stops),
      createdBy: 'engine',
    });
    createdTrips.push(trip);
  }

  return { createdTrips, unassignedGuestIds };
}
