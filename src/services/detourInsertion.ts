// Opportunistic detour insertion: can a driver already en route pick up/drop
// an additional guest along the way? This is the "lightweight greedy match"
// half of the matching engine (the OR-Tools batch solver in cabbz-matcher is
// the other half) — a classic cheapest-insertion heuristic, not a full
// re-optimization, so it's fast enough to run inline on every unmatched
// guest without a second service hop.
//
// Deliberately pure/DB-free so the geometry and capacity logic can be
// tested directly (see detourInsertion.test.ts) without touching Postgres —
// this is exactly the kind of off-by-one-prone code worth verifying in
// isolation before wiring it to anything live. The DB-wiring half lives in
// detourEngine.ts.

export type Point = { lat: number; lng: number };

export type RemainingStop = {
  id: string;
  location: Point;
  seatDemand: number;
  luggageDemand: number;
};

export type NewGuestDetour = {
  seats: number;
  luggage: number;
  pickup: Point;
  dropoff: Point;
};

export type InsertionResult = {
  pickupGap: number; 
  dropoffGap: number; 
  addedMeters: number;
};

export function haversineMeters(a: Point, b: Point): number {
  const R = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

// Cost of splicing a single point into the gap between `before` and `after`
// (after null means appending at the open end of the route — no
// existing arc to remove, so no subtraction term).
function insertionCost(before: Point, after: Point | null, point: Point): number {
  if (!after) return haversineMeters(before, point);
  return haversineMeters(before, point) + haversineMeters(point, after) - haversineMeters(before, after);
}

export function findBestInsertion(
  driverPosition: Point,
  remainingStops: RemainingStop[],
  onboardSeats: number,
  onboardLuggage: number,
  seatCapacity: number,
  luggageCapacity: number,
  newGuest: NewGuestDetour,
  maxDetourMeters: number,
): InsertionResult | null {
  const n = remainingStops.length;
  const points: Point[] = [driverPosition, ...remainingStops.map((s) => s.location)];

  const loadSeatsBefore = [onboardSeats];
  const loadLuggageBefore = [onboardLuggage];
  for (let k = 0; k < n; k++) {
    loadSeatsBefore.push(loadSeatsBefore[k] + remainingStops[k].seatDemand);
    loadLuggageBefore.push(loadLuggageBefore[k] + remainingStops[k].luggageDemand);
  }

  let best: InsertionResult | null = null;

  for (let p = 0; p <= n; p++) {
    for (let d = p; d <= n; d++) {
      let feasible = true;
      for (let k = p; k <= d; k++) {
        if (
          loadSeatsBefore[k] + newGuest.seats > seatCapacity ||
          loadLuggageBefore[k] + newGuest.luggage > luggageCapacity
        ) {
          feasible = false;
          break;
        }
      }
      if (!feasible) continue;

      let addedMeters: number;
      if (p === d) {
        // Both new stops land in the same gap, back to back.
        const before = points[p];
        const after = p < n ? points[p + 1] : null;
        addedMeters =
          haversineMeters(before, newGuest.pickup) +
          haversineMeters(newGuest.pickup, newGuest.dropoff) +
          (after ? haversineMeters(newGuest.dropoff, after) - haversineMeters(before, after) : 0);
      } else {
        const pickupCost = insertionCost(points[p], points[p + 1], newGuest.pickup);
        const dropoffBefore = points[d];
        const dropoffAfter = d < n ? points[d + 1] : null;
        addedMeters = pickupCost + insertionCost(dropoffBefore, dropoffAfter, newGuest.dropoff);
      }

      if (addedMeters > maxDetourMeters) continue;
      if (!best || addedMeters < best.addedMeters) {
        best = { pickupGap: p, dropoffGap: d, addedMeters };
      }
    }
  }

  return best;
}
