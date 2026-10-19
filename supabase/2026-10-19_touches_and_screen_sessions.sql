-- 2026-10-19: gesture "touch" rows + screen_sessions fix
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Touches: NO schema change is needed. data_gestures.interaction_type only has
--   CHECK (interaction_type ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'), which already
--   accepts 'touch'; the data_gestures RLS insert policy and sync RPCs do not
--   look at interaction_type, and sensor_configs.config is free-form JSONB, so
--   interaction_types.touches needs nothing either.
--
-- screen_sessions: the still-open latest session now ends at the device's last
--   sync instead of being stretched 3 hours into the future. Same columns and
--   types as before, so CREATE OR REPLACE works and the dependent views
--   (hourly_usage, daily_usage, ...) pick it up automatically.

CREATE OR REPLACE VIEW screen_sessions
WITH (security_invoker = true) AS
WITH normalized AS (
    SELECT
        participant_id,
        recorded_at::timestamptz AS ts,
        id,
        CASE WHEN state IN ('on', 'unlocked') THEN 'on' ELSE 'off' END AS dir
    FROM data_screen_state
    WHERE state IN ('on', 'off', 'locked', 'unlocked')
),
-- Keep only direction CHANGES, so the stream strictly alternates on,off,on,off.
-- (id breaks ties when two events share a timestamp, keeping the order stable.)
deduped AS (
    SELECT participant_id, ts, dir
    FROM (
        SELECT
            participant_id, ts, dir,
            LAG(dir) OVER (PARTITION BY participant_id ORDER BY ts, id) AS prev_dir
        FROM normalized
    ) t
    WHERE prev_dir IS DISTINCT FROM dir
),
paired AS (
    SELECT
        participant_id,
        ts AS start_ts,
        dir,
        LEAD(ts)  OVER (PARTITION BY participant_id ORDER BY ts) AS next_ts,
        LEAD(dir) OVER (PARTITION BY participant_id ORDER BY ts) AS next_dir
    FROM deduped
),
-- The latest session has no close yet. It is known to run only up to the device's
-- last sync (the screen was still on when it uploaded), never 3 hours into the future.
closed AS (
    SELECT
        s.participant_id,
        s.start_ts,
        s.next_ts,
        COALESCE(s.next_ts,
                 LEAST(GREATEST(s.start_ts, p.last_sync_at), now())) AS close_ts
    FROM paired s
    LEFT JOIN participants p ON p.id = s.participant_id
    WHERE s.dir = 'on'
)
SELECT
    participant_id,
    start_ts,
    LEAST(COALESCE(close_ts, start_ts), start_ts + interval '3 hours') AS end_ts,
    (close_ts - start_ts > interval '3 hours') IS TRUE AS was_capped
FROM closed;
