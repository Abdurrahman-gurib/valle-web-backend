-- 034: the language a restaurant table was asked in.
--   * table_reservations.lang: the page language (en/fr/de/it/ar/ru/es/hi), so
--     the acknowledgement and the later confirmed / cancelled e-mails go out in
--     it, like the park bookings (bookings.lang, migration 030).
-- Idempotent: safe to run on every api pre-deploy (scripts/db-init.js); a second
-- run changes nothing.

ALTER TABLE table_reservations ADD COLUMN IF NOT EXISTS lang text NOT NULL DEFAULT 'en';
