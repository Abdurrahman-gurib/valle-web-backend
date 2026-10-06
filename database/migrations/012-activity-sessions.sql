-- 012: timed activity sessions. Idempotent.
--  * booking_lines.session_time: the start time ("10:30") the guest chose for
--    an experience that runs in sessions, null for unscheduled lines
--  * settings activity_sessions: { experienceId: { times: ["09:30", ...],
--    capacity: guests (or units) per session | null, durationMin } },
--    edited in the back office (Calendar & capacity)

ALTER TABLE booking_lines ADD COLUMN IF NOT EXISTS session_time text;
CREATE INDEX IF NOT EXISTS booking_lines_session_idx ON booking_lines(experience_id, session_time) WHERE session_time IS NOT NULL;
INSERT INTO settings (key, value) VALUES ('activity_sessions', '{}') ON CONFLICT (key) DO NOTHING;
