-- 027: Expo deals and the Le Chamouzé kids menu. Idempotent: safe to run on every
-- api pre-deploy (scripts/db-init.js); a second run inserts nothing.
--
-- 1. Expo deals (flyer "VALLÉ PL - RP, Expo deals", as sold at the Tribeca expo):
--    four per-person packages at the resident rate only, valid 23 Oct 2026 to
--    15 Jan 2027, park entrance included. Products get four nullable columns:
--      was_price   the struck-through "was" price (per person)
--      contents    what the package includes, in display order
--      valid_from  first visit date the product can be booked for (inclusive)
--      valid_to    last visit date the product can be booked for (inclusive)
--    The booking engine refuses a product outside its window and charges no
--    park entry when an expo deal is in the booking (pricing.ts).
-- 2. Kids menu at Le Chamouzé: a menu group with allergen codes per item
--    (menu_items.allergens, e.g. 'GL,LACT') and a group note for what is
--    included (menu_groups.note / note_allergens). It replaces the single
--    "Kids Menu" line the starters carried.

ALTER TABLE products ADD COLUMN IF NOT EXISTS was_price  int;
ALTER TABLE products ADD COLUMN IF NOT EXISTS contents   text[];
ALTER TABLE products ADD COLUMN IF NOT EXISTS valid_from date;
ALTER TABLE products ADD COLUMN IF NOT EXISTS valid_to   date;

INSERT INTO products (key, family, name, mode, price_rr, price_nr, dbl_rr, dbl_nr, rate_only, image, note, sort_order, was_price, contents, valid_from, valid_to)
SELECT x.k, 'expo', x.n, 'pp', x.p, x.p, NULL, NULL, 'rr', x.img, 'Expo deal · resident rate · per person', x.o, x.w, x.c, DATE '2026-10-23', DATE '2027-01-15'
FROM (VALUES
  ('expo:go',    'GO-PACKAGE',    1975, 3225, 600, '/images/shoot/cine-03.webp',
    ARRAY['Giant Swing (1 ride)', 'Mountain Luge Kart (1 ride)', 'Nepalese Bridge', 'The Plunge Zipline (500 m)', 'Free entrance']),
  ('expo:plus',  'PLUS-PACKAGE',  2175, 3025, 601, '/images/map/zip-selfie-cheer.webp',
    ARRAY['Mountain Luge Kart (1 ride)', 'Waterfall Zipline (300 m · 2 lines)', 'Group Expedition', 'Free entrance']),
  ('expo:pro',   'PRO-PACKAGE',   3000, 3900, 602, '/images/quadbuggy.avif',
    ARRAY['The Discovery Tour (1.6 km · 7 lines)', 'Giant Swing (1 ride)', 'Mountain Luge Kart (1 ride)', 'Free entrance']),
  ('expo:elite', 'ELITE-PACKAGE', 3700, 5150, 603, '/images/vip-ultimate-buggy-coloured-earth.avif',
    ARRAY['Giant Swing (1 ride)', 'Nepalese Bridge', 'Mountain Luge Kart (1 ride)', 'Quad Adventure (1 h)', 'Free entrance'])
) AS x(k, n, p, w, o, img, c)
ORDER BY x.o
ON CONFLICT (key) DO NOTHING;

ALTER TABLE menu_items  ADD COLUMN IF NOT EXISTS allergens      text NOT NULL DEFAULT '';
ALTER TABLE menu_groups ADD COLUMN IF NOT EXISTS note           text NOT NULL DEFAULT '';
ALTER TABLE menu_groups ADD COLUMN IF NOT EXISTS note_allergens text NOT NULL DEFAULT '';

INSERT INTO menu_groups (restaurant_id, title, sort_order, note, note_allergens)
SELECT 'chamouze', 'KIDS MENU', COALESCE((SELECT MAX(sort_order) + 1 FROM menu_groups WHERE restaurant_id = 'chamouze'), 0),
       'Desserts included: 2 scoops of ice cream', 'LACT'
WHERE EXISTS (SELECT 1 FROM restaurants WHERE id = 'chamouze')
  AND NOT EXISTS (SELECT 1 FROM menu_groups WHERE restaurant_id = 'chamouze' AND title = 'KIDS MENU');

INSERT INTO menu_items (group_id, name, note, price_label, sort_order, allergens)
SELECT g.id, x.n, x.note, 'Rs 600', x.o, x.al
FROM menu_groups g
CROSS JOIN (VALUES
  ('Chicken burger', 'Chicken patty, soft bun, fries', 'GL', 0),
  ('Chicken farfalle pasta', 'Creamy chicken or tomato sauce', 'GL,LACT', 1),
  ('Chicken skewers', 'Chicken sticks, fries, salad', 'GL', 2)
) AS x(n, note, al, o)
WHERE g.restaurant_id = 'chamouze' AND g.title = 'KIDS MENU'
  AND NOT EXISTS (SELECT 1 FROM menu_items i WHERE i.group_id = g.id)
ORDER BY x.o;

-- a database seeded from a newer data.json has the group but not the new columns' values
UPDATE menu_groups SET note = 'Desserts included: 2 scoops of ice cream', note_allergens = 'LACT'
WHERE restaurant_id = 'chamouze' AND title = 'KIDS MENU' AND note = '';
UPDATE menu_items i SET allergens = x.al
FROM menu_groups g, (VALUES ('Chicken burger', 'GL'), ('Chicken farfalle pasta', 'GL,LACT'), ('Chicken skewers', 'GL')) AS x(n, al)
WHERE i.group_id = g.id AND g.restaurant_id = 'chamouze' AND g.title = 'KIDS MENU' AND i.name = x.n AND i.allergens = '';

-- the old one-line kids menu among the starters is superseded by the group above
DELETE FROM menu_items i USING menu_groups g
WHERE i.group_id = g.id AND g.restaurant_id = 'chamouze' AND g.title = 'STARTERS'
  AND i.name = 'Kids Menu' AND i.note = 'Chicken burger, penne or fish beignet';
