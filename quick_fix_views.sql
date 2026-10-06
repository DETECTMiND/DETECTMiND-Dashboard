-- ============================================================
-- Quick Fix: Only recreate the two broken views
-- ============================================================
-- Run this in Supabase SQL editor if you only want to fix
-- the specific broken views without touching others.
--
-- Views fixed:
-- 1. daily_usage - Fixed GROUP BY clause
-- 2. hourly_usage - Fixed timezone conversions
-- ============================================================

-- Drop the two broken views
DROP VIEW IF EXISTS daily_usage CASCADE;
DROP VIEW IF EXISTS hourly_usage CASCADE;

-- Recreate daily_usage with correct GROUP BY
CREATE OR REPLACE VIEW daily_usage
WITH (security_invoker = on) AS
WITH sessions AS (
    SELECT
        participant_id,
        (start_ts AT TIME ZONE 'Europe/London')::date AS usage_date,
        session_seconds,
        was_capped
    FROM screen_sessions
),
unlocks AS (
    SELECT
        participant_id,
        (recorded_at::timestamptz AT TIME ZONE 'Europe/London')::date AS usage_date,
        COUNT(*) AS unlock_count
    FROM data_screen_state
    WHERE state = 'unlocked'
    GROUP BY 1, 2
)
SELECT
    s.participant_id,
    s.usage_date,
    SUM(s.session_seconds)                        AS screen_on_seconds,
    ROUND(SUM(s.session_seconds) / 60.0, 1)       AS screen_on_minutes,
    ROUND(SUM(s.session_seconds) / 3600.0, 2)     AS screen_on_hours,
    COUNT(*)                                      AS session_count,
    ROUND(AVG(s.session_seconds) / 60.0, 1)       AS avg_session_minutes,
    COALESCE(MAX(u.unlock_count), 0)              AS unlock_count,
    SUM(CASE WHEN s.was_capped THEN 1 ELSE 0 END) AS capped_sessions
FROM sessions s
LEFT JOIN unlocks u
    ON u.participant_id = s.participant_id
   AND u.usage_date    = s.usage_date
GROUP BY s.participant_id, s.usage_date;

-- Recreate hourly_usage with simplified timezone handling
CREATE OR REPLACE VIEW hourly_usage
WITH (security_invoker = on) AS
WITH bounded AS (
    SELECT
        participant_id,
        start_ts,
        start_ts + make_interval(secs => session_seconds) AS end_ts
    FROM screen_sessions
    WHERE session_seconds > 0
),
hour_buckets AS (
    SELECT
        participant_id,
        start_ts,
        end_ts,
        generate_series(
            date_trunc('hour', start_ts AT TIME ZONE 'Europe/London'),
            date_trunc('hour', end_ts   AT TIME ZONE 'Europe/London'),
            interval '1 hour'
        ) AS hour_start
    FROM bounded
)
SELECT
    participant_id,
    hour_start AS usage_hour,
    hour_start::date AS usage_date,
    EXTRACT(HOUR FROM hour_start AT TIME ZONE 'Europe/London')::int AS hour_of_day,
    SUM(
        EXTRACT(EPOCH FROM (
            LEAST(end_ts, hour_start + interval '1 hour')
            - GREATEST(start_ts, hour_start)
        ))
    )::bigint AS screen_on_seconds
FROM hour_buckets
GROUP BY participant_id, hour_start
HAVING SUM(
    EXTRACT(EPOCH FROM (
        LEAST(end_ts, hour_start + interval '1 hour')
        - GREATEST(start_ts, hour_start)
    ))
) > 0;

-- Grant permissions to authenticated users
GRANT SELECT ON daily_usage TO authenticated;
GRANT SELECT ON hourly_usage TO authenticated;

-- Verify the fixes
SELECT 'daily_usage fixed' AS status, COUNT(*) as total_rows FROM daily_usage
UNION ALL
SELECT 'hourly_usage fixed' AS status, COUNT(*) as total_rows FROM hourly_usage;
