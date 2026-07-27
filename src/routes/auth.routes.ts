import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { staffLogin, guestLogin } from '../controllers/auth.controller';

export const authRouter = Router();

authRouter.post('/staff-login', asyncHandler(staffLogin));
authRouter.post('/guest-login', asyncHandler(guestLogin));
