-- Pricelist 2026 alignment (Valle Docs / Price package valle, 1 July 2026 - 30 June 2027).
-- Idempotent: every statement is guarded, so db-init may re-run it on each deploy.

-- 1. Package families beyond Light/Standard and Exclusive.
ALTER TABLE package_tiers DROP CONSTRAINT IF EXISTS package_tiers_family_check;
ALTER TABLE package_tiers ADD CONSTRAINT package_tiers_family_check
  CHECK (family IN ('ls','ex','diamond','resident','senior'));

-- 2. Exclusive tiers: the zipline each tier includes (item 4 on the printed sheet).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('Bronze',   'Waterfall Zipline (300 m, 2 lines)'),
      ('Silver',   'The Signature Zipline (1.5 km)'),
      ('Gold',     'Sky Pulse Tour (3.1 km, 7 lines)'),
      ('Platinum', 'Advenature Flight (5.5 km, 11 lines)')
    ) AS v(tier, item)
  LOOP
    UPDATE package_tiers SET hero = r.item WHERE family = 'ex' AND name = r.tier;
    IF NOT EXISTS (SELECT 1 FROM package_tier_items i JOIN package_tiers t ON t.id = i.tier_id
                   WHERE t.family = 'ex' AND t.name = r.tier AND i.text = r.item) THEN
      UPDATE package_tier_items i SET sort_order = i.sort_order + 1
        FROM package_tiers t WHERE t.id = i.tier_id AND t.family = 'ex' AND t.name = r.tier AND i.sort_order >= 3;
      INSERT INTO package_tier_items (tier_id, text, sort_order)
        SELECT id, r.item, 3 FROM package_tiers WHERE family = 'ex' AND name = r.tier;
    END IF;
  END LOOP;
END $$;

-- 3. Add-ons as printed.
DELETE FROM package_addons;
INSERT INTO package_addons (text, price_label, sort_order) VALUES
  ('Bicycle Zipline (max 100 kg)', 'S Rs 1,150 · D Rs 2,300', 0),
  ('Stone-cooking lunch', 'S Rs 10,000 · D Rs 18,000', 1),
  ('Full-day cinematic video', 'Rs 20,000', 2),
  ('Swing Experience (with dress)', 'Rs 3,500', 3),
  ('Private guide (zipline & quad)', 'Rs 5,000', 4),
  ('Discovery Menu lunch', 'Rs 2,300 pp', 5);

-- 4. New package tiers (only when absent).
DO $$
DECLARE
  tid int;
  spec RECORD;
  i int;
  items text[];
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('diamond', 'Diamond', 'NR · SOUVENIR GIFT OFFERED', '#7333FF', '#FFFFFF', '/images/expedition-raptor-ocean.webp', 'Rs 120,000', 'Rs 149,000',
     'Non-resident rate. The double includes two GoPro rentals. A special souvenir gift is offered.', 'The whole valley, a hunting expedition and your own film', 0,
     ARRAY['Admission fee','Private guide & transfer + butler service','Exclusive Quad Adventure (1 hour)','Advenature Flight (5.5 km, 11 lines)','Bicycle Zipline (max 100 kg)','Mountain Luge Kart (3 rides)','Nepalese Bridge','Stone-cooking lunch at Le Chamouzé','The Peak','Snacks and beverages in any outlet','GoPro rental (full day) + photo','3-hour hunting expedition','Cinematic video of your complete day']),
    ('resident', 'Ventu Rush', NULL, '#33FF74', '#340057', '/images/luge-family.webp', 'Rs 1,700', '', NULL, 'Three classics in one afternoon', 0,
     ARRAY['Mountain Luge Kart (1 ride)','Nepalese Bridge','Bicycle Zipline']),
    ('resident', 'Triple Thrill', NULL, '#FFFC33', '#340057', '/images/zipline-waterfall.webp', 'Rs 2,025', '', NULL, 'Add the waterfall crossing', 1,
     ARRAY['Mountain Luge Kart (1 ride)','Nepalese Bridge OR Bicycle Zipline','Waterfall Zipline (300 m, 2 lines)']),
    ('resident', 'Adventure Lust', NULL, '#FF3358', '#FFFFFF', '/images/zipline-superman.webp', 'Rs 2,725', '', NULL, 'The Signature, 1.5 km across the valley', 2,
     ARRAY['Signature Zipline (1.5 km)','Nepalese Bridge OR Bicycle Zipline','Mountain Luge Kart (1 ride)']),
    ('resident', 'Elysian Escape', NULL, '#7333FF', '#FFFFFF', '/images/zipline-duo.webp', 'Rs 3,950', '', NULL, 'Seven lines plus every suspended thrill', 3,
     ARRAY['The Discovery Tour (1.6 km, 7 lines)','Nepalese Bridge','Bicycle Zipline','Mountain Luge Kart (1 ride)']),
    ('senior', 'Package 1', 'AGES 55 AND ABOVE', '#33FF74', '#340057', '/images/trail-tortoise.webp', 'Rs 1,100', '',
     'Lunch: rice, fish curry, chicken blanquette with vegetables, salad, ice cream, water and soft drinks. Veg options available.', 'A gentle day in the valley', 0,
     ARRAY['Entrance visit','Lunch','Tea break']),
    ('senior', 'Package 2', 'AGES 55 AND ABOVE', '#FFFC33', '#340057', '/images/expedition-guide-guests.webp', 'Rs 1,500', '',
     'Same lunch menu as Package 1. Veg options available.', 'See it all by jeep', 1,
     ARRAY['Visit by jeep (45 min)','Lunch','Tea break'])
  ) AS v(family, name, badge, color, fg, image, single_label, dbl_label, note, hero, sort_order, items)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM package_tiers WHERE family = spec.family AND name = spec.name) THEN
      INSERT INTO package_tiers (family, name, badge, color, fg, image, single_label, dbl_label, note, hero, sort_order)
        VALUES (spec.family, spec.name, spec.badge, spec.color, spec.fg, spec.image, spec.single_label, spec.dbl_label, spec.note, spec.hero, spec.sort_order)
        RETURNING id INTO tid;
      items := spec.items;
      FOR i IN 1 .. array_length(items, 1) LOOP
        INSERT INTO package_tier_items (tier_id, text, sort_order) VALUES (tid, items[i], i - 1);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- 5. Kids park rides at the printed rates (RR Rs 200 / NR Rs 300); the playground is part of the visit.
UPDATE experiences SET base_price = 200, price_rr = 200, price_nr = 300
  WHERE id IN ('pirate','bonding','coaster','miniquad','miniexc');
UPDATE experiences SET base_price = 0, price_mode = 'entry', price_rr = NULL, price_nr = NULL
  WHERE id = 'playground';

-- 6. Student and kids-park pricelists.
DELETE FROM price_list WHERE group_key IN ('student','kids');
INSERT INTO price_list (group_key, label, rr, nr, sort_order) VALUES
  ('student', 'Entrance fee · visit of the park', 200, 200, 0),
  ('student', 'Nepalese Bridge · 350 m', 375, 375, 1),
  ('student', 'Mountain Luge Kart · 1 ride', 325, 325, 2),
  ('student', 'Mountain Luge Kart · 2 rides', 475, 475, 3),
  ('student', 'Mountain Luge Kart · 3 rides', 750, 750, 4),
  ('student', 'Smallest Zipline · 190 m, min 20 pax', 200, 200, 5),
  ('student', 'The Plunge · 500 m', 500, 500, 6),
  ('student', 'The Waterfall Zipline', 550, 550, 7),
  ('student', 'Signature Zipline · 1.5 km', 800, 800, 8),
  ('student', 'The Discovery Tour Zipline · 1.6 km, 7 lines', 1000, 1000, 9),
  ('student', 'Sky Pulse Tour · 3.1 km, 7 lines', 2000, 2000, 10),
  ('student', 'Bicycle Zipline', 350, 350, 11),
  ('student', 'Lunch menu · 4 to 11 yrs', 250, 250, 12),
  ('student', 'Lunch menu · 12 yrs and over', 300, 300, 13),
  ('kids', 'Mini Quad', 200, 300, 0),
  ('kids', 'Roller Coaster Zipline', 200, 300, 1),
  ('kids', 'Roller Coaster Express', 200, 300, 2),
  ('kids', 'Mini Excavator', 200, 300, 3),
  ('kids', 'Pirate Ship', 200, 300, 4);
