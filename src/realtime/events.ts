import { getIo } from './io';

export function emitOpsRefresh() {
  getIo().to('ops:all').emit('ops:refresh');
}

export function emitTripChanged(params: { driverId: string; guestIds: string[] }) {
  const io = getIo();
  io.to('ops:all').emit('trip:changed');
  io.to(`driver:${params.driverId}`).emit('trip:changed');
  for (const guestId of params.guestIds) {
    io.to(`guest:${guestId}`).emit('trip:changed');
  }
}

export function emitDriverLocation(params: {
  driverId: string;
  lat: number;
  lng: number;
  guestIds: string[];
  etaSeconds?: number;
  distanceMeters?: number;
}) {
  const io = getIo();
  const payload = {
    driverId: params.driverId,
    lat: params.lat,
    lng: params.lng,
    at: new Date().toISOString(),
    etaSeconds: params.etaSeconds,
    distanceMeters: params.distanceMeters,
  };
  io.to('ops:all').emit('driver:location', payload);
  for (const guestId of params.guestIds) {
    io.to(`guest:${guestId}`).emit('driver:location', payload);
  }
}
