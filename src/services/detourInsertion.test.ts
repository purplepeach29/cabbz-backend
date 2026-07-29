import { findBestInsertion, haversineMeters, type RemainingStop } from './detourInsertion';

const DRIVER = { lat: 12.9, lng: 77.6 };
const STOP_A = { lat: 12.91, lng: 77.6 }; // ~1.1km from driver
const STOP_B = { lat: 12.92, lng: 77.6 }; // ~1.1km further past A

describe('findBestInsertion', () => {
  it('finds a cheap insertion when the new guest sits almost exactly on the existing path', () => {
    const remaining: RemainingStop[] = [{ id: 's1', location: STOP_B, seatDemand: -1, luggageDemand: 0 }];
    const result = findBestInsertion(
      DRIVER,
      remaining,
      1,
      0,
      4,
      4,
      { seats: 1, luggage: 0, pickup: { lat: 12.905, lng: 77.6 }, dropoff: { lat: 12.915, lng: 77.6 } },
      5000,
    );
    expect(result).not.toBeNull();
    expect(result!.addedMeters).toBeLessThan(1000);
  });

  it('rejects a mid-route insertion into a full vehicle when the only feasible slot (after it empties) is capped out of reach', () => {
    const remaining: RemainingStop[] = [
      { id: 's1', location: STOP_A, seatDemand: 0, luggageDemand: 0 },
      { id: 's2', location: STOP_B, seatDemand: -4, luggageDemand: 0 }, // everyone drops off at the very end
    ];
    const farGuest = { seats: 1, luggage: 0, pickup: { lat: 20, lng: 90 }, dropoff: { lat: 20, lng: 90 } };
    expect(findBestInsertion(DRIVER, remaining, 4, 0, 4, 4, farGuest, 5000)).toBeNull();
  });

  it('allows appending a new guest once the vehicle empties out at the end of the route — same "sequential serving" property as the batch solver', () => {
    const remaining: RemainingStop[] = [
      { id: 's1', location: STOP_A, seatDemand: 0, luggageDemand: 0 },
      { id: 's2', location: STOP_B, seatDemand: -4, luggageDemand: 0 },
    ];
    const nearGuest = { seats: 1, luggage: 0, pickup: STOP_B, dropoff: STOP_B };
    const result = findBestInsertion(DRIVER, remaining, 4, 0, 4, 4, nearGuest, 5000);
    expect(result).not.toBeNull();
    expect(result!.pickupGap).toBe(2);
    expect(result!.dropoffGap).toBe(2);
  });

  it('only allows pickup after an earlier stop frees the seat the new guest needs', () => {
    const remaining: RemainingStop[] = [
      { id: 's1', location: STOP_A, seatDemand: -1, luggageDemand: 0 }, // frees a seat here
      { id: 's2', location: STOP_B, seatDemand: -3, luggageDemand: 0 },
    ];
    const result = findBestInsertion(
      DRIVER,
      remaining,
      4, // full until s1
      0,
      4,
      4,
      { seats: 1, luggage: 0, pickup: STOP_A, dropoff: STOP_B },
      50000,
    );
    expect(result).not.toBeNull();
    expect(result!.pickupGap).toBeGreaterThanOrEqual(1);
  });

  it('rejects an otherwise-feasible detour that exceeds the max-detour distance cap', () => {
    const remaining: RemainingStop[] = [{ id: 's1', location: STOP_B, seatDemand: -1, luggageDemand: 0 }];
    const farAway = { lat: 13.5, lng: 78.5 };
    const result = findBestInsertion(
      DRIVER,
      remaining,
      1,
      0,
      4,
      4,
      { seats: 1, luggage: 0, pickup: farAway, dropoff: farAway },
      5000,
    );
    expect(result).toBeNull();
  });

  it('prefers the cheaper on-path option over a far detour when both are technically feasible', () => {
    const onPath = { lat: 12.905, lng: 77.6 };
    const offPath = { lat: 12.905, lng: 78.0 };
    const remaining: RemainingStop[] = [
      { id: 's1', location: STOP_A, seatDemand: -1, luggageDemand: 0 },
      { id: 's2', location: STOP_B, seatDemand: 0, luggageDemand: 0 },
    ];
    const result = findBestInsertion(DRIVER, remaining, 0, 0, 4, 4, { seats: 1, luggage: 0, pickup: onPath, dropoff: STOP_A }, 200000);
    expect(result).not.toBeNull();
    const naiveFarCost = haversineMeters(DRIVER, offPath) * 2;
    expect(result!.addedMeters).toBeLessThan(naiveFarCost);
  });
});
