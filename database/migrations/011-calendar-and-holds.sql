-- 011: capacity calendar and slot holds. Idempotent.
--  * closures: days or single arrival slots when the park is closed, under
--    maintenance or reserved for a private event (settings JSON, edited in
--    the back office)
--  * activity_capacity: guests (per-person activities) or units (vehicles)
--    one arrival slot can take per experience (settings JSON)
--  * slot_capacity: guests per arrival slot, park wide (overrides the
--    BOOKING_SLOT_CAPACITY variable when set)
--  * slot_holds: places held for a few minutes while a guest fills in their
--    details, counted like bookings until they expire or become one

INSERT INTO settings (key, value) VALUES ('closures', '[]') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('activity_capacity', '{}') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS slot_holds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_date  date NOT NULL,
  slot        text NOT NULL CHECK (slot IN ('morning','afternoon')),
  adults      int  NOT NULL DEFAULT 0,
  kids        int  NOT NULL DEFAULT 0,
  items       jsonb NOT NULL DEFAULT '[]',   -- [{id, adults, kids, units}]
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slot_holds_slot_idx ON slot_holds(visit_date, slot, expires_at);
