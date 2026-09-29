-- 006: digital waivers. One signed waiver per participant, stored against the
-- booking and checked at the gate. Idempotent.
CREATE TABLE IF NOT EXISTS waivers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  participant_name text NOT NULL,
  birth_date       date NOT NULL,
  height_cm        int  NOT NULL CHECK (height_cm BETWEEN 50 AND 230),
  weight_kg        int  NOT NULL CHECK (weight_kg BETWEEN 10 AND 250),
  is_minor         boolean NOT NULL,
  guardian_name    text NOT NULL DEFAULT '',     -- signs for a participant under 18
  emergency_name   text NOT NULL,
  emergency_phone  text NOT NULL,
  medical_notes    text NOT NULL DEFAULT '',
  declarations     jsonb NOT NULL,               -- { risks, health, sober, rules, data } all true
  photo_consent    boolean NOT NULL DEFAULT false,
  signature_png    text NOT NULL,                -- data:image/png;base64,...
  signed_by        text NOT NULL,                -- participant, or guardian for a minor
  lang             text NOT NULL DEFAULT 'en',   -- language the waiver was read in
  terms_version    text NOT NULL,
  ip               text NOT NULL DEFAULT '',
  user_agent       text NOT NULL DEFAULT '',
  signed_at        timestamptz NOT NULL DEFAULT now()
);
-- one waiver per participant: signing again under the same name replaces it
CREATE UNIQUE INDEX IF NOT EXISTS uq_waivers_participant ON waivers(booking_id, lower(participant_name));

-- Activity limits the gate checks waivers against. Ages come from the catalog
-- (experiences.age_label); weights and heights are operational limits, edited
-- here as JSON: { "<experience id>": { "minWeightKg", "maxWeightKg", "minHeightCm", "maxHeightCm" } }.
INSERT INTO settings(key, value) VALUES ('waiver_limits', '{"bicycle":{"maxWeightKg":100}}')
ON CONFLICT (key) DO NOTHING;
