import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import {
  listDrivers,
  createDriver,
  updateDriverStatus,
  getOwnDriverProfile,
  pingOwnLocation,
  registerOwnPushToken,
} from '../controllers/drivers.controller';

export const driversRouter = Router();

// Admin/Ops — full fleet visibility, never exposed to a driver-role token.
driversRouter.get('/', authenticate, requireRole('ADMIN'), asyncHandler(listDrivers));
driversRouter.post('/', authenticate, requireRole('ADMIN'), asyncHandler(createDriver));
driversRouter.patch('/:driverId/status', authenticate, requireRole('ADMIN'), asyncHandler(updateDriverStatus));

// Driver — scoped to the caller's own record only.
driversRouter.get('/me', authenticate, requireRole('DRIVER'), asyncHandler(getOwnDriverProfile));
driversRouter.patch('/me/location', authenticate, requireRole('DRIVER'), asyncHandler(pingOwnLocation));
driversRouter.patch('/me/push-token', authenticate, requireRole('DRIVER'), asyncHandler(registerOwnPushToken));
