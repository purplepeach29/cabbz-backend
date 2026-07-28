import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { solveBatch, type MatcherStop } from '../lib/matcher';
import { createTripRecord, type StopInput } from '../services/tripAssignment';

// Admin-triggered batch round: gathers every currently unassigned/queued
// guest and every available, located driver, hands them to cabbz-matcher's
// OR-Tools VRPPD solver, and turns each returned route into a real Trip.
// This is the automated-assignment engine — driver/guest allocation itself
// is never a human decision here, only *when* a batch round runs is.
export async function runBatchMatch(_req: Request, res: Response) {
  const guests = await prisma.guest.findMany({
    where: { status: { in: ['UNSCHEDULED', 'QUEUED'] } },
    include: { origin: true, destination: true },
  });

  const drivers = await prisma.driver.findMany({
    where: { status: 'AVAILABLE', currentLat: { not: null }, currentLng: { not: null } },
    include: { vehicle: true },
  });

  if (guests.length === 0) {
    res.json({ createdTrips: [], unassignedGuestIds: [], message: 'No unassigned guests to match.' });
    return;
  }
  if (drivers.length === 0) {
    res.json({
      createdTrips: [],
      unassignedGuestIds: guests.map((g) => g.id),
      message: 'No available drivers with a known location — nothing to match against.',
    });
    return;
  }

  const guestsById = new Map(guests.map((g) => [g.id, g]));

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
    })),
  );

  // The solver returns one stop entry per guest even when several guests
  // share a pickup or drop-off — merge adjacent same-location stops into
  // one TripStop with multiple guests, matching how manual assignment
  // already models shared rides.
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
      driverId: assignment.vehicleId, // 1:1 driver:vehicle in this system — see cabbz-matcher/README
      stops: mergeStops(assignment.stops),
      createdBy: 'engine',
    });
    createdTrips.push(trip);
  }

  res.json({ createdTrips, unassignedGuestIds });
}
