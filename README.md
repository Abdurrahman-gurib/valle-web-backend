# VALLÉ Advenature™ Park: Backend

NestJS 11 + TypeORM 0.3 + PostgreSQL API serving the park catalog, bookings and
group-quote requests for the VALLÉ Advenature™ Park website, plus the staff back
office (sessions, booking management, live chat).

## Deployment

Production runs on Railway: this repository is the `api` service (plus the `Postgres`
service it owns) of the `valle-web` project, deployed automatically from `main`. The
full runbook, including every service variable, the database bootstrap and day-two
operations, is [DEPLOYMENT.md](DEPLOYMENT.md). The public site is built from
[valle-web-frontend](https://github.com/Abdurrahman-gurib/valle-web-frontend).

## Setup

1. Load the database (PostgreSQL 14+). Either the isolated Windows dev instance
   (`database\scripts\dev-db.ps1 init`, see [database/README.md](database/README.md))
   or any server you already run:

   ```sh
   createdb valle_park
   npm run db:init      # applies database/schema.sql + database/seed.sql via node-postgres
   ```

   `db:init` reads the same `DB_*` variables as the API (from `.env` when present),
   only touches an empty database, and is what Railway runs before every deploy.
   `npm run db:reseed` (with `CONFIRM_RESEED=yes`) re-applies the seed later; note
   that wipes bookings, chats and applications along with the content.

2. Configure the environment:

   ```sh
   cp .env.example .env
   # then edit DB_* values as needed
   ```

3. Install and run:

   ```sh
   npm install
   npm run start:dev
   ```

The API listens on `http://localhost:3001/api` by default. Interactive Swagger
docs are served at `http://localhost:3001/api/docs`, but only when `NODE_ENV`
is not `production`, so deployments do not publish the API surface.

## Environment

| Variable      | Default                                       | Purpose                       |
| ------------- | --------------------------------------------- | ----------------------------- |
| `PORT`        | `3001`                                        | HTTP port                     |
| `DB_HOST`     | `localhost`                                   | PostgreSQL host               |
| `DB_PORT`     | `5433`                                        | PostgreSQL port               |
| `DB_USER`     | `postgres`                                    | PostgreSQL user               |
| `DB_PASSWORD` | `postgres` (empty allowed)                    | PostgreSQL password           |
| `DB_NAME`     | `valle_park`                                  | Database name                 |
| `DB_SSL`      | `false`                                       | `true` = TLS + verify (Azure, RDS); `no-verify` = TLS, self-signed accepted (Railway private network); `false` = plain, dev only (production refuses) |
| `CORS_ORIGIN` | `http://localhost:5173,http://localhost:4173` | Allowed origins (comma-split) |
| `NODE_ENV`    | _(unset)_                                     | `production` disables Swagger and turns on the boot checks |
| `TRUST_PROXY` | `false` (`true` in production)                | Trust one proxy hop (the nginx container) so rate limits see the real client IP |

| Variable            | Default        | Purpose                                        |
| ------------------- | -------------- | ---------------------------------------------- |
| `JWT_SECRET`        | dev-only key   | Signs the staff session JWT (**required** in production) |
| `STAFF_COOKIE_NAME` | `valle_staff`  | Name of the httpOnly staff session cookie      |

`JWT_SECRET` has no safe default: with `NODE_ENV=production` and no value set the
API refuses to boot rather than sign sessions with a key that is in this
repository. Outside production it falls back to a development key and logs a
warning. CORS runs with `credentials: true` so the session cookie survives the
Vite dev proxy. Keep `CORS_ORIGIN` to origins you actually control.

## Scripts

| Script               | What it does                                  |
| -------------------- | --------------------------------------------- |
| `npm run build`      | Compile to `dist/` via the Nest CLI           |
| `npm start`          | Start once (ts, via Nest CLI)                 |
| `npm run start:dev`  | Start in watch mode                           |
| `npm run start:prod` | Run the compiled build (`node dist/main`)     |
| `npm test`           | Unit tests (pricing rules, staff bookings)    |
| `npm run test:e2e`   | E2E tests, opt-in with `TEST_DB=1` (need DB)  |
| `npm run lint`       | Type-check only (`tsc --noEmit`)              |
| `npm run db:init`    | Apply `database/schema.sql` + `seed.sql` to an EMPTY database (no-op otherwise); Railway's pre-deploy command |
| `npm run db:reseed`  | Re-apply `seed.sql` (needs `CONFIRM_RESEED=yes`): replaces content + staff logins and, through `TRUNCATE ... CASCADE`, deletes bookings, chats and applications |
| `npm run staff:password -- <email> [password]` | Rotate a back-office password (generates one when omitted) |

## Endpoints

All routes are prefixed with `/api`.

| Method | Path                     | Description                                                              |
| ------ | ------------------------ | ------------------------------------------------------------------------ |
| GET    | `/api/catalog`           | Full site catalog: exact shape of `database/seed/data.json` (60 s cache) |
| GET    | `/api/experiences`       | All experiences (`ACTS`), ordered by `sort_order`                         |
| GET    | `/api/experiences/:id`   | One experience (404 when unknown)                                         |
| GET    | `/api/restaurants`       | Restaurants keyed by id (`RESTOS`)                                        |
| GET    | `/api/restaurants/:id`   | One restaurant (404 when unknown)                                         |
| GET    | `/api/settings`          | Raw settings key/value map                                                |
| POST   | `/api/bookings`          | Create a booking: totals recomputed server-side, returns `refCode`        |
| POST   | `/api/quotes`            | Store a group/team quote request → `{ id }`                               |
| GET    | `/api/health`            | Readiness: 200 `{ status: 'ok', db: true }`, or 503 when the DB is down    |
| GET    | `/api/health/live`       | Liveness: 200 `{ status: 'ok' }`, never touches the database               |

There is deliberately no `GET /api/bookings/:refCode`: reference codes are short
enough to enumerate, so a public lookup would expose guest contact details.

## Rate limits

`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])` exists only so
`ThrottlerGuard` is injectable: no `APP_GUARD` is bound, so that default budget
applies to no route. Everything metered opts in per route with `@UseGuards` +
`@Throttle`, which keeps reads (catalog, experiences, restaurants, health, and
the chat thread fetch) completely unmetered. Every public write is covered.

| Method | Path                                  | Budget         | Keyed on     |
| ------ | ------------------------------------- | -------------- | ------------ |
| POST   | `/api/bookings`                       | 10 / 10 min    | IP           |
| POST   | `/api/quotes`                         | 5 / 10 min     | IP           |
| POST   | `/api/vacancies/:slug/apply`          | 5 / 10 min     | IP           |
| POST   | `/api/chat/session`                   | 10 / 10 min    | IP           |
| POST   | `/api/chat/session/:id/messages`      | 20 / 60 s      | IP           |
| POST   | `/api/staff/auth/login`               | 10 / 60 s      | (IP, email)  |

Over budget answers `429`. The budgets are sized so an honest guest never meets
one: bookings get the loosest allowance because a single family plausibly books
several days or groups in one sitting and because rejected attempts (a 400 from
pricing validation) still consume the budget, while a flood would otherwise eat
into the 9000 available `VAL-####-26` reference codes. Quotes and applications
are one-per-visit actions landing in a human inbox, so five is ample. Chat
sessions resume rather than duplicate for a known `visitorKey`, so the limit
only bites on newly minted keys.

Counters live in memory, so budgets are per replica; see `DEPLOYMENT.md`, which
pins the API to a single replica for the chat gateway's sake anyway. Set
`TRUST_PROXY=true` behind a reverse proxy or every request looks like it comes
from the proxy's IP and one guest can exhaust a budget for everyone.

## Staff back office

The reservations team signs in at `/staff/login` on the frontend and works from
`/staff` (tabs: **Bookings**, **Chat**). Neither URL is linked from the public
site: no nav item, no footer link, no sitemap entry.

### Session

`POST /api/staff/auth/login` sets an httpOnly, `SameSite=Strict` cookie
(`STAFF_COOKIE_NAME`, `Secure` in production, 8 h lifetime) holding a JWT and
returns `{ id, email, name, role }`. The hash is never returned, and a failed
login always answers `401 Invalid email or password`; it never reveals whether
the address exists. Login is rate limited to **10 attempts / 60 s per (IP,
email)**; that budget is scoped to the login route only, so public traffic is
never throttled.

Note the budget is per account rather than per address: the reservations office
sits behind one NAT, so an IP-only limit would let one person's mistyped password
lock out their colleagues, and an attacker hammering a single account would take
the whole team down with it. Ten guesses per account per minute is useless for
brute force.

`ThrottlerModule.forRoot` is registered so `ThrottlerGuard` can be injected, but
no global `APP_GUARD` is bound, so its default budget applies to nothing. Only
the routes that opt in explicitly are metered; see [Rate limits](#rate-limits)
for the full list.

| Method | Path                            | Description                              |
| ------ | ------------------------------- | ---------------------------------------- |
| POST   | `/api/staff/auth/login`         | `{ email, password }` → sets the cookie  |
| POST   | `/api/staff/auth/logout`        | Clears the cookie → `{ ok: true }`       |
| GET    | `/api/staff/auth/me`            | Signed-in operator, or 401               |

### Guarded endpoints

Every route below requires a valid session cookie (401 otherwise).

| Method | Path                             | Description                                                       |
| ------ | -------------------------------- | ----------------------------------------------------------------- |
| GET    | `/api/staff/bookings`            | `?status=&from=&to=&q=&page=&pageSize=` → `{ items, total, page, pageSize }`, newest first |
| GET    | `/api/staff/bookings/:refCode`   | One booking plus its priced `lines` (404 when unknown)             |
| PATCH  | `/api/staff/bookings/:refCode`   | `{ status }`: `confirmed` \| `arrived` \| `cancelled` → updated row  |
| GET    | `/api/staff/quotes`              | `?page=&pageSize=`: quote requests, newest first                   |
| GET    | `/api/staff/stats`               | `{ bookingsToday, arrivalsToday, openChats, revenueMonth }`        |

- `status` / `from` (visit date ≥) / `to` (visit date ≤) / `q` combine with AND.
  `q` is a case-insensitive match across reference code, guest name, email and
  phone. `pageSize` defaults to 25 and is capped at 100.
- `/api/staff/stats` counts in the park's timezone (`Indian/Mauritius`), not the
  server's: `bookingsToday` = bookings created today, `arrivalsToday` = bookings
  due on site today excluding cancellations, `revenueMonth` = `SUM(total)` for
  the current calendar month excluding cancellations, `openChats` = conversations
  still in `open`.

Live chat runs over socket.io on the `/chat` namespace with REST fallbacks under
`/api/chat/*` (public, visitor-key scoped) and `/api/staff/chat/*` (guarded).
The guarded set includes `POST conversations/:id/messages` and
`POST conversations/:id/close`, so an operator whose socket has dropped can still
reply and close threads; those writes are broadcast over the gateway, so a
connected visitor sees them immediately.

**Reverse proxies must forward `/socket.io` with WebSocket upgrade headers** as well
as `/api`. Without it the handshake never completes, chat silently degrades to
polling, and the staff console sits on "reconnecting". `nginx.conf.template` in the
frontend repo and its `vite.config.ts` both do this already.

### ⚠ Seeded accounts: change before deploying

`database/seed.sql` creates three logins so the back office works out of the box.
Their passwords are published in this repository, so they are **not** safe for a
reachable deployment and must be replaced before the site goes live:

| Email                 | Role    | Starter password      |
| --------------------- | ------- | --------------------- |
| `sales@vallepark.com` | manager | `VallePark2026!Sales` |
| `agent@vallepark.com` | agent   | `VallePark2026!Agent` |
| `hr@vallepark.com`    | hr      | see `database/README.md` |

```powershell
npm run staff:password -- sales@vallepark.com "YOUR NEW PASSWORD"
npm run staff:password -- sales@vallepark.com        # generates and prints a random one
# on Railway, inside the api container:
railway ssh --service api -- node scripts/staff-password.js sales@vallepark.com
```

Re-running the seed (`npm run db:reseed`) restores the starter passwords, so change
them again after any re-seed. Set a real `JWT_SECRET` at the same time.

## Booking pricing rules

Server-side pricing in `src/bookings/pricing.ts` exactly mirrors
`Frontend/src/store/booking.ts` (any change must be made in both places):

- Park entry: `entry_adult × adults + entry_child × kids` (from `settings`).
- Per-person items: `price × adults + round(price × 0.5) × kids`.
- Flat items (buggy, private expedition): `price × units`.
- Rate selection: `nr` uses `price_nr`, `rr` uses `price_rr`; both fall back to
  `base_price` when the experience is not rate-dependent.
- Explorer Pass: ≥ 3 distinct adventure per-person items with an amount > 0 →
  15% off those items (`round(advSubtotal × 0.15)`).
- Items with `entry`/`kiosk` price modes or unknown ids are rejected (400).
- Reference codes look like `VAL-4821-26` and are re-generated on collision.
