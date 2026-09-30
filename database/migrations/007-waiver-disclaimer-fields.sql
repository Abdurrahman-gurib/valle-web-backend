-- 007: the waiver follows the park's Disclaimer Form (Mare Anguilles Farms Ltd):
-- address/hotel, contact details, nationality, ID number and the promotions
-- consent of clause 18. Idempotent.
ALTER TABLE waivers ADD COLUMN IF NOT EXISTS address           text NOT NULL DEFAULT '';
ALTER TABLE waivers ADD COLUMN IF NOT EXISTS email             text NOT NULL DEFAULT '';
ALTER TABLE waivers ADD COLUMN IF NOT EXISTS phone             text NOT NULL DEFAULT '';
ALTER TABLE waivers ADD COLUMN IF NOT EXISTS nationality       text NOT NULL DEFAULT '';
ALTER TABLE waivers ADD COLUMN IF NOT EXISTS id_number         text NOT NULL DEFAULT '';
ALTER TABLE waivers ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false;
