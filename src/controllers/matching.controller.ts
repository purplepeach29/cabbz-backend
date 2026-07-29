import { Request, Response } from 'express';
import { runMatchingRound } from '../services/matchingRound';

// Admin triggers a batch round — the resulting driver-to-guest
// allocation is matching engine's decision, not admin's.
export async function runBatchMatch(_req: Request, res: Response) {
  const result = await runMatchingRound();
  res.json(result);
}
