import { NextFunction, Request, Response } from 'express';
import { TokenPayload, verifyToken } from '../lib/jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: TokenPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Admin/Ops or Driver — any authenticated staff user (not a guest token).
export function requireStaff(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.kind !== 'user') {
    res.status(403).json({ error: 'Staff access only' });
    return;
  }
  next();
}

export function requireRole(role: 'ADMIN' | 'DRIVER') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.kind !== 'user' || req.auth.role !== role) {
      res.status(403).json({ error: `${role} role required` });
      return;
    }
    next();
  };
}

export function requireGuest(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.kind !== 'guest') {
    res.status(403).json({ error: 'Guest access only' });
    return;
  }
  next();
}

// A driver may only ever act on their own resources — never trusts a
// client-supplied driverId, always compares against the token's driverId.
export function ownDriverId(req: Request): string {
  if (req.auth?.kind !== 'user' || req.auth.role !== 'DRIVER' || !req.auth.driverId) {
    throw new Error('ownDriverId called outside a driver-authenticated request');
  }
  return req.auth.driverId;
}
