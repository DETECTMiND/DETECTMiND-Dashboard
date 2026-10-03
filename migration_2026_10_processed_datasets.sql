-- Run once in the Supabase SQL editor (after migration_2026_10_usage_summary_views.sql).
-- Additional processed datasets for the Processed Data tab. All views use
-- security_invoker and bucket by Europe/London, consistent with the usage views.

-- 1. Daily pickups (unlock count) + hourly unlock distribution ----------------
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

-- 2. First and last phone use per day (sleep/wake proxy) ----------------------
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

-- 3. Daily notifications received ---------------------------------------------
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

-- 4. Daily battery summary ----------------------------------------------------
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
