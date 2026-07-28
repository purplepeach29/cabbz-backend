import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { verifyToken } from '../lib/jwt';
import { setIo } from './io';

// Room naming: driver:{id}, guest:{id}, ops:all — mirrors the REST RBAC
// boundary. A driver socket only ever joins its own driver room; it is never
// possible for a driver token to join ops:all or another driver's room,
// because room membership is derived from the verified JWT, not a
// client-supplied parameter.
export function initSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error('Missing auth token'));
      return;
    }
    try {
      socket.data.auth = verifyToken(token);
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const auth = socket.data.auth;
    if (auth.kind === 'guest') {
      socket.join(`guest:${auth.sub}`);
    } else if (auth.role === 'ADMIN') {
      socket.join('ops:all');
    } else if (auth.role === 'DRIVER' && auth.driverId) {
      socket.join(`driver:${auth.driverId}`);
    }
  });

  setIo(io);
  return io;
}
