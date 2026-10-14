-- 022: staff account security. Session invalidation (token_version), optional
-- TOTP two-step login with hashed recovery codes, and single-use password
-- reset tokens (only a SHA-256 of the token is stored).
-- Idempotent: safe to run on every api pre-deploy (scripts/db-init.js).

ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
-- AES-256-GCM sealed base32 secrets; never sent to a client after enrolment.
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS totp_secret_enc text;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS totp_pending_enc text;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS totp_last_step bigint;
-- SHA-256 hex of each unused recovery code.
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS recovery_code_hashes jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS staff_password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_password_resets_staff_idx ON staff_password_resets (staff_id);
