-- Run once in the Supabase SQL editor.

-- 1. Let the app see paused/completed studies (not just active) so the
--    status chip reflects dashboard changes. Drafts stay hidden.
DROP POLICY IF EXISTS "Anon can read studies" ON studies;
CREATE POLICY "Anon can read studies" ON studies FOR SELECT
  USING (auth.role() = 'anon' AND status IN ('active', 'paused', 'completed'));

-- 2. Notification removal tracking (app no longer sends title).
--    Opened notifications = removal_reason 'clicked'; removed_at is the open time.
ALTER TABLE data_notifications ADD COLUMN IF NOT EXISTS removal_reason TEXT;
-- removal_reason: clicked | dismissed | app_cancel | timeout | listener_cancel | blocked | other

-- Optional: purge previously collected titles / SMS body hashes
-- UPDATE data_notifications SET title = NULL WHERE title IS NOT NULL;
-- UPDATE data_sms SET body_hash = NULL WHERE body_hash IS NOT NULL;
