import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { emitOpsRefresh } from '../realtime/events';

export async function listVehicles(_req: Request, res: Response) {
  const vehicles = await prisma.vehicle.findMany({
    include: { driver: { select: { id: true, name: true, status: true } } },
    orderBy: { plateNumber: 'asc' },
  });
  res.json(vehicles);
}

const createVehicleSchema = z.object({
  plateNumber: z.string().min(1),
  seatCapacity: z.number().int().positive(),
  luggageCapacity: z.number().int().nonnegative(),
});

export async function createVehicle(req: Request, res: Response) {
  const data = createVehicleSchema.parse(req.body);
  const vehicle = await prisma.vehicle.create({ data });
  emitOpsRefresh();
  res.status(201).json(vehicle);
}
