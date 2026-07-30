const MATCHER_URL = process.env.MATCHER_URL ?? 'http://localhost:6000';

export type MatcherVehicle = {
  id: string;
  seatCapacity: number;
  luggageCapacity: number;
  lat: number;
  lng: number;
};

export type MatcherGuest = {
  id: string;
  groupSize: number;
  luggageUnits: number;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  waitMinutes: number;
};

export type MatcherStop = {
  stopType: 'PICKUP' | 'DROPOFF';
  lat: number;
  lng: number;
  guestIds: string[];
};

export type MatcherAssignment = { vehicleId: string; stops: MatcherStop[] };

export type MatcherResult = { assignments: MatcherAssignment[]; unassignedGuestIds: string[] };

// Render's free tier spins cabbz-matcher down after ~15 min idle; the first
// request after that wakes it but can 502/503 for up to ~60s while it boots.
// Retry through that window instead of failing on the first hit.
const COLD_START_RETRY_DELAYS_MS = [5000, 10000, 15000, 20000];

export async function solveBatch(vehicles: MatcherVehicle[], guests: MatcherGuest[]): Promise<MatcherResult> {
  let lastStatus: number | undefined;
  for (const delay of [0, ...COLD_START_RETRY_DELAYS_MS]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    const res = await fetch(`${MATCHER_URL}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicles, guests }),
    });
    if (res.ok) return res.json() as Promise<MatcherResult>;

    lastStatus = res.status;
    if (res.status !== 502 && res.status !== 503) {
      throw new Error(`cabbz-matcher request failed (${res.status})`);
    }
  }
  throw new Error(`cabbz-matcher request failed (${lastStatus}) after retrying through cold start`);
}
