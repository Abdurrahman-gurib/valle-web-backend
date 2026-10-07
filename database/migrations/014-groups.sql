-- 014: group and school bookings. Idempotent.
--  * a booking can be a group: school / company / club / other, with the
--    organisation, the leader, the participant list and a deposit amount
--  * the leader signs one waiver pack for the listed participants
--  * the student price list becomes bookable per head (products student:<n>)
--  * group_deposit_percent: share of the total asked as a deposit (default 30)

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS group_kind     text CHECK (group_kind IN ('school','company','club','other'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS organisation   text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS leader_name    text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS participants   jsonb NOT NULL DEFAULT '[]';   -- [{name, age}]
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_amount int  NOT NULL DEFAULT 0;

ALTER TABLE waivers ADD COLUMN IF NOT EXISTS group_participants jsonb;                       -- names the leader signed for

INSERT INTO settings (key, value) VALUES ('group_deposit_percent', '30') ON CONFLICT (key) DO NOTHING;

INSERT INTO products (key, family, name, mode, price_rr, price_nr, dbl_rr, dbl_nr, rate_only, image, note, sort_order)
SELECT 'student:' || sort_order, 'student', label, 'pp', rr, COALESCE(NULLIF(nr, 0), rr), NULL, NULL, NULL, '', 'School groups · per student', 500 + sort_order
FROM price_list WHERE group_key = 'student'
ON CONFLICT (key) DO NOTHING;

-- parties up to 400 for groups (the API keeps 12 for ordinary bookings)
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_adults_check;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_kids_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_adults_check CHECK (adults BETWEEN 0 AND 400);
ALTER TABLE bookings ADD CONSTRAINT bookings_kids_check CHECK (kids BETWEEN 0 AND 400);
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_check CHECK (adults + kids >= 1);
