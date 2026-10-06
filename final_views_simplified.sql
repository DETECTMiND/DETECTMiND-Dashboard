-- ============================================================
-- FINAL SIMPLIFIED VIEWS - Database timezone set to Europe/London
-- ============================================================
-- Since the database timezone is already Europe/London,
-- we can remove ALL AT TIME ZONE conversions.
-- Much simpler, faster, and no timezone bugs!
-- ============================================================

DROP VIEW IF EXISTS daily_usage CASCADE;
DROP VIEW IF EXISTS hourly_usage CASCADE;

-- ─── daily_usage - SIMPLIFIED (no timezone needed) ────────────────────
CREATE OR REPLACE VIEW daily_usage
WITH (security_invoker = on) AS
WITH sessions AS (
    SELECT
        participant_id,
        start_ts::date AS usage_date,
        session_seconds,
        was_capped
    FROM screen_sessions
),
unlocks AS (
    SELECT
        participant_id,
        recorded_at::date AS usage_date,
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

-- ─── hourly_usage - SIMPLIFIED (no timezone needed) ──────────────────
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
        -- Generate hour boundaries in database's local time (Europe/London)
        generate_series(
            date_trunc('hour', start_ts),
            date_trunc('hour', end_ts),
            interval '1 hour'
        ) AS hour_start
    FROM bounded
)
SELECT
    participant_id,
    hour_start AS usage_hour,
    hour_start::date AS usage_date,
    EXTRACT(HOUR FROM hour_start)::int AS hour_of_day,
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

-- Grant permissions
GRANT SELECT ON daily_usage, hourly_usage TO authenticated;

-- Verify
SELECT 'daily_usage' AS view_name, COUNT(*) as total_rows FROM daily_usage
UNION ALL
SELECT 'hourly_usage' AS view_name, COUNT(*) as total_rows FROM hourly_usage;
