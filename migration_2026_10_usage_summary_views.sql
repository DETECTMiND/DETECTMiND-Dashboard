-- Run once in the Supabase SQL editor.
-- Phone-usage summary views, computed live from the raw event streams the app
-- already uploads. No app change required. Views use security_invoker so they
-- respect the same RLS as the underlying tables (authenticated researchers only).
--
-- Sources:
--   data_screen_state (participant_id, state, recorded_at)  -> total phone usage
--   data_app_usage    (participant_id, package_name, app_name,
--                       start_time, end_time, duration_seconds, recorded_at) -> per-app
--
-- A screen-on "session" runs from an `on`/`unlocked` event to the next
-- `off`/`locked` event. GAP-CAP: if an `on` has no closing event before the next
-- `on` (a dropped event, e.g. the service was killed), the session is capped at
-- 2 hours so a missing event cannot inflate totals. Edit the two `7200` literals
-- to change the cap. Timestamps are bucketed in UTC — see note at the bottom to
-- switch to a study-local timezone.

-- 1. Screen-on sessions -------------------------------------------------------
CREATE OR REPLACE VIEW screen_sessions
WITH (security_invoker = on) AS
WITH normalized AS (
    SELECT
        participant_id,
        recorded_at::timestamptz AS ts,
        CASE WHEN state IN ('on', 'unlocked') THEN 'on' ELSE 'off' END AS dir
    FROM data_screen_state
    WHERE state IN ('on', 'off', 'locked', 'unlocked')
),
with_next AS (
    SELECT
        participant_id,
        ts AS start_ts,
        dir,
        LEAD(ts)  OVER (PARTITION BY participant_id ORDER BY ts) AS next_ts,
        LEAD(dir) OVER (PARTITION BY participant_id ORDER BY ts) AS next_dir
    FROM normalized
)
SELECT
    participant_id,
    start_ts,
    next_ts AS end_ts,
    LEAST(
        COALESCE(EXTRACT(EPOCH FROM (next_ts - start_ts)), 7200)::bigint,
        7200
    ) AS session_seconds,
    (next_dir IS DISTINCT FROM 'off'
     OR EXTRACT(EPOCH FROM (next_ts - start_ts)) > 7200
     OR next_ts IS NULL) AS was_capped
FROM with_next
WHERE dir = 'on';

-- 2. Daily usage per participant ---------------------------------------------
CREATE OR REPLACE VIEW daily_usage
WITH (security_invoker = on) AS
WITH sessions AS (
    SELECT
        participant_id,
        (start_ts AT TIME ZONE 'UTC')::date AS usage_date,
        session_seconds,
        was_capped
    FROM screen_sessions
),
unlocks AS (
    SELECT
        participant_id,
        (recorded_at::timestamptz AT TIME ZONE 'UTC')::date AS usage_date,
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
GROUP BY s.participant_id, s.usage_date, u.unlock_count;

-- 3. Hourly usage per participant --------------------------------------------
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
            date_trunc('hour', start_ts),
            date_trunc('hour', end_ts),
            interval '1 hour'
        ) AS hour_start
    FROM bounded
)
SELECT
    participant_id,
    hour_start AS usage_hour,
    (hour_start AT TIME ZONE 'UTC')::date AS usage_date,
    EXTRACT(HOUR FROM hour_start)::int    AS hour_of_day,
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

-- 4. Per-app daily usage (from UsageStatsManager feed) -----------------------
CREATE OR REPLACE VIEW daily_app_usage
WITH (security_invoker = on) AS
SELECT
    participant_id,
    (start_time::timestamptz AT TIME ZONE 'UTC')::date AS usage_date,
    package_name,
    MAX(app_name)                          AS app_name,
    SUM(duration_seconds)                  AS foreground_seconds,
    ROUND(SUM(duration_seconds) / 60.0, 1) AS foreground_minutes,
    COUNT(*)                               AS open_count
FROM data_app_usage
GROUP BY participant_id, usage_date, package_name;

-- Grants: dashboard reads as the authenticated role; security_invoker keeps the
-- underlying tables' RLS in force.
GRANT SELECT ON screen_sessions, daily_usage, hourly_usage, daily_app_usage TO authenticated;

-- Note on timezone: these views bucket by UTC. For a single study timezone,
-- replace `AT TIME ZONE 'UTC'` with e.g. `AT TIME ZONE 'Europe/London'`
-- (Postgres converts the stored UTC timestamp to that zone). Do not change the
-- session-pairing logic.
