import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { runBatchMatch } from '../controllers/matching.controller';

export const matchingRouter = Router();

// Admin/Ops triggers a batch round — the resulting driver-to-guest
// allocation is entirely the matching engine's decision, not admin's.
matchingRouter.post('/run-batch', authenticate, requireRole('ADMIN'), asyncHandler(runBatchMatch));
