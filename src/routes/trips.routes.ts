import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import {
  listTrips,
  createTrip,
  getOwnCurrentTrip,
  respondToTrip,
  updateStopStatus,
} from '../controllers/trips.controller';

export const tripsRouter = Router();

// Admin/Ops — full trip list, manual assignment.
tripsRouter.get('/', authenticate, requireRole('ADMIN'), asyncHandler(listTrips));
tripsRouter.post('/', authenticate, requireRole('ADMIN'), asyncHandler(createTrip));

// Driver — scoped to the caller's own current trip only.
tripsRouter.get('/me/current', authenticate, requireRole('DRIVER'), asyncHandler(getOwnCurrentTrip));
tripsRouter.post('/:tripId/respond', authenticate, requireRole('DRIVER'), asyncHandler(respondToTrip));
tripsRouter.patch('/:tripId/stops/:stopId', authenticate, requireRole('DRIVER'), asyncHandler(updateStopStatus));
