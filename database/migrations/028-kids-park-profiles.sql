-- 028: Vallé Kids Park "Little Explorer's Profile" (owner's Kids Park flyer, 2026).
-- The flyer is the reference for who may ride what; where the catalog disagreed,
-- the flyer wins:
--   Outdoor Playground       age 3–12        -> 3–14
--   Mini Excavator           age 4–12        -> 5+ (minimum age 5)
--   Mini Quad                age 6–12        -> 7–16
--   Pirate Ship              age 3–12        -> 12+, fact "Minimum height 1.2 m"
--                            (replaces "Gentle swings suited to young kids")
--   Roller Coaster Express   fact "Height requirements apply" -> "Minimum height 1.2 m"
--   Bonding Roller Coaster   age 4+ with an adult (unchanged), new fact with the
--   Zipline                  weight limits: chair under 50 kg, bicycle under 80 kg
-- The age labels also feed the gate's waiver checks (waiver-rules parseAgeLabel).
-- Idempotent: safe to run on every api pre-deploy (scripts/db-init.js); a second
-- run changes nothing.

UPDATE experiences SET age_label = x.age
FROM (VALUES
  ('playground', '3–14'),
  ('miniexc',    '5+'),
  ('miniquad',   '7–16'),
  ('pirate',     '12+')
) AS x(id, age)
WHERE experiences.id = x.id AND experiences.age_label IS DISTINCT FROM x.age;

UPDATE experience_facts SET text = 'Minimum height 1.2 m'
WHERE experience_id = 'coaster' AND text = 'Height requirements apply';

UPDATE experience_facts SET text = 'Minimum height 1.2 m'
WHERE experience_id = 'pirate' AND text = 'Gentle swings suited to young kids';

INSERT INTO experience_facts (experience_id, text, sort_order)
SELECT 'bonding', 'Weight limit: chair under 50 kg, bicycle under 80 kg',
       COALESCE((SELECT MAX(sort_order) + 1 FROM experience_facts WHERE experience_id = 'bonding'), 0)
WHERE EXISTS (SELECT 1 FROM experiences WHERE id = 'bonding')
  AND NOT EXISTS (SELECT 1 FROM experience_facts WHERE experience_id = 'bonding' AND text LIKE 'Weight limit:%');
