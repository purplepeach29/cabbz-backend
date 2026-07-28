import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ownDriverId } from '../middleware/auth';
import { emitTripChanged } from '../realtime/events';
import { createTripRecord, tripInclude } from '../services/tripAssignment';

// Admin/Ops: visibility into all upcoming/in-progress trips.
export async function listTrips(_req: Request, res: Response) {
  const trips = await prisma.trip.findMany({
    include: tripInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json(trips);
}

const createTripSchema = z.object({
  driverId: z.string().min(1),
  stops: z
    .array(
      z.object({
        sequenceIndex: z.number().int().nonnegative(),
        stopType: z.enum(['PICKUP', 'DROPOFF']),
        locationId: z.string().min(1),
        guestIds: z.array(z.string().min(1)).min(1),
        eta: z.coerce.date().optional(),
      }),
    )
    .min(1),
});

// Manual trip assignment (admin picks driver + stops directly)
export async function createTrip(req: Request, res: Response) {
  const data = createTripSchema.parse(req.body);

  const driver = await prisma.driver.findUniqueOrThrow({
    where: { id: data.driverId },
    include: { vehicle: true },
  });

  const guestIds = [...new Set(data.stops.flatMap((s) => s.guestIds))];
  const guests = await prisma.guest.findMany({ where: { id: { in: guestIds } } });
  if (guests.length !== guestIds.length) {
    res.status(400).json({ error: 'One or more guestIds do not exist' });
    return;
  }

  const totalSeats = guests.reduce((sum, g) => sum + g.groupSize, 0);
  const totalLuggage = guests.reduce((sum, g) => sum + g.luggageUnits, 0);
  if (totalSeats > driver.vehicle.seatCapacity || totalLuggage > driver.vehicle.luggageCapacity) {
    res.status(400).json({
      error: 'Assignment exceeds vehicle capacity',
      details: {
        seats: { required: totalSeats, available: driver.vehicle.seatCapacity },
        luggage: { required: totalLuggage, available: driver.vehicle.luggageCapacity },
      },
    });
    return;
  }

  const trip = await createTripRecord({ driverId: data.driverId, stops: data.stops, createdBy: 'admin' });
  res.status(201).json(trip);
}

// Driver-role only, and always scoped server-side to the caller's own
// driverId — never trusts a client-supplied id.
export async function getOwnCurrentTrip(req: Request, res: Response) {
  const trip = await prisma.trip.findFirst({
    where: { driverId: ownDriverId(req), status: { in: ['PROPOSED', 'ACCEPTED', 'IN_PROGRESS'] } },
    include: tripInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json(trip ?? null);
}

const respondSchema = z.object({ action: z.enum(['accept', 'reject']) });

async function assertOwnsTrip(tripId: string, driverId: string) {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  if (trip.driverId !== driverId) {
    const err = new Error('Trip does not belong to this driver');
    (err as { statusCode?: number }).statusCode = 403;
    throw err;
  }
  return trip;
}

// Driver accepts or rejects the one trip they were assigned. Reject re-queues
// every guest on the trip for reassignment (aging clock starts now).
export async function respondToTrip(req: Request, res: Response) {
  const driverId = ownDriverId(req);
  const { action } = respondSchema.parse(req.body);
  const trip = await assertOwnsTrip(req.params.tripId, driverId);

  if (trip.status !== 'PROPOSED') {
    res.status(409).json({ error: `Trip is already ${trip.status}` });
    return;
  }

  const stops = await prisma.tripStop.findMany({
    where: { tripId: trip.id },
    include: { guests: true },
  });
  const guestIds = [...new Set(stops.flatMap((s) => s.guests.map((g) => g.id)))];

  if (action === 'accept') {
    const updated = await prisma.trip.update({
      where: { id: trip.id },
      data: { status: 'ACCEPTED' },
      include: tripInclude,
    });
    await prisma.driver.update({ where: { id: driverId }, data: { status: 'EN_ROUTE_PICKUP' } });
    emitTripChanged({ driverId, guestIds });
    res.json(updated);
    return;
  }

  const [updated] = await prisma.$transaction([
    prisma.trip.update({ where: { id: trip.id }, data: { status: 'REJECTED' }, include: tripInclude }),
    prisma.guest.updateMany({
      where: { id: { in: guestIds } },
      data: { status: 'QUEUED', queuedSince: new Date() },
    }),
    prisma.driver.update({ where: { id: driverId }, data: { status: 'AVAILABLE' } }),
  ]);

  emitTripChanged({ driverId, guestIds });
  res.json(updated);
}

const stopActionSchema = z.object({ action: z.enum(['arrived', 'boarded']) });

async function completeStop(tripId: string, stop: { id: string; sequenceIndex: number }, driverId: string) {
  const allStops = await prisma.tripStop.findMany({ where: { tripId }, orderBy: { sequenceIndex: 'asc' } });
  const isLastStop = stop.sequenceIndex === allStops[allStops.length - 1].sequenceIndex;

  await prisma.tripStop.update({ where: { id: stop.id }, data: { status: 'COMPLETED' } });
  if (isLastStop) {
    await prisma.trip.update({ where: { id: tripId }, data: { status: 'COMPLETED' } });
    await prisma.driver.update({ where: { id: driverId }, data: { status: 'AVAILABLE', predictedFreeAt: new Date() } });
  } else {
    await prisma.driver.update({ where: { id: driverId }, data: { status: 'EN_ROUTE_PICKUP' } });
  }
}

// Driver progresses through their trip's stops one action at a time. These
// timestamps are what later phases use to compute halt time / free time.
//
// Only two actions exist, matching the pickup/drop lifecycle directly:
// - "arrived": driver reached the stop. For a DROPOFF this also completes the
//   stop immediately (guests are simply dropped off, no separate confirmation).
// - "boarded": PICKUP only — guest(s) are in the vehicle, which completes the
//   pickup stop and moves the driver toward the next leg.
export async function updateStopStatus(req: Request, res: Response) {
  const driverId = ownDriverId(req);
  const { action } = stopActionSchema.parse(req.body);
  const trip = await assertOwnsTrip(req.params.tripId, driverId);

  const stop = await prisma.tripStop.findUniqueOrThrow({
    where: { id: req.params.stopId },
    include: { guests: true },
  });
  if (stop.tripId !== trip.id) {
    res.status(400).json({ error: 'Stop does not belong to this trip' });
    return;
  }

  const stopGuestIds = stop.guests.map((g) => g.id);

  if (action === 'boarded') {
    if (stop.stopType !== 'PICKUP') {
      res.status(400).json({ error: '"boarded" only applies to pickup stops' });
      return;
    }
    await prisma.guest.updateMany({ where: { id: { in: stopGuestIds } }, data: { status: 'IN_TRANSIT' } });
    await completeStop(trip.id, stop, driverId);
  } else {
    await prisma.tripStop.update({ where: { id: stop.id }, data: { status: 'ARRIVED', actualArrivalAt: new Date() } });
    if (trip.status === 'ACCEPTED') {
      await prisma.trip.update({ where: { id: trip.id }, data: { status: 'IN_PROGRESS' } });
    }
    if (stop.stopType === 'DROPOFF') {
      await prisma.guest.updateMany({ where: { id: { in: stopGuestIds } }, data: { status: 'COMPLETED' } });
      await completeStop(trip.id, stop, driverId);
    }
  }

  const updatedTrip = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id }, include: tripInclude });
  const allGuestIds = [...new Set(updatedTrip.stops.flatMap((s) => s.guests.map((g) => g.id)))];
  emitTripChanged({ driverId, guestIds: allGuestIds });
  res.json(updatedTrip);
}
