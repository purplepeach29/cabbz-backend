import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { listLocations, createLocation } from '../controllers/locations.controller';

export const locationsRouter = Router();

// Any authenticated staff user (admin or driver) may read the fixed location
// list; both roles need it to render pickup/drop points.
locationsRouter.get('/', authenticate, asyncHandler(listLocations));
locationsRouter.post('/', authenticate, requireRole('ADMIN'), asyncHandler(createLocation));
