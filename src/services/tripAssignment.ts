import { prisma } from '../lib/prisma';
import { emitTripChanged } from '../realtime/events';
import { sendPush } from '../realtime/push';

export const tripInclude = {
  driver: { include: { vehicle: true } },
  stops: {
    include: { location: true, guests: true },
    orderBy: { sequenceIndex: 'asc' as const },
  },
};

export type StopInput = {
  sequenceIndex: number;
  stopType: 'PICKUP' | 'DROPOFF';
  locationId: string;
  guestIds: string[];
  eta?: Date;
};

// Shared by manual admin assignment and the batch matching engine — creates
// the Trip + TripStops, flips guest/driver status, and fires the same
// realtime + push notifications regardless of who/what did the assigning.
// Capacity validation is the caller's responsibility: the two callers need
// different checks (a simple aggregate sum for ad-hoc manual assignment vs.
// trusting the VRP solver's own running-load capacity dimensions for
// engine-created trips, which can validly exceed a naive aggregate sum via
// sequential pickup/dropoff — see cabbz-matcher's test_solver.py scenario 4).
export async function createTripRecord(params: {
  driverId: string;
  stops: StopInput[];
  createdBy: 'admin' | 'engine';
}) {
  const guestIds = [...new Set(params.stops.flatMap((s) => s.guestIds))];

  const tripId = await prisma.$transaction(async (tx) => {
    const created = await tx.trip.create({
      data: {
        driverId: params.driverId,
        createdBy: params.createdBy,
        stops: {
          create: params.stops.map((s) => ({
            sequenceIndex: s.sequenceIndex,
            stopType: s.stopType,
            locationId: s.locationId,
            eta: s.eta,
            guests: { connect: s.guestIds.map((id) => ({ id })) },
          })),
        },
      },
    });

    await tx.guest.updateMany({ where: { id: { in: guestIds } }, data: { status: 'MATCHED' } });
    await tx.driver.update({ where: { id: params.driverId }, data: { status: 'ASSIGNED' } });

    return created.id;
  });

  // Re-fetched after the transaction commits so this reflects post-update
  // state, not a pre-update snapshot.
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude });

  emitTripChanged({ driverId: params.driverId, guestIds });

  const pickup = trip.stops.find((s) => s.stopType === 'PICKUP');
  const dropoff = trip.stops.find((s) => s.stopType === 'DROPOFF');
  await sendPush(trip.driver.pushToken, {
    title: 'New trip assigned',
    body: `Pick up at ${pickup?.location.name ?? 'pickup point'} → drop at ${dropoff?.location.name ?? 'destination'}`,
  });

  const guests = await prisma.guest.findMany({ where: { id: { in: guestIds } } });
  await Promise.all(
    guests.map((guest) =>
      sendPush(guest.pushToken, {
        title: "You've been matched with a driver",
        body: `${trip.driver.name} · ${trip.driver.vehicle.plateNumber}`,
      }),
    ),
  );

  return trip;
}
