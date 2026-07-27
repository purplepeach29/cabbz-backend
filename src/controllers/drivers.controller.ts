import crypto from 'crypto';
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ownDriverId } from '../middleware/auth';

// Admin/Ops: full fleet view (status, location, current trip) — never exposed to drivers.
export async function listDrivers(_req: Request, res: Response) {
  const drivers = await prisma.driver.findMany({
    include: {
      vehicle: true,
      trips: {
        where: { status: { in: ['PROPOSED', 'ACCEPTED', 'IN_PROGRESS'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  });
  res.json(drivers);
}

const createDriverSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email(),
  vehicleId: z.string().min(1),
  password: z.string().min(6).optional(),
});

// Admin onboarding is manual: ops staff enters each pre-registered
// driver before the event. no driver self-signup flow.
export async function createDriver(req: Request, res: Response) {
  const data = createDriverSchema.parse(req.body);
  const password = data.password ?? crypto.randomBytes(6).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 10);

  const driver = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { role: 'DRIVER', email: data.email, passwordHash },
    });
    return tx.driver.create({
      data: {
        name: data.name,
        phone: data.phone,
        userId: user.id,
        vehicleId: data.vehicleId,
      },
      include: { vehicle: true },
    });
  });

  // Temporary password is returned once so ops can hand it to the driver out of band.
  res.status(201).json({ driver, temporaryPassword: password });
}

const updateDriverStatusSchema = z.object({
  status: z.enum(['OFFLINE', 'AVAILABLE', 'ASSIGNED', 'EN_ROUTE_PICKUP', 'EN_ROUTE_DROP', 'ON_BREAK']),
});

// Admin manual override (e.g. pulling a driver for a break, marking offline).
export async function updateDriverStatus(req: Request, res: Response) {
  const { status } = updateDriverStatusSchema.parse(req.body);
  const driver = await prisma.driver.update({
    where: { id: req.params.driverId },
    data: { status },
  });
  res.json(driver);
}

export async function getOwnDriverProfile(req: Request, res: Response) {
  const driver = await prisma.driver.findUniqueOrThrow({
    where: { id: ownDriverId(req) },
    include: { vehicle: true },
  });
  res.json(driver);
}

const locationPingSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

// Driver-role only, and always scoped to the token's own driverId — a driver
// can never write another driver's location.
export async function pingOwnLocation(req: Request, res: Response) {
  const { lat, lng } = locationPingSchema.parse(req.body);
  const driver = await prisma.driver.update({
    where: { id: ownDriverId(req) },
    data: { currentLat: lat, currentLng: lng, lastPingAt: new Date() },
  });
  res.json({ id: driver.id, currentLat: driver.currentLat, currentLng: driver.currentLng, lastPingAt: driver.lastPingAt });
}
