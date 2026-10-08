-- 018: the visit day on the ticket, waiver history and the evening waiver nudge, visit photos.
-- Idempotent: safe to run on every api pre-deploy (scripts/db-init.js).

-- Waivers keep every version: re-signing under the same name supersedes the
-- previous row instead of overwriting it. Only current rows count.
ALTER TABLE waivers ADD COLUMN IF NOT EXISTS version       int NOT NULL DEFAULT 1;
ALTER TABLE waivers ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
DROP INDEX IF EXISTS uq_waivers_participant;
CREATE UNIQUE INDEX IF NOT EXISTS uq_waivers_participant_current
  ON waivers(booking_id, lower(participant_name)) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_waivers_booking_current ON waivers(booking_id) WHERE superseded_at IS NULL;

-- The evening-before nudge to bookings whose waivers are still unsigned, and
-- when the desk told the guest their photos are ready.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS waiver_reminder_sent_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS photos_ready_at         timestamptz;

-- Visit photos: uploaded by the desk, downloaded from the ticket page. Bytes in
-- Postgres like chat attachments (no durable disk on the api); a few MB each.
CREATE TABLE IF NOT EXISTS booking_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  name        text NOT NULL,
  mime        text NOT NULL,
  size        int  NOT NULL,
  data        bytea NOT NULL,
  caption     text NOT NULL DEFAULT '',
  uploaded_by text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_photos_booking ON booking_photos(booking_id);

-- Live operations per activity (wait in minutes, meeting point, a note), set
-- by the desk and read by the ticket page on the day. Default meeting points.
INSERT INTO settings (key, value) VALUES ('activity_ops', '{
  "zipline":   {"waitMin": null, "meetingPoint": "Park Entrance & Briefing (pin A): every zipline tour is briefed here", "note": ""},
  "bicycle":   {"waitMin": null, "meetingPoint": "Bike Zone, next to the entrance", "note": ""},
  "nepalese":  {"waitMin": null, "meetingPoint": "Nepalese Bridge start, 5 minutes up the trail from reception", "note": ""},
  "quad":      {"waitMin": null, "meetingPoint": "Quad & Buggy Base: both loops start and finish here", "note": ""},
  "buggy":     {"waitMin": null, "meetingPoint": "Quad & Buggy Base: both loops start and finish here", "note": ""},
  "luge":      {"waitMin": null, "meetingPoint": "Luge Kart Zone (pin G), top of the valley", "note": ""},
  "peak":      {"waitMin": null, "meetingPoint": "La Tour Viewpoint (pin B)", "note": ""},
  "rock":      {"waitMin": null, "meetingPoint": "Rock Garden (pin D)", "note": ""},
  "waterfalls":{"waitMin": null, "meetingPoint": "Vacoas Waterfall (pin E), then Chamouzé Waterfall", "note": ""},
  "coloured":  {"waitMin": null, "meetingPoint": "23 Coloured Earth (pin F)", "note": ""},
  "animals":   {"waitMin": null, "meetingPoint": "Green Zone Wildlife, left of the entrance", "note": ""},
  "trees":     {"waitMin": null, "meetingPoint": "Park Entrance & Reception (pin A)", "note": ""},
  "pirate":    {"waitMin": null, "meetingPoint": "Kids Park (pin I)", "note": ""},
  "bonding":   {"waitMin": null, "meetingPoint": "Park Entrance & Reception (pin A)", "note": ""}
}') ON CONFLICT (key) DO NOTHING;
