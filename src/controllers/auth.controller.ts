import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/jwt';

const staffLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function staffLogin(req: Request, res: Response) {
  const { email, password } = staffLoginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email }, include: { driver: true } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const token = signToken(
    user.role === 'DRIVER'
      ? { kind: 'user', sub: user.id, role: 'DRIVER', driverId: user.driver!.id }
      : { kind: 'user', sub: user.id, role: 'ADMIN' },
  );

  res.json({ token, role: user.role });
}

const guestLoginSchema = z.object({
  inviteCode: z.string().min(1),
});

export async function guestLogin(req: Request, res: Response) {
  const { inviteCode } = guestLoginSchema.parse(req.body);

  const guest = await prisma.guest.findUnique({ where: { inviteCode } });
  if (!guest) {
    res.status(401).json({ error: 'Invalid invite code' });
    return;
  }

  const token = signToken({ kind: 'guest', sub: guest.id });
  res.json({ token });
}
