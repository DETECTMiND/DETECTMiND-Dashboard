-- ============================================================
-- Fix: phone-usage summary views (screen_sessions / daily_usage /
--      hourly_usage) produced inflated and mis-bucketed numbers.
-- ============================================================
--
-- Problems fixed
-- --------------
-- 1. Double-counted boundary events. The app logs a wake as two events
--    (ACTION_SCREEN_ON -> 'on', then ACTION_USER_PRESENT -> 'unlocked')
--    and a sleep as two events ('off' then 'locked'). The old
--    screen_sessions opened a session on EVERY 'on'/'unlocked' event and
--    closed it at the very next event of any kind, so the normalisation
--    was fragile and spurious zero / overlapping sessions crept in.
--
-- 2. Phantom 2-hour sessions. When a closing event was missing (the app
--    was killed before logging 'off' -- routine on Android), a session was
--    capped at 7200s. A day with several such gaps accumulated hours of
--    fictional screen time attributed to the wrong hour and day. This is
--    what made totals look too high, days look wrong, and the daily total
--    disagree with the sum of the hourly cells.
--
-- 3. daily_usage and hourly_usage computed screen time independently, so a
--    session spanning midnight (or any dropped-event case) made the daily
--    figure differ from the sum of that day's hourly cells.
--
-- Approach
-- --------
-- * Collapse the raw stream to clean on/off transitions: 'unlocked' counts
--   as 'on', 'locked' counts as 'off', then consecutive duplicates are
--   dropped so one wake = one 'on' and one sleep = one 'off'.
-- * A session runs from an 'on' to the NEXT 'off'. A missing 'off' is
--   capped at 30 minutes (SESSION_GAP_CAP), not 2 hours -- a dropped close
--   can no longer manufacture hours of usage.
-- * hourly_usage splits each session at local hour boundaries. daily_usage
--   is rolled up FROM hourly_usage, so the daily total is, by construction,
--   exactly the sum of that day's hourly cells.
--
-- Timezone
-- --------
-- Day boundaries and hour-of-day are bucketed in a single fixed zone,
-- returned by app_tz(). Change the one string there to re-bucket every
-- view. Set to the study population's local zone.
-- ============================================================

-- One place to set the bucketing timezone.
CREATE OR REPLACE FUNCTION app_tz() RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 'Europe/London' $$;

-- ── screen_sessions ──────────────────────────────────────────────────────────
-- Clean on->off sessions. was_capped = the close was missing/too long and the
-- duration was clamped to 30 min.
DROP VIEW IF EXISTS daily_usage CASCADE;
DROP VIEW IF EXISTS hourly_usage CASCADE;
DROP VIEW IF EXISTS screen_sessions CASCADE;

CREATE VIEW screen_sessions
WITH (security_invoker = on) AS
WITH normalized AS (
    SELECT
        participant_id,
        recorded_at::timestamptz AS ts,
        CASE WHEN state IN ('on', 'unlocked') THEN 'on' ELSE 'off' END AS dir
    FROM data_screen_state
    WHERE state IN ('on', 'off', 'locked', 'unlocked')
),
-- Drop consecutive same-direction events (on,unlocked -> one on; off,locked ->
-- one off) so each wake and each sleep is a single transition.
deduped AS (
    SELECT participant_id, ts, dir
    FROM (
        SELECT
            participant_id, ts, dir,
            LAG(dir) OVER (PARTITION BY participant_id ORDER BY ts) AS prev_dir
        FROM normalized
    ) t
    WHERE prev_dir IS DISTINCT FROM dir
),
with_next AS (
    SELECT
        participant_id,
        ts AS start_ts,
        LEAD(ts)  OVER (PARTITION BY participant_id ORDER BY ts) AS next_ts,
        LEAD(dir) OVER (PARTITION BY participant_id ORDER BY ts) AS next_dir
    FROM deduped
    WHERE dir = 'on'
)
SELECT
    participant_id,
    start_ts,
    -- End at the paired 'off'. If the next event is missing or is not an 'off'
    -- (another 'on' slipped through), or the gap is implausibly long, clamp the
    -- session to 30 minutes instead of inventing hours of usage.
    CASE
        WHEN next_dir = 'off'
             AND next_ts IS NOT NULL
             AND next_ts - start_ts <= interval '30 minutes'
        THEN next_ts
        ELSE start_ts + interval '30 minutes'
    END AS end_ts,
    LEAST(
        COALESCE(EXTRACT(EPOCH FROM (next_ts - start_ts)), 1800),
        1800
    )::bigint AS session_seconds,
    (next_dir IS DISTINCT FROM 'off'
     OR next_ts IS NULL
     OR next_ts - start_ts > interval '30 minutes') AS was_capped
FROM with_next;

-- ── hourly_usage ─────────────────────────────────────────────────────────────
-- Each session split across the local hours it spans. This is the single source
-- of truth for screen-on time; daily_usage rolls up from it.
CREATE VIEW hourly_usage
WITH (security_invoker = on) AS
WITH bounded AS (
    SELECT participant_id, start_ts, end_ts
    FROM screen_sessions
    WHERE end_ts > start_ts
),
hour_buckets AS (
    SELECT
        participant_id,
        start_ts,
        end_ts,
        generate_series(
            date_trunc('hour', start_ts AT TIME ZONE app_tz()) AT TIME ZONE app_tz(),
            date_trunc('hour', end_ts   AT TIME ZONE app_tz()) AT TIME ZONE app_tz(),
            interval '1 hour'
        ) AS hour_start
    FROM bounded
)
SELECT
    participant_id,
    hour_start AS usage_hour,
    (hour_start AT TIME ZONE app_tz())::date       AS usage_date,
    EXTRACT(HOUR FROM hour_start AT TIME ZONE app_tz())::int AS hour_of_day,
    SUM(EXTRACT(EPOCH FROM (
        LEAST(end_ts, hour_start + interval '1 hour')
        - GREATEST(start_ts, hour_start)
    )))::bigint AS screen_on_seconds
FROM hour_buckets
GROUP BY participant_id, hour_start
HAVING SUM(EXTRACT(EPOCH FROM (
    LEAST(end_ts, hour_start + interval '1 hour')
    - GREATEST(start_ts, hour_start)
))) > 0;

-- ── daily_usage ──────────────────────────────────────────────────────────────
-- Screen time rolled up from hourly_usage (so daily == sum of hourly cells).
-- Session count and capped count come from screen_sessions keyed on the session
-- START day; unlocks come from the raw 'unlocked' events.
CREATE VIEW daily_usage
WITH (security_invoker = on) AS
WITH hourly AS (
    SELECT
        participant_id,
        usage_date,
        SUM(screen_on_seconds) AS screen_on_seconds
    FROM hourly_usage
    GROUP BY participant_id, usage_date
),
sessions AS (
    SELECT
        participant_id,
        (start_ts AT TIME ZONE app_tz())::date AS usage_date,
        COUNT(*)                                    AS session_count,
        AVG(session_seconds)                        AS avg_session_seconds,
        SUM(CASE WHEN was_capped THEN 1 ELSE 0 END) AS capped_sessions
    FROM screen_sessions
    GROUP BY 1, 2
),
unlocks AS (
    SELECT
        participant_id,
        (recorded_at::timestamptz AT TIME ZONE app_tz())::date AS usage_date,
        COUNT(*) AS unlock_count
    FROM data_screen_state
    WHERE state = 'unlocked'
    GROUP BY 1, 2
)
SELECT
    h.participant_id,
    h.usage_date,
    h.screen_on_seconds                             AS screen_on_seconds,
    ROUND(h.screen_on_seconds / 60.0, 1)            AS screen_on_minutes,
    ROUND(h.screen_on_seconds / 3600.0, 2)          AS screen_on_hours,
    COALESCE(s.session_count, 0)                    AS session_count,
    ROUND(COALESCE(s.avg_session_seconds, 0) / 60.0, 1) AS avg_session_minutes,
    COALESCE(u.unlock_count, 0)                     AS unlock_count,
    COALESCE(s.capped_sessions, 0)                  AS capped_sessions
FROM hourly h
LEFT JOIN sessions s
    ON s.participant_id = h.participant_id AND s.usage_date = h.usage_date
LEFT JOIN unlocks u
    ON u.participant_id = h.participant_id AND u.usage_date = h.usage_date;

GRANT SELECT ON screen_sessions, daily_usage, hourly_usage TO authenticated;

-- ── Re-point the other daily views at app_tz() ───────────────────────────────
-- Same fixed zone as before, but centralised so every view buckets identically.

CREATE OR REPLACE VIEW daily_app_usage
WITH (security_invoker = on) AS
SELECT
    participant_id,
    (start_time::timestamptz AT TIME ZONE app_tz())::date AS usage_date,
    package_name,
    MAX(app_name)                          AS app_name,
    SUM(duration_seconds)                  AS foreground_seconds,
    ROUND(SUM(duration_seconds) / 60.0, 1) AS foreground_minutes,
    COUNT(*)                               AS open_count
FROM data_app_usage
GROUP BY participant_id, usage_date, package_name;

CREATE OR REPLACE VIEW daily_pickups
WITH (security_invoker = on) AS
SELECT
    participant_id,
    (recorded_at::timestamptz AT TIME ZONE app_tz())::date AS usage_date,
    EXTRACT(HOUR FROM recorded_at::timestamptz AT TIME ZONE app_tz())::int AS hour_of_day,
    COUNT(*) AS pickups
FROM data_screen_state
WHERE state = 'unlocked'
GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW daily_first_last_use
WITH (security_invoker = on) AS
WITH uses AS (
    SELECT
        participant_id,
        (recorded_at::timestamptz AT TIME ZONE app_tz())::date AS usage_date,
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
    to_char(MIN(ts) FILTER (WHERE state IN ('on', 'unlocked')) AT TIME ZONE app_tz(), 'HH24:MI') AS first_use_local,
    to_char(MAX(ts) FILTER (WHERE state IN ('off', 'locked'))  AT TIME ZONE app_tz(), 'HH24:MI') AS last_use_local
FROM uses
GROUP BY participant_id, usage_date;

CREATE OR REPLACE VIEW daily_notifications
WITH (security_invoker = on) AS
SELECT
    participant_id,
    (posted_at::timestamptz AT TIME ZONE app_tz())::date AS usage_date,
    COUNT(*)                                           AS notifications,
    COUNT(DISTINCT package_name)                       AS distinct_apps,
    COUNT(*) FILTER (WHERE removal_reason = 'clicked')  AS opened
FROM data_notifications
GROUP BY 1, 2;

CREATE OR REPLACE VIEW daily_battery_summary
WITH (security_invoker = on) AS
SELECT
    participant_id,
    (recorded_at::timestamptz AT TIME ZONE app_tz())::date AS usage_date,
    ROUND(AVG(level))::int                                     AS avg_level,
    MIN(level)                                                 AS min_level,
    MAX(level)                                                 AS max_level,
    ROUND(AVG(temperature)::numeric, 1)                        AS avg_temp_c,
    ROUND(100.0 * COUNT(*) FILTER (WHERE is_charging) / NULLIF(COUNT(*), 0), 0)::int AS pct_time_charging,
    COUNT(*)                                                   AS samples
FROM data_battery
GROUP BY 1, 2;

CREATE OR REPLACE VIEW daily_steps
WITH (security_invoker = on) AS
SELECT
    participant_id,
    (recorded_at::timestamptz AT TIME ZONE app_tz())::date AS usage_date,
    SUM(steps)  AS steps,
    COUNT(*)    AS samples
FROM data_steps
GROUP BY 1, 2;

GRANT SELECT ON daily_app_usage, daily_pickups, daily_first_last_use,
                daily_notifications, daily_battery_summary, daily_steps TO authenticated;
