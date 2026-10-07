-- 016: idempotent booking submit. Idempotent.
--  The booking page sends a key it made once per attempt; a double tap or a
--  retry after a timeout carries the same key and gets the booking already
--  written instead of a second one.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_idempotency_key_uidx ON bookings(idempotency_key) WHERE idempotency_key IS NOT NULL;
