-- 030: children under 6, the booking's language, and the expo deal photos.
--   * bookings.infants: children under 6 come free but are counted, for the
--     slot capacity, the ticket and the waivers (a parent signs for them).
--   * slot_holds.infants: a hold counts them too.
--   * bookings.lang: the language the guest booked in, so the ticket and waiver
--     links sent by e-mail / WhatsApp open in it (/fr/ticket/...).
--   * The expo deal products get the photos of their headline activity (the
--     packages page already shows them); only rows still on the 027 image move.
-- Idempotent: safe to run on every api pre-deploy (scripts/db-init.js); a second
-- run changes nothing.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS infants int NOT NULL DEFAULT 0 CHECK (infants BETWEEN 0 AND 400);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lang text NOT NULL DEFAULT 'en';
ALTER TABLE slot_holds ADD COLUMN IF NOT EXISTS infants int NOT NULL DEFAULT 0;

UPDATE products SET image = x.img
FROM (VALUES
  ('expo:go',    '/images/shoot/cine-03.webp',                 '/images/giant-swing/giant-swing-06.webp'),
  ('expo:plus',  '/images/map/zip-selfie-cheer.webp',          '/images/zipline-waterfall.webp'),
  ('expo:pro',   '/images/quadbuggy.avif',                     '/images/zipline-new-4.webp'),
  ('expo:elite', '/images/vip-ultimate-buggy-coloured-earth.avif', '/images/map/quad-duo-speed.webp')
) AS x(k, old, img)
WHERE products.key = x.k AND products.image = x.old;
