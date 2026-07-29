import { prisma } from '../lib/prisma';
import { solveBatch, type MatcherStop } from '../lib/matcher';
import { createTripRecord, type StopInput } from './tripAssignment';
import { tryDetourInsert } from './detourEngine';

const MIN_BREAK_MS = 10 * 60 * 1000;

export type MatchingRoundResult = {
  createdTrips: Awaited<ReturnType<typeof createTripRecord>>[];
  detourInsertions: { guestId: string; tripId: string }[];
  matchedGuestIds: string[];
  unassignedGuestIds: string[];
  message?: string;
};

export async function runMatchingRound(): Promise<MatchingRoundResult> {
  const allGuests = await prisma.guest.findMany({
    where: { status: { in: ['UNSCHEDULED', 'QUEUED'] } },
    include: { origin: true, destination: true },
  });

  if (allGuests.length === 0) {
    return {
      createdTrips: [],
      detourInsertions: [],
      matchedGuestIds: [],
      unassignedGuestIds: [],
      message: 'No unassigned guests to match.',
    };
  }

  const detourInsertions: { guestId: string; tripId: string }[] = [];
  const guests: typeof allGuests = [];
  for (const guest of allGuests) {
    const tripId = await tryDetourInsert({
      id: guest.id,
      groupSize: guest.groupSize,
      luggageUnits: guest.luggageUnits,
      originId: guest.originId,
      destinationId: guest.destinationId,
      origin: { lat: guest.origin.lat, lng: guest.origin.lng },
      destination: { lat: guest.destination.lat, lng: guest.destination.lng },
    });
    if (tripId) {
      detourInsertions.push({ guestId: guest.id, tripId });
    } else {
      guests.push(guest);
    }
  }

  const allAvailableDrivers = await prisma.driver.findMany({
    where: { status: 'AVAILABLE', currentLat: { not: null }, currentLng: { not: null } },
    include: { vehicle: true },
  });

  // Break-time: minimum break 
  const now = Date.now();
  const restedDrivers = allAvailableDrivers.filter(
    (d) => !d.predictedFreeAt || now - d.predictedFreeAt.getTime() >= MIN_BREAK_MS,
  );
  const drivers = restedDrivers;

  const matchedFromDetours = detourInsertions.map((d) => d.guestId);

  if (guests.length === 0) {
    return {
      createdTrips: [],
      detourInsertions,
      matchedGuestIds: matchedFromDetours,
      unassignedGuestIds: [],
      message: detourInsertions.length > 0 ? `Matched ${detourInsertions.length} guest(s) via detour insertion.` : undefined,
    };
  }
  if (allAvailableDrivers.length === 0) {
    return {
      createdTrips: [],
      detourInsertions,
      matchedGuestIds: matchedFromDetours,
      unassignedGuestIds: guests.map((g) => g.id),
      message: 'No available drivers with a known location — nothing to match the rest against.',
    };
  }

  const guestsById = new Map(guests.map((g) => [g.id, g]));

  async function solveWithDrivers(driverList: typeof allAvailableDrivers) {
    return solveBatch(
      driverList.map((d) => ({
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
  }

  let { assignments, unassignedGuestIds } =
    drivers.length > 0
      ? await solveWithDrivers(drivers)
      : { assignments: [] as Awaited<ReturnType<typeof solveWithDrivers>>['assignments'], unassignedGuestIds: guests.map((g) => g.id) };

  if (unassignedGuestIds.length > 0 && drivers.length < allAvailableDrivers.length) {
    const escalated = await solveWithDrivers(allAvailableDrivers);
    if (escalated.unassignedGuestIds.length < unassignedGuestIds.length) {
      assignments = escalated.assignments;
      unassignedGuestIds = escalated.unassignedGuestIds;
    }
  }
//merge adjacent same-location stops into
  // one TripStop with multiple guests
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
  const matchedFromBatch: string[] = [];
  for (const assignment of assignments) {
    const stops = mergeStops(assignment.stops);
    const trip = await createTripRecord({
      driverId: assignment.vehicleId, // 1:1 driver:vehicle in this system — see cabbz-matcher/README
      stops,
      createdBy: 'engine',
    });
    createdTrips.push(trip);
    matchedFromBatch.push(...stops.flatMap((s) => s.guestIds));
  }

  return {
    createdTrips,
    detourInsertions,
    matchedGuestIds: [...matchedFromDetours, ...matchedFromBatch],
    unassignedGuestIds,
  };
}
