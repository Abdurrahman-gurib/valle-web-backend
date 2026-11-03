-- 029: the Giant Swing (owner's data, 2026) and the gate's rider limits.
--   * New activity 'giantswing' (adventure): Rs 700 for 2 rides, same for residents
--     and visitors; riders from 12 years, 40 kg to 85 kg. Not the Waterfall Swing
--     ('swing', 021), which is a photo experience at the falls.
--   * experience_galleries gets an optional clip (video + poster still) that the
--     activity page plays muted in place of the lead photo.
--   * waiver_limits: the gate's weight / height checks for the Giant Swing and the
--     Kids Park rides (flyer: Pirate Ship and Roller Coaster Express from 1.2 m,
--     Bonding Roller Coaster Zipline up to 80 kg on the bicycle seat). Merged ONCE,
--     guarded by the marker row 'waiver_limits_029', so limits edited by staff
--     later are never overwritten on a deploy.
--   * Pirate Ship copy: riders are 12+ (028), so the blurb no longer talks about
--     the smallest buccaneers.
-- Idempotent: safe to run on every api pre-deploy (scripts/db-init.js); a second
-- run changes nothing.

ALTER TABLE experience_galleries ADD COLUMN IF NOT EXISTS video text;
ALTER TABLE experience_galleries ADD COLUMN IF NOT EXISTS video_poster text;

INSERT INTO experiences (id, name, category_id, thrill, duration_label, age_label, base_price, price_mode, flat_label, image, blurb, detail, price_rr, price_nr, sort_order)
SELECT 'giantswing', 'The Giant Swing', 'adventure', 4, '15 MIN', '12+', 700, 'pp', NULL, '/images/giant-swing/giant-swing-06.webp',
  'Two giant arcs high above the valley: strap in, lift off and swing out over the hills.', NULL, 700, 700, 21
WHERE NOT EXISTS (SELECT 1 FROM experiences WHERE id = 'giantswing');

INSERT INTO experience_facts (experience_id, text, sort_order)
SELECT 'giantswing', x.t, x.o FROM (VALUES
  ('Two rides per ticket', 0),
  ('Riders from 12 years', 1),
  ('Weight 40 kg to 85 kg', 2),
  ('Harnessed seat, helmet and briefing by our team', 3)
) AS x(t, o) WHERE NOT EXISTS (SELECT 1 FROM experience_facts WHERE experience_id = 'giantswing')
ORDER BY x.o;

INSERT INTO price_list (group_key, label, rr, nr, sort_order)
SELECT 'giantswing', 'Giant Swing · 2 rides', 700, 700, 0
WHERE NOT EXISTS (SELECT 1 FROM price_list WHERE group_key = 'giantswing');

INSERT INTO experience_galleries (experience_id, eyebrow, t1, t2, copy, foot, cta)
VALUES ('giantswing', 'THE GIANT SWING · 2 RIDES PER TICKET', 'Lift off,', 'swing out',
  'Strap into the seat, rise high above the platform and let go: two giant arcs out over the treetops, with the whole valley below your feet.',
  'ABOUT 15 MINUTES · RIDERS 12+ · 40 TO 85 KG', 'Add the Giant Swing to my day →')
ON CONFLICT (experience_id) DO NOTHING;

-- the owner's clip (19.5 s, no sound); also fills it in when the gallery came from the seed
UPDATE experience_galleries
SET video = '/images/giant-swing/giant-swing.mp4', video_poster = '/images/giant-swing/giant-swing-04.webp'
WHERE experience_id = 'giantswing' AND video IS NULL;

INSERT INTO gallery_shots (experience_id, src, tag, cap, pos, sort_order)
SELECT 'giantswing', x.s, x.tag, x.cap, NULL, x.o FROM (VALUES
  ('/images/giant-swing/giant-swing-03.webp', 'THE TOP', 'Feet up, nothing but sky.', 0),
  ('/images/giant-swing/giant-swing-04.webp', 'THE ARC', 'Out over the treetops.', 1),
  ('/images/giant-swing/giant-swing-01.webp', 'STRAPPED IN', 'Harness checked, helmet on.', 2),
  ('/images/giant-swing/giant-swing-02.webp', 'SIDE BY SIDE', 'Two swings: ride next to a friend.', 3),
  ('/images/giant-swing/giant-swing-05.webp', 'THE VALLEY', 'The whole swing, with the hills all around.', 4)
) AS x(s, tag, cap, o) WHERE NOT EXISTS (SELECT 1 FROM gallery_shots WHERE experience_id = 'giantswing')
ORDER BY x.o;  -- the catalog lists shots by id within a gallery's sort order

-- Gate limits: one-shot merge into the settings row (existing keys are kept).
INSERT INTO settings (key, value) VALUES ('waiver_limits', '{}')
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE key = 'waiver_limits_029') THEN
    BEGIN
      UPDATE settings
      SET value = (value::jsonb || '{"giantswing":{"minWeightKg":40,"maxWeightKg":85},"coaster":{"minHeightCm":120},"pirate":{"minHeightCm":120},"bonding":{"maxWeightKg":80}}'::jsonb)::text
      WHERE key = 'waiver_limits' AND jsonb_typeof(value::jsonb) = 'object';
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE WARNING '029: waiver_limits is not valid JSON, left unchanged';
    END;
    INSERT INTO settings (key, value) VALUES ('waiver_limits_029', 'applied')
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;

-- Pirate Ship: a 12+ ride now, so the copy speaks to older crews.
UPDATE experiences
SET blurb = 'All hands on deck: the ship swings higher with every pass, for buccaneers aged 12 and up.', updated_at = now()
WHERE id = 'pirate' AND blurb = 'Set sail on gentle thrills: pirate adventures for the smallest buccaneers.';
