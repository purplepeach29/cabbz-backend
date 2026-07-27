import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { listVehicles, createVehicle } from '../controllers/vehicles.controller';

export const vehiclesRouter = Router();

vehiclesRouter.get('/', authenticate, requireRole('ADMIN'), asyncHandler(listVehicles));
vehiclesRouter.post('/', authenticate, requireRole('ADMIN'), asyncHandler(createVehicle));
