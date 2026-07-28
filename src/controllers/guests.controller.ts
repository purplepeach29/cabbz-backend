import crypto from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { emitOpsRefresh } from '../realtime/events';

// Admin/Ops: full guest queue (waiting, assigned, in transit).
export async function listGuests(_req: Request, res: Response) {
  const guests = await prisma.guest.findMany({
    include: { origin: true, destination: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(guests);
}

const createGuestSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  groupSize: z.number().int().positive().default(1),
  luggageUnits: z.number().int().nonnegative().default(0),
  tripType: z.enum(['ARRIVAL', 'TO_VENUE', 'FROM_VENUE', 'DEPARTURE', 'ON_DEMAND']),
  originId: z.string().min(1),
  originLabel: z.string().optional(),
  destinationId: z.string().min(1),
  pickupWindowStart: z.coerce.date().optional(),
  pickupWindowEnd: z.coerce.date().optional(),
  priorityTier: z.enum(['NORMAL', 'PRIORITY']).default('NORMAL'),
});

// Pre-registration by admin/ops ahead of the event (arrival/departure manifests,
// walk-ins). no guest self-registration.
export async function createGuest(req: Request, res: Response) {
  const data = createGuestSchema.parse(req.body);
  const inviteCode = crypto.randomBytes(4).toString('hex');
  const guest = await prisma.guest.create({
    data: { ...data, inviteCode },
    include: { origin: true, destination: true },
  });
  emitOpsRefresh();
  res.status(201).json(guest);
}

const updateGuestSchema = createGuestSchema.partial();

// Manual deviation logging: walk-in guests, changed flight/train details, etc.
export async function updateGuest(req: Request, res: Response) {
  const data = updateGuestSchema.parse(req.body);
  const guest = await prisma.guest.update({
    where: { id: req.params.guestId },
    data,
    include: { origin: true, destination: true },
  });
  emitOpsRefresh();
  res.json(guest);
}

// Guest-role only: guest can only ever see their own record, never the queue.
export async function getOwnGuestProfile(req: Request, res: Response) {
  const guest = await prisma.guest.findUniqueOrThrow({
    where: { id: req.auth!.sub },
    include: {
      origin: true,
      destination: true,
      tripStops: {
        include: {
          trip: { include: { driver: { include: { vehicle: true } } } },
          location: true,
        },
      },
    },
  });
  res.json(guest);
}


const pushTokenSchema = z.object({ token: z.string().min(1) });

export async function registerOwnPushToken(req: Request, res: Response) {
  const { token } = pushTokenSchema.parse(req.body);
  await prisma.guest.update({ where: { id: req.auth!.sub }, data: { pushToken: token } });
  res.status(204).end();
}
