-- 033: Giant Swing rates and wording from the owner (2026-11-05): Rs 700 resident,
-- Rs 850 visitor, and no ride count — it swings like a pendulum until it comes to
-- rest. Each update only rewrites the old 029 value, so later edits are kept.

UPDATE experiences SET price_nr = 850
WHERE id = 'giantswing' AND price_nr = 700;

UPDATE experiences
SET blurb = 'A giant pendulum high above the valley: strap in, lift off and swing until it comes to rest.'
WHERE id = 'giantswing' AND blurb = 'Two giant arcs high above the valley: strap in, lift off and swing out over the hills.';

UPDATE experience_facts SET text = 'Swings like a pendulum until it comes to rest'
WHERE experience_id = 'giantswing' AND text = 'Two rides per ticket';

UPDATE price_list SET label = 'Giant Swing', nr = 850
WHERE group_key = 'giantswing' AND label = 'Giant Swing · 2 rides';

UPDATE experience_galleries
SET eyebrow = 'THE GIANT SWING · PENDULUM RIDE',
    copy = 'Strap into the seat, rise high above the platform and let go: the swing arcs out over the treetops like a pendulum until gravity brings it to rest, with the whole valley below your feet.'
WHERE experience_id = 'giantswing' AND eyebrow = 'THE GIANT SWING · 2 RIDES PER TICKET';

-- Expo deal contents: the swing has no ride count
UPDATE products SET contents = array_replace(contents, 'Giant Swing (1 ride)', 'Giant Swing')
WHERE family = 'expo' AND 'Giant Swing (1 ride)' = ANY(contents);
