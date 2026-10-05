-- Backup log: one row per nightly backup and per restore test, written by
-- scripts/db-backup.js (the db-backup cron service) and read by the back office
-- (GET /api/staff/ops/backups). Idempotent, like every migration.
CREATE TABLE IF NOT EXISTS backup_runs (
    id           BIGSERIAL PRIMARY KEY,
    kind         TEXT        NOT NULL CHECK (kind IN ('backup', 'restore_test')),
    ok           BOOLEAN     NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    file         TEXT        NOT NULL DEFAULT '',
    bytes        BIGINT      NOT NULL DEFAULT 0,
    sha256       TEXT        NOT NULL DEFAULT '',
    table_count  INTEGER     NOT NULL DEFAULT 0,
    row_count    BIGINT      NOT NULL DEFAULT 0,
    detail       TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS backup_runs_kind_finished_idx ON backup_runs (kind, finished_at DESC);
