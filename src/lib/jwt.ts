import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '12h';

export type UserTokenPayload = {
  kind: 'user';
  sub: string; // User.id
  role: 'ADMIN' | 'DRIVER';
  driverId?: string; // when role 'DRIVER'
};

export type GuestTokenPayload = {
  kind: 'guest';
  sub: string; // Guest.id
};

export type TokenPayload = UserTokenPayload | GuestTokenPayload;

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}
