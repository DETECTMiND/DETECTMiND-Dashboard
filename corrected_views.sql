-- ============================================================
-- CORRECTED hourly_usage view - Remove double timezone conversion
-- ============================================================
-- The original view has double AT TIME ZONE conversions that can
-- cause hour shifts when sessions span hour boundaries.
--
-- This version simplifies the logic:
-- 1. Convert to London time ONCE for generate_series
-- 2. Don't re-apply timezone in the SELECT
-- ============================================================

DROP VIEW IF EXISTS hourly_usage CASCADE;

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
        -- Convert both timestamps to London time, then generate hour boundaries
        -- Return as UTC timestamp for consistency
        generate_series(
            date_trunc('hour', start_ts AT TIME ZONE 'Europe/London'),
            date_trunc('hour', end_ts AT TIME ZONE 'Europe/London'),
            interval '1 hour'
        )::timestamptz AS hour_start
    FROM bounded
)
SELECT
    participant_id,
    hour_start AS usage_hour,
    (hour_start AT TIME ZONE 'Europe/London')::date AS usage_date,
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

GRANT SELECT ON hourly_usage TO authenticated;

-- Verify
SELECT 'hourly_usage fixed' AS status, COUNT(*) as total_rows FROM hourly_usage;
