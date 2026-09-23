-- Booking lines remember which priced option of an experience was booked
-- (a price_list label such as "Advenature Flight · 5.5 km, 11 lines"), so the
-- staff editor can re-price the line at that option. Idempotent.
ALTER TABLE booking_lines ADD COLUMN IF NOT EXISTS variant text NOT NULL DEFAULT '';
