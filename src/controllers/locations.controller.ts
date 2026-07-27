import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

export async function listLocations(_req: Request, res: Response) {
  const locations = await prisma.location.findMany({ orderBy: { name: 'asc' } });
  res.json(locations);
}

const createLocationSchema = z.object({
  type: z.enum(['VENUE', 'ACCOMMODATION', 'AIRPORT', 'STATION']),
  name: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
});

export async function createLocation(req: Request, res: Response) {
  const data = createLocationSchema.parse(req.body);
  const location = await prisma.location.create({ data });
  res.status(201).json(location);
}
