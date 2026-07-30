# cabbz-backend

Backend for the Cabbz event fleet dispatch system — data model, JWT auth +
RBAC, real-time (Socket.io), push (Firebase), live ETA (Google Distance
Matrix), and the batch matching engine (calls out to `../cabbz-matcher`,
an OR-Tools VRPPD solver). See the full architecture in (the Guest app repo).

Manual admin-assigned trips (`POST /trips`) still exist alongside the
automated batch engine (`POST /matching/run-batch`) — manual assignment is
the override path for edge cases, per the brief's "admin manual override
capability" requirement, not the primary way trips get created.

## Setup

```sh
cp .env.example .env   # then point DATABASE_URL at a real Postgres instance
npm install
npm run prisma:migrate -- --name init
npm run dev
```

`npm run prisma:migrate` also seeds an admin login and reference locations
(venue/accommodations/airport/station) via `prisma/seed.ts`.

## Roles & auth

- `POST /auth/staff-login` — admin or driver, email+password → JWT.
- `POST /auth/guest-login` — guest invite code → JWT.
- Driver-role tokens are always scoped server-side to their own `driverId`
  (see `ownDriverId` in `src/middleware/auth.ts`) — a driver token can never
  read or write another driver's trip, location, or the fleet-wide view.

## API surface (Phase 1)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | /auth/staff-login | public | Admin/driver login |
| POST | /auth/guest-login | public | Guest login via invite code |
| GET/POST | /locations | staff / admin | Reference points (venue, accommodations, airport, station) |
| GET/POST | /vehicles | admin | Fleet vehicles |
| GET/POST | /drivers | admin | Fleet drivers (onboarding is manual, per spec) |
| PATCH | /drivers/:driverId/status | admin | Manual override (e.g. pull for break) |
| GET | /drivers/me | driver | Own profile |
| PATCH | /drivers/me/location | driver | Live location ping |
| GET/POST/PATCH | /guests | admin | Guest queue + manual deviation logging |
| GET | /guests/me | guest | Own pickup details |
| GET/POST | /trips | admin | Trip list + manual assignment |
| GET | /trips/me/current | driver | The one trip currently assigned |
| POST | /trips/:tripId/respond | driver | Accept/reject assigned trip |
| PATCH | /trips/:tripId/stops/:stopId | driver | Progress a stop: `arrived` (dropoff auto-completes) / `boarded` (pickup only, completes it) |
| POST | /matching/run-batch | admin | Runs the OR-Tools batch matching engine over every unassigned/queued guest against every available, located driver; creates the resulting Trips automatically |
| POST | /guests/me/on-demand-request | guest | Raise a ride request (no pre-scheduled pickup). Creates a new Guest row, status `PENDING_APPROVAL`; response includes a fresh token for it so the app can switch sessions transparently |
| POST | /guests/:guestId/approve | admin | Manual review step — queues the guest (`QUEUED`, starts the aging clock) and immediately runs a matching round so they don't wait for the next scheduled batch |
| POST | /guests/:guestId/decline | admin | Manual review step — marks the request `CANCELLED` |
