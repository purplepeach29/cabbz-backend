const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

export type Eta = { distanceMeters: number; durationSeconds: number };

type DistanceMatrixResponse = {
  error_message?: string;
  rows?: Array<{
    elements?: Array<{
      status: string;
      distance: { value: number };
      duration: { value: number };
      duration_in_traffic?: { value: number };
    }>;
  }>;
};

// departure_time=now + traffic_model gives a live-traffic-aware duration,
// not just the static distance — this is the one Maps call in the system
// that's genuinely live rather than cacheable.
export async function getEta(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<Eta | null> {
  if (!API_KEY) return null;

  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', `${origin.lat},${origin.lng}`);
  url.searchParams.set('destinations', `${destination.lat},${destination.lng}`);
  url.searchParams.set('departure_time', 'now');
  url.searchParams.set('traffic_model', 'best_guess');
  url.searchParams.set('key', API_KEY);

  const res = await fetch(url);
  const body = (await res.json()) as DistanceMatrixResponse;
  const element = body?.rows?.[0]?.elements?.[0];
  if (!res.ok || element?.status !== 'OK') {
    console.error('Distance Matrix request failed:', body?.error_message ?? element?.status ?? res.status);
    return null;
  }

  return {
    distanceMeters: element.distance.value,
    durationSeconds: (element.duration_in_traffic ?? element.duration).value,
  };
}

// Throttles how often a given key (e.g. per-driver) is allowed to trigger a
// fresh Maps call — this is what keeps location pings (every ~10s) from
// translating 1:1 into Distance Matrix calls, per the NFR on API cost.
const lastCallAt = new Map<string, number>();

export function shouldRefreshEta(key: string, minIntervalMs: number): boolean {
  const last = lastCallAt.get(key);
  const now = Date.now();
  if (last && now - last < minIntervalMs) return false;
  lastCallAt.set(key, now);
  return true;
}
