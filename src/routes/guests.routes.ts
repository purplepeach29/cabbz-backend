import { Router } from 'express';
import { authenticate, requireGuest, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import {
  listGuests,
  createGuest,
  updateGuest,
  getOwnGuestProfile,
  registerOwnPushToken,
  createOnDemandRequest,
  approveGuestRequest,
  declineGuestRequest,
} from '../controllers/guests.controller';

export const guestsRouter = Router();

// Admin/Ops — full guest queue.
guestsRouter.get('/', authenticate, requireRole('ADMIN'), asyncHandler(listGuests));
guestsRouter.post('/', authenticate, requireRole('ADMIN'), asyncHandler(createGuest));
guestsRouter.patch('/:guestId', authenticate, requireRole('ADMIN'), asyncHandler(updateGuest));
guestsRouter.post('/:guestId/approve', authenticate, requireRole('ADMIN'), asyncHandler(approveGuestRequest));
guestsRouter.post('/:guestId/decline', authenticate, requireRole('ADMIN'), asyncHandler(declineGuestRequest));

// Guest — scoped to the caller's own record only.
guestsRouter.get('/me', authenticate, requireGuest, asyncHandler(getOwnGuestProfile));
guestsRouter.patch('/me/push-token', authenticate, requireGuest, asyncHandler(registerOwnPushToken));
guestsRouter.post('/me/on-demand-request', authenticate, requireGuest, asyncHandler(createOnDemandRequest));
