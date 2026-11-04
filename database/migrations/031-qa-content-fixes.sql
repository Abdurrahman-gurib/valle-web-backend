-- 031: content fixes from the QA rounds (November 2026).
--   * Activity galleries: the foot lines carried hard-coded "FROM RS ..." prices,
--     which were resident prices shown to every visitor (and the buggy's
--     Rs 3,200 was not a price on the 2026 list at all). Prices now come only
--     from the price list at the guest's rate; the foot keeps the rules.
--   * Le Chamouzé: "Set menus from Rs 700 to Rs 4,250" contradicted the menus
--     on the page (package menus Rs 2,700 to Rs 26,500). The labels now say what
--     the menu shows: package menus from Rs 2,700 per person.
--   * Senior packages (owner, Nov 2026): one price for every guest aged 55 and
--     above, resident or visiting (the official sheet has one price, Rs 1,100 /
--     Rs 1,500). The products are no longer resident-only; the visitor price is
--     the resident price. Package 1's photo showed a child with a tortoise: it
--     now shows adults on foot at the waterfall trail.
--   * Bonding Roller Coaster Zipline: its default meeting point on the ticket
--     was the park entrance (pin A); it is a Kids Park ride, like the Pirate Ship
--     (pin I). Only the default is replaced: a point the desk has set is kept.
-- Idempotent: every change is guarded by the old value, so a second run (or a
-- row staff edited since) changes nothing.

-- 1. gallery foot lines without prices
UPDATE experience_galleries SET foot = 'DRIVER 16+ WITH LICENCE · HELMETS PROVIDED'
WHERE experience_id = 'buggy' AND foot = 'FROM RS 3,200 PER BUGGY · DRIVER 16+ WITH LICENCE · HELMETS PROVIDED';

UPDATE experience_galleries SET foot = 'DRIVING LICENCE REQUIRED · HELMETS PROVIDED'
WHERE experience_id = 'quad' AND foot = 'FROM RS 2,800 · DRIVING LICENCE REQUIRED · HELMETS PROVIDED';

UPDATE experience_galleries SET foot = '1, 2 OR 3 RIDES · ADULTS AND KIDS FROM 6'
WHERE experience_id = 'luge' AND foot = 'FROM RS 500 · 1, 2 OR 3 RIDES · ADULTS AND KIDS FROM 6';

-- 2. Le Chamouzé price labels, in line with its menus
UPDATE restaurants
SET price_label = 'Package menus from Rs 2,700',
    detail = 'Package menus from Rs 2,700 per person · à la carte and a kids menu · vegetarian options · the only restaurant in Mauritius where a zipline crosses the view.',
    updated_at = now()
WHERE id = 'chamouze'
  AND price_label = 'Menus Rs 700 – 4,250'
  AND detail = 'Set menus from Rs 700 to Rs 4,250 · vegetarian options · the only restaurant in Mauritius where a zipline crosses the view.';

-- 3. senior packages: open to visitors aged 55+ at the same price
UPDATE products
SET rate_only = NULL,
    price_nr = price_rr,
    dbl_nr = dbl_rr
WHERE family = 'senior'
  AND (rate_only IS NOT NULL OR price_nr IS DISTINCT FROM price_rr OR dbl_nr IS DISTINCT FROM dbl_rr);

UPDATE products SET image = '/images/valle-waterfall-nature-trail-mauritius.avif'
WHERE key = 'pkg:senior:0' AND image = '/images/trail-tortoise.webp';

UPDATE package_tiers SET image = '/images/valle-waterfall-nature-trail-mauritius.avif', updated_at = now()
WHERE family = 'senior' AND sort_order = 0 AND image = '/images/trail-tortoise.webp';

-- 4. Bonding Roller Coaster Zipline meets at the Kids Park (pin I), like the other rides there
DO $$
BEGIN
  UPDATE settings
  SET value = jsonb_set(value::jsonb, '{bonding,meetingPoint}', '"Kids Park (pin I)"')::text
  WHERE key = 'activity_ops'
    AND jsonb_typeof(value::jsonb -> 'bonding') = 'object'
    AND value::jsonb #>> '{bonding,meetingPoint}' = 'Park Entrance & Reception (pin A)';
EXCEPTION WHEN invalid_text_representation THEN
  RAISE WARNING '031: activity_ops is not valid JSON, left unchanged';
END $$;
