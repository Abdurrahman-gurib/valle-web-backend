# VALLÉ Advenature™ Park: Database

PostgreSQL database for the park website: content catalog (experiences, dining,
packages, prices, home-page content), transactional tables for bookings and quote
requests, and the back-office tables for the sales & reservations team
(`staff_users`, `chat_conversations`, `chat_messages`).

## ⚠ Seeded staff accounts: change before going live

`seed.sql` creates three back-office logins so the staff portal works out of the box.
Their passwords are **public knowledge** (they are in this repository), so they must
be changed before the site is reachable from the internet.

| Email                 | Role    | Starter password      |
| --------------------- | ------- | --------------------- |
| `sales@vallepark.com` | manager | `VallePark2026!Sales` |
| `agent@vallepark.com` | agent   | `VallePark2026!Agent` |
| `hr@vallepark.com`    | hr      | `VallePark2026!HR`    |

To replace one, run the rotation script from the repository root. It hashes with
bcrypt and updates the row in place; with no password argument it generates one:

```powershell
npm run staff:password -- sales@vallepark.com "YOUR NEW PASSWORD"
npm run staff:password -- sales@vallepark.com          # random 20 characters, printed once
```

On Railway run the same inside the api container:
`railway ssh --service api -- node scripts/staff-password.js sales@vallepark.com`.

Re-running `seed.sql` restores the starter passwords, so change them again after any
re-seed (or edit `scripts/generate-seed.js` to carry your own hashes).

- `schema.sql`: authoritative DDL (PostgreSQL 14+). Load first.
- `seed.sql`: **generated** content data. Load after the schema. Re-runnable
  (it truncates content tables first).
- `seed/data.json`: the source of truth for all content.
- `scripts/generate-seed.js`: regenerates `seed.sql` from `data.json`.
- `scripts/dev-db.ps1`: isolated local dev instance (Windows, port 5433).
- `docker-compose.yml`: containerised alternative (port 5432).
- `../scripts/db-init.js` (`npm run db:init` in the repository root): applies
  `schema.sql` + `seed.sql` to an empty database through node-postgres, no psql
  needed. Idempotent, and also what Railway runs before every deployment.
  `--reseed` (with `CONFIRM_RESEED=yes`) re-applies `seed.sql`, which through
  `TRUNCATE ... CASCADE` also deletes bookings, chats and applications; `--reset`
  (with `CONFIRM_RESET=yes`) rebuilds from scratch.

## Option A: isolated local dev instance (Windows, no Docker)

Uses your PostgreSQL 18 binaries but keeps its own data directory
(`database\.pgdata`) and its own port (**5433**), so it never touches an
existing PostgreSQL service. Binaries are expected at
`C:\Program Files\PostgreSQL\18\bin`; set `$env:PGBIN` to override.

```powershell
cd database\scripts
.\dev-db.ps1 init     # initdb + start + createdb valle_park + schema + seed
.\dev-db.ps1 status   # is it running?
.\dev-db.ps1 stop     # stop the instance
.\dev-db.ps1 start    # start it again
.\dev-db.ps1 seed     # re-apply schema.sql + seed.sql (wipes content + bookings)
.\dev-db.ps1 reset    # stop and delete .pgdata entirely
```

Connection: `host=localhost port=5433 user=postgres dbname=valle_park`
(trust auth, no password). This matches the Backend defaults
(`DB_PORT=5433`, `DB_NAME=valle_park`).

## Option B: Docker

```powershell
cd Database
docker compose up -d
```

Starts `postgres:16-alpine` on port **5432** with `valle_park` created and
schema + seed applied automatically on first start (empty volume). Credentials
default to `postgres` / `postgres`; override via `POSTGRES_DB`,
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` environment variables.
If the Backend points at this instance, set `DB_PORT=5432`.

Init scripts only run on an empty volume. After regenerating `seed.sql`, run
`docker compose down -v` then `up -d` (or `docker compose exec db psql -U
postgres -d valle_park -f /docker-entrypoint-initdb.d/02-seed.sql`).

## Option C: an existing PostgreSQL server

```bash
createdb valle_park
psql -d valle_park -v ON_ERROR_STOP=1 -f schema.sql -f seed.sql
```

`seed.sql` is safe to re-run: it truncates the content tables (with
`RESTART IDENTITY CASCADE`) before inserting.

## Schema overview

| Area | Tables |
| --- | --- |
| Catalog | `categories`, `experiences`, `experience_facts`, `experience_galleries`, `gallery_shots`, `map_pins` |
| Dining | `restaurants`, `restaurant_gallery`, `menu_groups`, `menu_items` |
| Packages | `package_tiers`, `package_tier_items`, `package_addons`, `vip_items`, `combos`, `combo_items`, `cinematic_items` |
| Pricing | `price_list` (grouped by `group_key`: `admission` + per-experience groups) |
| Photo packages | `photo_tiers`, `photo_addons` (per rate: `rr` resident / `nr` non-resident) |
| Team building | `team_packs`, `team_pack_items` |
| Home page | `hero_slides` |
| Back office | `staff_users`, `chat_conversations`, `chat_messages` |
| Settings | `settings` (key/value: `entry_adult`, `entry_child`, `park_name`, contact details, hours) |
| Transactions | `bookings`, `booking_lines`, `quotes` (empty in seed; written by the Backend) |

All prices are MUR integers. `rr` = resident rate, `nr` = non-resident rate.
Ordering everywhere is via `sort_order` columns, which mirror the array order
in `seed/data.json`.

## Changing content (regeneration flow)

1. Edit `seed/data.json` (the only file you should hand-edit for content).
2. Regenerate: `node scripts/generate-seed.js` (rewrites `seed.sql`
   and prints per-table row counts).
3. Re-apply: `.\scripts\dev-db.ps1 seed`, or re-init the Docker volume, or
   `psql -d valle_park -v ON_ERROR_STOP=1 -f seed.sql` on an existing server.

Never edit `seed.sql` by hand; it is generated output.
