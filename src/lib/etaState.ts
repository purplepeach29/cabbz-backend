import type { Eta } from './googleMaps';

export const lastKnownEta = new Map<string, Eta>();

export const committedEta = new Map<string, number>();

const DELAY_RATIO_THRESHOLD = 1.5; // 50% worse than committed
const DELAY_ABSOLUTE_THRESHOLD_SECONDS = 600; // or 10 minutes worse, whichever trips first

export function isDelayed(committedSeconds: number, liveSeconds: number): boolean {
  return liveSeconds > committedSeconds * DELAY_RATIO_THRESHOLD || liveSeconds - committedSeconds > DELAY_ABSOLUTE_THRESHOLD_SECONDS;
}

export function clearEtaState(driverId: string) {
  lastKnownEta.delete(driverId);
  committedEta.delete(driverId);
}
