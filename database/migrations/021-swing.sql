-- 021: the Swing at the waterfall becomes its own activity (it was only sold as a cinematic item).
-- Prices from the 2026 cinematic list: Rs 2,500, Rs 4,000 with the dress, same for every guest.
-- Idempotent: safe to run on every api pre-deploy (scripts/db-init.js).

INSERT INTO experiences (id, name, category_id, thrill, duration_label, age_label, base_price, price_mode, flat_label, image, blurb, detail, price_rr, price_nr, sort_order)
SELECT 'swing', 'The Waterfall Swing', 'adventure', 2, '30 MIN', 'ALL AGES', 2500, 'pp', NULL, '/images/shoot/cine-03.webp',
  'Swing out over the falls in a flowing dress while our photographer captures the shot of your trip.', NULL, 2500, 2500, 7
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE id = 'swing');

INSERT INTO experience_facts (experience_id, text, sort_order)
SELECT 'swing', x.t, x.o FROM (VALUES
  ('A rope swing above the cascade, harnessed and guided', 0),
  ('Flowing dress available for the photos (Rs 4,000 option)', 1),
  ('Pairs with a photo or cinematic package to keep the shots', 2)
) AS x(t, o) WHERE NOT EXISTS (SELECT 1 FROM experience_facts WHERE experience_id = 'swing');

INSERT INTO price_list (group_key, label, rr, nr, sort_order)
SELECT 'swing', x.l, x.p, x.p, x.o FROM (VALUES
  ('Swing Experience', 2500, 0),
  ('Swing Experience · with dress', 4000, 1)
) AS x(l, p, o) WHERE NOT EXISTS (SELECT 1 FROM price_list WHERE group_key = 'swing');

INSERT INTO experience_galleries (experience_id, eyebrow, t1, t2, copy, foot, cta)
VALUES ('swing', 'THE WATERFALL SWING · DRESS AVAILABLE', 'Swing over', 'the falls', 'A swing hung above the cascade, a flowing red dress if you want it, and a photographer on the rocks below. The picture everyone asks about.', 'ABOUT 30 MINUTES · ALL AGES · GUIDED', 'Add the swing to my day →')
ON CONFLICT (experience_id) DO NOTHING;

INSERT INTO gallery_shots (experience_id, src, tag, cap, pos, sort_order)
SELECT 'swing', x.s, x.tag, x.cap, NULL, x.o FROM (VALUES
  ('/images/shoot/cine-01.webp', 'THE SWING', 'Out over the falls.', 0),
  ('/images/shoot/cine-02.webp', 'THE DRESS', 'Red against the green and the water.', 1),
  ('/images/shoot/cine-04.webp', 'THE SPRAY', 'Close enough to feel it.', 2),
  ('/images/shoot/cine-05.webp', 'THE CASCADE', 'The falls behind every shot.', 3),
  ('/images/shoot/cine-06.webp', 'MID-SWING', 'Caught at the top of the arc.', 4)
) AS x(s, tag, cap, o) WHERE NOT EXISTS (SELECT 1 FROM gallery_shots WHERE experience_id = 'swing');
