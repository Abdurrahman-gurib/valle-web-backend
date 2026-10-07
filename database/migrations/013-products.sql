-- 013: bookable products. Idempotent.
--  Packages, combos, VIP, photo and cinematic options were shown with price
--  labels only and reserved by WhatsApp. This gives each a numeric price the
--  booking engine can charge:
--    mode pp    price per person (kids pay the same)             resident / senior packages
--    mode pair  single (1 person) and double (2 persons) prices  LS / Exclusive / Diamond tiers, combos, VIP, photo tiers
--    mode flat  price per unit                                   cinematic items
--  rate_only limits a product to residents (rr) or visitors (nr); null = both.
--  Seeded once from the existing tables (labels like "Rs 11,100" parsed);
--  later edits are made in this table.

CREATE TABLE IF NOT EXISTS products (
  key        text PRIMARY KEY,
  family     text NOT NULL,                     -- ls | ex | diamond | resident | senior | combo | vip | photo | cine
  name       text NOT NULL,
  mode       text NOT NULL CHECK (mode IN ('pp','pair','flat')),
  price_rr   int  NOT NULL,                     -- per person, single, or per unit (residents)
  price_nr   int  NOT NULL,                     -- same for visitors
  dbl_rr     int,                               -- pair: two persons (residents)
  dbl_nr     int,
  rate_only  text CHECK (rate_only IN ('rr','nr')),
  image      text NOT NULL DEFAULT '',
  note       text NOT NULL DEFAULT '',
  sort_order int  NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true
);

ALTER TABLE booking_lines ADD COLUMN IF NOT EXISTS product_key text;

-- package tiers: LS / Exclusive / Diamond are per 1 or 2 persons; resident / senior are per person
INSERT INTO products (key, family, name, mode, price_rr, price_nr, dbl_rr, dbl_nr, rate_only, image, note, sort_order)
SELECT 'pkg:' || family || ':' || sort_order, family, name,
       CASE WHEN family IN ('resident','senior') THEN 'pp' ELSE 'pair' END,
       COALESCE(NULLIF(regexp_replace(single_label, '[^0-9]', '', 'g'), '')::int, 0),
       COALESCE(NULLIF(regexp_replace(single_label, '[^0-9]', '', 'g'), '')::int, 0),
       CASE WHEN family IN ('resident','senior') THEN NULL ELSE NULLIF(regexp_replace(dbl_label, '[^0-9]', '', 'g'), '')::int END,
       CASE WHEN family IN ('resident','senior') THEN NULL ELSE NULLIF(regexp_replace(dbl_label, '[^0-9]', '', 'g'), '')::int END,
       CASE WHEN family IN ('resident','senior') THEN 'rr' WHEN family = 'diamond' THEN 'nr' ELSE NULL END,
       image, COALESCE(note, ''), sort_order
FROM package_tiers
ON CONFLICT (key) DO NOTHING;

INSERT INTO products (key, family, name, mode, price_rr, price_nr, dbl_rr, dbl_nr, rate_only, image, note, sort_order)
SELECT 'combo:' || sort_order, 'combo', name, 'pair', rr_single, nr_single, rr_dbl, nr_dbl, NULL, '', '', 100 + sort_order
FROM combos
ON CONFLICT (key) DO NOTHING;

INSERT INTO products (key, family, name, mode, price_rr, price_nr, dbl_rr, dbl_nr, rate_only, image, note, sort_order)
SELECT 'cine:' || sort_order, 'cine', name, 'flat', price, price, NULL, NULL, NULL, '', '', 200 + sort_order
FROM cinematic_items
ON CONFLICT (key) DO NOTHING;

INSERT INTO products (key, family, name, mode, price_rr, price_nr, dbl_rr, dbl_nr, rate_only, image, note, sort_order)
SELECT 'photo:' || rate || ':' || sort_order, 'photo', name, 'pair',
       COALESCE(NULLIF(regexp_replace(single_label, '[^0-9]', '', 'g'), '')::int, 0),
       COALESCE(NULLIF(regexp_replace(single_label, '[^0-9]', '', 'g'), '')::int, 0),
       NULLIF(regexp_replace(dbl_label, '[^0-9]', '', 'g'), '')::int,
       NULLIF(regexp_replace(dbl_label, '[^0-9]', '', 'g'), '')::int,
       rate, '', activities_label, 300 + sort_order
FROM photo_tiers
ON CONFLICT (key) DO NOTHING;

INSERT INTO products (key, family, name, mode, price_rr, price_nr, dbl_rr, dbl_nr, rate_only, image, note, sort_order)
VALUES ('vip', 'vip', 'VIP Ultimate', 'pair', 49225, 49225, 75175, 75175, NULL, '/images/vip-ultimate-buggy-coloured-earth.avif', 'Advenature Flight, private guide, butler service', 400)
ON CONFLICT (key) DO NOTHING;
