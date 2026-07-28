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
};

export type MatcherStop = {
  stopType: 'PICKUP' | 'DROPOFF';
  lat: number;
  lng: number;
  guestIds: string[];
};

export type MatcherAssignment = { vehicleId: string; stops: MatcherStop[] };

export type MatcherResult = { assignments: MatcherAssignment[]; unassignedGuestIds: string[] };

export async function solveBatch(vehicles: MatcherVehicle[], guests: MatcherGuest[]): Promise<MatcherResult> {
  const res = await fetch(`${MATCHER_URL}/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicles, guests }),
  });
  if (!res.ok) {
    throw new Error(`cabbz-matcher request failed (${res.status})`);
  }
  return res.json() as Promise<MatcherResult>;
}
