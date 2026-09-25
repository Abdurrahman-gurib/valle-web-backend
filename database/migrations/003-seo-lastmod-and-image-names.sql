-- Technical SEO groundwork. Idempotent.
--
-- 1. Content tables carry updated_at so the sitemap can report an accurate
--    <lastmod> per page. A trigger bumps it on every UPDATE.
ALTER TABLE experiences   ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE restaurants   ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE package_tiers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE price_list    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['experiences','restaurants','package_tiers','price_list','job_vacancies'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_touch') THEN
      EXECUTE format('CREATE TRIGGER trg_%I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
    END IF;
  END LOOP;
END $$;

-- 2. Descriptive image filenames (the files were renamed in the web bundle).
UPDATE restaurant_gallery SET src = '/images/le-chamouze-dessert-plate.avif' WHERE src = '/images/copy-of-copy-of-dsc-0693.avif';
UPDATE package_tiers SET image = '/images/le-chamouze-dessert-plate.avif' WHERE image = '/images/copy-of-copy-of-dsc-0693.avif';
UPDATE gallery_shots SET src = '/images/le-chamouze-dessert-plate.avif' WHERE src = '/images/copy-of-copy-of-dsc-0693.avif';
UPDATE experiences SET image = '/images/le-chamouze-dessert-plate.avif' WHERE image = '/images/copy-of-copy-of-dsc-0693.avif';
UPDATE restaurants SET image = '/images/le-chamouze-dessert-plate.avif' WHERE image = '/images/copy-of-copy-of-dsc-0693.avif';
UPDATE restaurant_gallery SET src = '/images/le-chamouze-grilled-steak.avif' WHERE src = '/images/copy-of-copy-of-copy-of-dsc-0729.avif';
UPDATE package_tiers SET image = '/images/le-chamouze-grilled-steak.avif' WHERE image = '/images/copy-of-copy-of-copy-of-dsc-0729.avif';
UPDATE gallery_shots SET src = '/images/le-chamouze-grilled-steak.avif' WHERE src = '/images/copy-of-copy-of-copy-of-dsc-0729.avif';
UPDATE experiences SET image = '/images/le-chamouze-grilled-steak.avif' WHERE image = '/images/copy-of-copy-of-copy-of-dsc-0729.avif';
UPDATE restaurants SET image = '/images/le-chamouze-grilled-steak.avif' WHERE image = '/images/copy-of-copy-of-copy-of-dsc-0729.avif';
UPDATE restaurant_gallery SET src = '/images/le-chamouze-catch-of-the-day-fries.avif' WHERE src = '/images/copy-of-copy-of-copy-of-dsc-0722-1.avif';
UPDATE package_tiers SET image = '/images/le-chamouze-catch-of-the-day-fries.avif' WHERE image = '/images/copy-of-copy-of-copy-of-dsc-0722-1.avif';
UPDATE gallery_shots SET src = '/images/le-chamouze-catch-of-the-day-fries.avif' WHERE src = '/images/copy-of-copy-of-copy-of-dsc-0722-1.avif';
UPDATE experiences SET image = '/images/le-chamouze-catch-of-the-day-fries.avif' WHERE image = '/images/copy-of-copy-of-copy-of-dsc-0722-1.avif';
UPDATE restaurants SET image = '/images/le-chamouze-catch-of-the-day-fries.avif' WHERE image = '/images/copy-of-copy-of-copy-of-dsc-0722-1.avif';
UPDATE restaurant_gallery SET src = '/images/le-chamouze-restaurant-entrance.avif' WHERE src = '/images/copy-of-copy-of-copy-of-dsc-0683.avif';
UPDATE package_tiers SET image = '/images/le-chamouze-restaurant-entrance.avif' WHERE image = '/images/copy-of-copy-of-copy-of-dsc-0683.avif';
UPDATE gallery_shots SET src = '/images/le-chamouze-restaurant-entrance.avif' WHERE src = '/images/copy-of-copy-of-copy-of-dsc-0683.avif';
UPDATE experiences SET image = '/images/le-chamouze-restaurant-entrance.avif' WHERE image = '/images/copy-of-copy-of-copy-of-dsc-0683.avif';
UPDATE restaurants SET image = '/images/le-chamouze-restaurant-entrance.avif' WHERE image = '/images/copy-of-copy-of-copy-of-dsc-0683.avif';
UPDATE restaurant_gallery SET src = '/images/le-chamouze-bartender-cocktail.avif' WHERE src = '/images/copy-of-copy-of-copy-of-dsc-0715-1.avif';
UPDATE package_tiers SET image = '/images/le-chamouze-bartender-cocktail.avif' WHERE image = '/images/copy-of-copy-of-copy-of-dsc-0715-1.avif';
UPDATE gallery_shots SET src = '/images/le-chamouze-bartender-cocktail.avif' WHERE src = '/images/copy-of-copy-of-copy-of-dsc-0715-1.avif';
UPDATE experiences SET image = '/images/le-chamouze-bartender-cocktail.avif' WHERE image = '/images/copy-of-copy-of-copy-of-dsc-0715-1.avif';
UPDATE restaurants SET image = '/images/le-chamouze-bartender-cocktail.avif' WHERE image = '/images/copy-of-copy-of-copy-of-dsc-0715-1.avif';
UPDATE restaurant_gallery SET src = '/images/la-citronelle-dining-hall.avif' WHERE src = '/images/copy-of-copy-of-dsc-0658-1.avif';
UPDATE package_tiers SET image = '/images/la-citronelle-dining-hall.avif' WHERE image = '/images/copy-of-copy-of-dsc-0658-1.avif';
UPDATE gallery_shots SET src = '/images/la-citronelle-dining-hall.avif' WHERE src = '/images/copy-of-copy-of-dsc-0658-1.avif';
UPDATE experiences SET image = '/images/la-citronelle-dining-hall.avif' WHERE image = '/images/copy-of-copy-of-dsc-0658-1.avif';
UPDATE restaurants SET image = '/images/la-citronelle-dining-hall.avif' WHERE image = '/images/copy-of-copy-of-dsc-0658-1.avif';
UPDATE restaurant_gallery SET src = '/images/la-citronelle-garden-lawn.avif' WHERE src = '/images/copy-of-copy-of-dsc-0660.avif';
UPDATE package_tiers SET image = '/images/la-citronelle-garden-lawn.avif' WHERE image = '/images/copy-of-copy-of-dsc-0660.avif';
UPDATE gallery_shots SET src = '/images/la-citronelle-garden-lawn.avif' WHERE src = '/images/copy-of-copy-of-dsc-0660.avif';
UPDATE experiences SET image = '/images/la-citronelle-garden-lawn.avif' WHERE image = '/images/copy-of-copy-of-dsc-0660.avif';
UPDATE restaurants SET image = '/images/la-citronelle-garden-lawn.avif' WHERE image = '/images/copy-of-copy-of-dsc-0660.avif';
UPDATE restaurant_gallery SET src = '/images/la-citronelle-entrance-hall.avif' WHERE src = '/images/copy-of-copy-of-dsc-0662-1.avif';
UPDATE package_tiers SET image = '/images/la-citronelle-entrance-hall.avif' WHERE image = '/images/copy-of-copy-of-dsc-0662-1.avif';
UPDATE gallery_shots SET src = '/images/la-citronelle-entrance-hall.avif' WHERE src = '/images/copy-of-copy-of-dsc-0662-1.avif';
UPDATE experiences SET image = '/images/la-citronelle-entrance-hall.avif' WHERE image = '/images/copy-of-copy-of-dsc-0662-1.avif';
UPDATE restaurants SET image = '/images/la-citronelle-entrance-hall.avif' WHERE image = '/images/copy-of-copy-of-dsc-0662-1.avif';
UPDATE restaurant_gallery SET src = '/images/la-citronelle-mauritian-thali.avif' WHERE src = '/images/copy-of-dsc-0679.avif';
UPDATE package_tiers SET image = '/images/la-citronelle-mauritian-thali.avif' WHERE image = '/images/copy-of-dsc-0679.avif';
UPDATE gallery_shots SET src = '/images/la-citronelle-mauritian-thali.avif' WHERE src = '/images/copy-of-dsc-0679.avif';
UPDATE experiences SET image = '/images/la-citronelle-mauritian-thali.avif' WHERE image = '/images/copy-of-dsc-0679.avif';
UPDATE restaurants SET image = '/images/la-citronelle-mauritian-thali.avif' WHERE image = '/images/copy-of-dsc-0679.avif';
UPDATE restaurant_gallery SET src = '/images/vip-ultimate-buggy-coloured-earth.avif' WHERE src = '/images/frame-1872-1.avif';
UPDATE package_tiers SET image = '/images/vip-ultimate-buggy-coloured-earth.avif' WHERE image = '/images/frame-1872-1.avif';
UPDATE gallery_shots SET src = '/images/vip-ultimate-buggy-coloured-earth.avif' WHERE src = '/images/frame-1872-1.avif';
UPDATE experiences SET image = '/images/vip-ultimate-buggy-coloured-earth.avif' WHERE image = '/images/frame-1872-1.avif';
UPDATE restaurants SET image = '/images/vip-ultimate-buggy-coloured-earth.avif' WHERE image = '/images/frame-1872-1.avif';
