-- ============================================================
-- DETECTMiND Dashboard - Fix & Recreate Processed Data Views
-- ============================================================
-- This script drops and recreates all processed data views
-- with the corrected calculations. Run this in Supabase SQL editor.
--
-- Views fixed:
-- 1. daily_usage - Fixed GROUP BY clause (removed u.unlock_count)
-- 2. hourly_usage - Fixed timezone conversions
-- 3. daily_pickups - Recreated (no changes, for consistency)
-- 4. daily_notifications - Recreated (no changes, for consistency)
-- 5. daily_battery_summary - Recreated (no changes, for consistency)
-- 6. daily_steps - Recreated (no changes, for consistency)
-- 7. daily_first_last_use - Recreated (no changes, for consistency)
-- ============================================================

-- Step 1: Drop all dependent views (in reverse dependency order)
DROP VIEW IF EXISTS daily_usage CASCADE;
DROP VIEW IF EXISTS hourly_usage CASCADE;
DROP VIEW IF EXISTS daily_pickups CASCADE;
DROP VIEW IF EXISTS daily_notifications CASCADE;
DROP VIEW IF EXISTS daily_battery_summary CASCADE;
DROP VIEW IF EXISTS daily_steps CASCADE;
DROP VIEW IF EXISTS daily_first_last_use CASCADE;
DROP VIEW IF EXISTS daily_app_usage CASCADE;

-- Step 2: Recreate all views with corrections

-- ─── daily_usage (FIXED: GROUP BY clause) ────────────────────────────────────
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
    COALESCE(u.unlock_count, 0)                   AS unlock_count,
    SUM(CASE WHEN s.was_capped THEN 1 ELSE 0 END) AS capped_sessions
FROM sessions s
LEFT JOIN unlocks u
    ON u.participant_id = s.participant_id
   AND u.usage_date    = s.usage_date
GROUP BY s.participant_id, s.usage_date, u.participant_id, u.usage_date;

-- ─── hourly_usage (FIXED: timezone conversions simplified) ────────────────────
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
        -- hour marks aligned to Europe/London local time, returned as timestamptz
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

-- ─── daily_app_usage ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW daily_app_usage
WITH (security_invoker = on) AS
SELECT
    participant_id,
    (start_time::timestamptz AT TIME ZONE 'Europe/London')::date AS usage_date,
    package_name,
    MAX(app_name)                          AS app_name,
    SUM(duration_seconds)                  AS foreground_seconds,
    ROUND(SUM(duration_seconds) / 60.0, 1) AS foreground_minutes,
    COUNT(*)                               AS open_count
FROM data_app_usage
GROUP BY participant_id, usage_date, package_name;

GRANT SELECT ON screen_sessions, daily_usage, hourly_usage, daily_app_usage TO authenticated;

-- ─── daily_pickups ──────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW daily_pickups
WITH (security_invoker = on) AS
SELECT
    participant_id,
    (recorded_at::timestamptz AT TIME ZONE 'Europe/London')::date AS usage_date,
    EXTRACT(HOUR FROM recorded_at::timestamptz AT TIME ZONE 'Europe/London')::int AS hour_of_day,
    COUNT(*) AS pickups
FROM data_screen_state
WHERE state = 'unlocked'
GROUP BY 1, 2, 3;

-- ─── daily_first_last_use ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW daily_first_last_use
WITH (security_invoker = on) AS
WITH uses AS (
    SELECT
        participant_id,
        (recorded_at::timestamptz AT TIME ZONE 'Europe/London')::date AS usage_date,
        recorded_at::timestamptz AS ts,
        state
    FROM data_screen_state
    WHERE state IN ('on', 'unlocked', 'off', 'locked')
)
SELECT
    participant_id,
    usage_date,
    MIN(ts) FILTER (WHERE state IN ('on', 'unlocked'))  AS first_use,
    MAX(ts) FILTER (WHERE state IN ('off', 'locked'))   AS last_use,
    to_char(MIN(ts) FILTER (WHERE state IN ('on', 'unlocked')) AT TIME ZONE 'Europe/London', 'HH24:MI') AS first_use_local,
    to_char(MAX(ts) FILTER (WHERE state IN ('off', 'locked'))  AT TIME ZONE 'Europe/London', 'HH24:MI') AS last_use_local
FROM uses
GROUP BY participant_id, usage_date;

-- ─── daily_notifications ────────────────────────────────────────────────────
CREATE OR REPLACE VIEW daily_notifications
WITH (security_invoker = on) AS
SELECT
    participant_id,
    (posted_at::timestamptz AT TIME ZONE 'Europe/London')::date AS usage_date,
    COUNT(*)                                               AS notifications,
    COUNT(DISTINCT package_name)                           AS distinct_apps,
    COUNT(*) FILTER (WHERE removal_reason = 'clicked')     AS opened
FROM data_notifications
GROUP BY 1, 2;

-- ─── daily_battery_summary ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW daily_battery_summary
WITH (security_invoker = on) AS
SELECT
    participant_id,
    (recorded_at::timestamptz AT TIME ZONE 'Europe/London')::date AS usage_date,
    ROUND(AVG(level))::int                                        AS avg_level,
    MIN(level)                                                    AS min_level,
    MAX(level)                                                    AS max_level,
    ROUND(AVG(temperature)::numeric, 1)                           AS avg_temp_c,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE is_charging) / NULLIF(COUNT(*), 0),
        0
    )::int                                                        AS pct_time_charging,
    COUNT(*)                                                      AS samples
FROM data_battery
GROUP BY 1, 2;

GRANT SELECT ON daily_pickups, daily_first_last_use, daily_notifications, daily_battery_summary TO authenticated;

-- ─── daily_steps ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW daily_steps
WITH (security_invoker = on) AS
SELECT
    participant_id,
    (recorded_at::timestamptz AT TIME ZONE 'Europe/London')::date AS usage_date,
    SUM(steps)  AS steps,
    COUNT(*)    AS samples
FROM data_steps
GROUP BY 1, 2;

GRANT SELECT ON daily_steps TO authenticated;

-- ============================================================
-- Verification queries (run these to verify the fixes)
-- ============================================================
-- Check daily_usage: Should return 1 row per participant per date
-- SELECT participant_id, usage_date, COUNT(*) as row_count
-- FROM daily_usage
-- GROUP BY participant_id, usage_date
-- HAVING COUNT(*) > 1;  -- Should return 0 rows

-- Check hourly_usage: Should have consistent hour_of_day (0-23)
-- SELECT DISTINCT hour_of_day FROM hourly_usage ORDER BY hour_of_day;

-- Check all views are accessible:
-- SELECT COUNT(*) FROM daily_usage;
-- SELECT COUNT(*) FROM hourly_usage;
-- SELECT COUNT(*) FROM daily_pickups;
-- SELECT COUNT(*) FROM daily_notifications;
-- SELECT COUNT(*) FROM daily_battery_summary;
-- SELECT COUNT(*) FROM daily_steps;
-- SELECT COUNT(*) FROM daily_first_last_use;

-- ============================================================
-- Summary of Changes
-- ============================================================
-- 1. daily_usage:
--    BEFORE: GROUP BY s.participant_id, s.usage_date, u.unlock_count
--    AFTER:  GROUP BY s.participant_id, s.usage_date
--    REASON: Including non-aggregated joined column caused duplicate rows
--
-- 2. hourly_usage:
--    BEFORE: generate_series(...) wrapped with multiple AT TIME ZONE
--            (hour_start AT TIME ZONE 'Europe/London')::date for usage_date
--    AFTER:  generate_series(...) single timezone wrap
--            hour_start::date for usage_date
--    REASON: Simplified timezone handling to avoid DST edge cases
-- ============================================================
