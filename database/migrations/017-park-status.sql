-- 017: park status. Idempotent.
--  The desk sets open / partial / closed and which activities are paused;
--  the site banner, the ticket, the activity pages and the evening reminder read it.
INSERT INTO settings (key, value) VALUES ('park_status', '{"state":"open","message":"","pausedActivities":[]}') ON CONFLICT (key) DO NOTHING;
