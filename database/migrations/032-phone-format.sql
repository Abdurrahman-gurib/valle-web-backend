-- 032: the park phone in one format everywhere (+230 660 4477). Only rewrites the
-- old seeded spelling, so a number the team changed in settings is left alone.
UPDATE settings SET value = '+230 660 4477' WHERE key = 'phone' AND value = '+230 660 44 77';
