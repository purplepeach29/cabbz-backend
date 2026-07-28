import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.routes';
import { locationsRouter } from './routes/locations.routes';
import { vehiclesRouter } from './routes/vehicles.routes';
import { driversRouter } from './routes/drivers.routes';
import { guestsRouter } from './routes/guests.routes';
import { tripsRouter } from './routes/trips.routes';
import { matchingRouter } from './routes/matching.routes';
import { errorHandler } from './middleware/errorHandler';

export const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/locations', locationsRouter);
app.use('/vehicles', vehiclesRouter);
app.use('/drivers', driversRouter);
app.use('/guests', guestsRouter);
app.use('/trips', tripsRouter);
app.use('/matching', matchingRouter);

app.use(errorHandler);
