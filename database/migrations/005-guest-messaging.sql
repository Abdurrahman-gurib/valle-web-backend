-- 005: guest tickets and reminders (e-mail / WhatsApp). Idempotent.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ticket_sent_at   timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_bookings_reminder ON bookings(visit_date) WHERE reminder_sent_at IS NULL AND status = 'confirmed';
