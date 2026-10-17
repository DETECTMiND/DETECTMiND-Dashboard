-- Allow the Android app (anon key) to upload gesture pause/resume events.
-- supabase_schema.sql already declares this policy, but the live database was
-- created without it, so app uploads to data_gesture_pauses were rejected by RLS.
-- Safe to re-run.

DROP POLICY IF EXISTS "Anon can insert sensor data" ON data_gesture_pauses;
CREATE POLICY "Anon can insert sensor data" ON data_gesture_pauses FOR INSERT WITH CHECK (auth.role() = 'anon');
