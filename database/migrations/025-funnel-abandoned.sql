-- 025: anonymous booking-funnel events and the abandoned-booking reminder. Idempotent.
--  * funnel_events: one row per step a guest reached on the booking page
--    (no IP, no user agent; sid is a random per-tab id)
--  * booking_drafts.reminded_at: set when the one "your day is waiting" e-mail is claimed

CREATE TABLE IF NOT EXISTS funnel_events (
  id         bigserial PRIMARY KEY,
  step       text NOT NULL,
  label      text NOT NULL DEFAULT '',
  sid        text NOT NULL,
  path       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS funnel_events_created_idx ON funnel_events(created_at);

ALTER TABLE booking_drafts ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
CREATE INDEX IF NOT EXISTS booking_drafts_unreminded_idx ON booking_drafts(created_at) WHERE reminded_at IS NULL;
