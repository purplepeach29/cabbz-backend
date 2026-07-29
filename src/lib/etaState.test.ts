import { isDelayed } from './etaState';

// Real-traffic drift can't be forced deterministically in a test (it would
// require two genuinely different live Google Distance Matrix responses),
// so this verifies the threshold arithmetic directly instead
describe('isDelayed', () => {
  it('is not delayed when the live ETA roughly matches the committed baseline', () => {
    expect(isDelayed(600, 620)).toBe(false);
  });

  it('is delayed once live ETA exceeds 1.5x the committed baseline', () => {
    expect(isDelayed(600, 950)).toBe(true);
  });

  it('is delayed once the absolute gap exceeds 10 minutes, even if the ratio is under 1.5x', () => {
    // ratio here is only ~1.3x, but the absolute gap (700s) exceeds 600s.
    expect(isDelayed(2000, 2700)).toBe(true);
  });

  it('is not delayed when the live ETA improved (traffic cleared)', () => {
    expect(isDelayed(600, 300)).toBe(false);
  });
});
