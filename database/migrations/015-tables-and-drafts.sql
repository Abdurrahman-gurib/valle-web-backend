-- 015: restaurant table reservations and saved booking drafts. Idempotent.
--  * table_reservations: a request for a table at one of the park's restaurants
--    (date, time, party, optional pre-order from the menu), confirmed by the desk
--  * booking_drafts: what a guest had filled in on the booking page, saved so
--    they can come back through the link e-mailed to them (14 days)

CREATE TABLE IF NOT EXISTS table_reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id text NOT NULL REFERENCES restaurants(id),
  guest_name    text NOT NULL,
  email         text NOT NULL DEFAULT '',
  phone         text NOT NULL DEFAULT '',
  visit_date    date NOT NULL,
  visit_time    text NOT NULL,                          -- "12:30"
  party         int  NOT NULL CHECK (party BETWEEN 1 AND 60),
  preorder      jsonb NOT NULL DEFAULT '[]',             -- [{item, qty}]
  notes         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','cancelled')),
  booking_ref   text NOT NULL DEFAULT '',                -- VAL-xxxx-26 when the guest gave one
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS table_reservations_date_idx ON table_reservations(visit_date, visit_time);
CREATE INDEX IF NOT EXISTS table_reservations_created_idx ON table_reservations(created_at DESC);

CREATE TABLE IF NOT EXISTS booking_drafts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  payload    jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_drafts_expires_idx ON booking_drafts(expires_at);
