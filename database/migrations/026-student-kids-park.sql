-- 026: Vallé Kids Park on the student price list (Kids Park student pricelist 2026):
-- Mini Quad, Roller Coaster Express, Mini Excavator and Pirate Ship at Rs 100 each
-- per student, and the Kids Park top-up card at Rs 50. Each line also becomes a
-- bookable school-group product (student:<sort_order>), like 014 did for the rest.
-- Idempotent: safe to run on every api pre-deploy (scripts/db-init.js).

INSERT INTO price_list (group_key, label, rr, nr, sort_order)
SELECT 'student', x.l, x.p, x.p, x.o FROM (VALUES
  ('Kids Park · Mini Quad', 100, 14),
  ('Kids Park · Roller Coaster Express', 100, 15),
  ('Kids Park · Mini Excavator', 100, 16),
  ('Kids Park · Pirate Ship', 100, 17),
  ('Kids Park · top-up card', 50, 18)
) AS x(l, p, o)
WHERE NOT EXISTS (SELECT 1 FROM price_list WHERE group_key = 'student' AND label = x.l)
ORDER BY x.o;  -- the catalog lists price rows by id, so insert them in display order

INSERT INTO products (key, family, name, mode, price_rr, price_nr, dbl_rr, dbl_nr, rate_only, image, note, sort_order)
SELECT 'student:' || sort_order, 'student', label, 'pp', rr, COALESCE(NULLIF(nr, 0), rr), NULL, NULL, NULL, '', 'School groups · per student', 500 + sort_order
FROM price_list WHERE group_key = 'student' AND label LIKE 'Kids Park · %'
ON CONFLICT (key) DO NOTHING;
