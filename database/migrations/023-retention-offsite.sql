-- 023: data retention and off-site backup copies. Idempotent.
--  * retention_runs: one row per run of the API's daily retention job
--    (src/ops/retention.service.ts): counts per category, dry runs included.
--  * bookings.anonymised_at / waivers.anonymised_at: set when the personal
--    fields were cleared after the accounting retention period, so a row is
--    only processed once.
--  * backup_runs.offsite_status / offsite_detail: result of the optional
--    off-site upload after a nightly dump (scripts/db-backup.js).
--    '' = older run, not_configured, uploaded, failed.

CREATE TABLE IF NOT EXISTS retention_runs (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  dry_run     boolean     NOT NULL DEFAULT false,
  ok          boolean     NOT NULL DEFAULT true,
  trigger     text        NOT NULL DEFAULT 'schedule',   -- schedule | manual
  counts      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  detail      text        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS retention_runs_finished_idx ON retention_runs (finished_at DESC);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE waivers  ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
CREATE INDEX IF NOT EXISTS bookings_retention_idx ON bookings (visit_date) WHERE anonymised_at IS NULL;

ALTER TABLE backup_runs ADD COLUMN IF NOT EXISTS offsite_status text NOT NULL DEFAULT '';
ALTER TABLE backup_runs ADD COLUMN IF NOT EXISTS offsite_detail text NOT NULL DEFAULT '';
