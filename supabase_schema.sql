-- ============================================================
-- Research Data Collection App - Supabase Database Schema
-- ============================================================

-- Enable required extensions. Supabase keeps extension-owned objects outside
-- public so resetting the application schema does not orphan them.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = public, extensions;

-- ============================================================
-- CORE TABLES
-- ============================================================

-- Studies table
CREATE TABLE studies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    app_description TEXT, -- shown in the mobile app
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
    created_by UUID REFERENCES auth.users(id),
    config JSONB DEFAULT '{}', -- general study config
    sync_interval_minutes INT NOT NULL DEFAULT 30,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Participants (devices enrolled in studies)
CREATE TABLE participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL, -- unique device identifier from app
    label TEXT, -- researcher-assigned label
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_sync_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
    device_info JSONB DEFAULT '{}', -- OS version, model, app version
    permissions JSONB DEFAULT '{}', -- current permission states reported by app
    enrollment_request_id UUID UNIQUE, -- makes enrollment retries idempotent
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(study_id, device_id)
);

-- ============================================================
-- SENSOR CONFIGURATION (configurable from dashboard)
-- ============================================================

CREATE TABLE sensor_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    sensor_type TEXT NOT NULL CHECK (sensor_type IN (
        'app_usage', 'notifications', 'battery', 'calls', 'sms',
        'location', 'light', 'screen_state', 'gestures',
        'steps', 'proximity'
    )),
    enabled BOOLEAN NOT NULL DEFAULT true,
    interval_seconds INT, -- sampling interval (for location, light, battery)
    config JSONB DEFAULT '{}', -- sensor-specific config
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(study_id, sensor_type)
);

-- ============================================================
-- ESM/EMA CONFIGURATION
-- ============================================================

CREATE TABLE esm_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    schedule_type TEXT NOT NULL CHECK (schedule_type IN ('fixed', 'random')),
    times_of_day TEXT[], -- for fixed: ['09:00','12:00','18:00']
    random_count INT, -- for random: how many per day
    random_window_start TEXT, -- e.g. '08:00'
    random_window_end TEXT, -- e.g. '22:00'
    expiry_minutes INT DEFAULT 60, -- how long the notification stays
    notification_title TEXT DEFAULT 'Survey Available',
    notification_body TEXT DEFAULT 'Please complete the survey.',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE esm_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id UUID NOT NULL REFERENCES esm_schedules(id) ON DELETE CASCADE,
    question_order INT NOT NULL DEFAULT 0,
    question_type TEXT NOT NULL CHECK (question_type IN (
        'likert', 'text', 'number', 'single_choice', 'multi_choice', 'slider', 'yes_no', 'time', 'date'
    )),
    question_text TEXT NOT NULL,
    required BOOLEAN NOT NULL DEFAULT true,
    options JSONB, -- for choice types: ["option1","option2",...]
    config JSONB DEFAULT '{}', -- min/max for slider/number, scale for likert, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SENSOR DATA TABLES (one per sensor type)
-- ============================================================

-- 1. App Usage (screen usage per app)
CREATE TABLE data_app_usage (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    package_name TEXT NOT NULL,
    app_name TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_seconds INT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_app_usage_participant ON data_app_usage(participant_id, start_time);

-- 2. App Notifications
CREATE TABLE data_notifications (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    package_name TEXT NOT NULL,
    app_name TEXT,
    posted_at TIMESTAMPTZ NOT NULL,
    removed_at TIMESTAMPTZ,
    removal_reason TEXT, -- clicked | dismissed | app_cancel | timeout | listener_cancel | blocked | other
    title TEXT,          -- legacy, no longer collected
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_participant ON data_notifications(participant_id, posted_at);

-- 3. Battery
CREATE TABLE data_battery (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    level INT NOT NULL, -- 0-100
    is_charging BOOLEAN,
    charging_type TEXT, -- usb, ac, wireless
    temperature REAL,
    voltage REAL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_battery_participant ON data_battery(participant_id, recorded_at);

-- 4a. Phone Calls
CREATE TABLE data_calls (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing', 'missed')),
    event_time TIMESTAMPTZ NOT NULL,
    duration_seconds INT,
    contact_hash TEXT, -- hashed phone number for privacy
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_calls_participant ON data_calls(participant_id, event_time);

-- 4b. SMS
CREATE TABLE data_sms (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    event_time TIMESTAMPTZ NOT NULL,
    contact_hash TEXT, -- hashed phone number for privacy
    body_hash TEXT,    -- legacy, no longer collected
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_participant ON data_sms(participant_id, event_time);

-- 5. ESM/EMA Responses
CREATE TABLE data_esm_responses (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES esm_schedules(id) ON DELETE SET NULL,
    triggered_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    expired BOOLEAN DEFAULT false,
    responses JSONB, -- {question_id: answer, ...}
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_esm_responses_participant ON data_esm_responses(participant_id, triggered_at);

-- 6. Location
CREATE TABLE data_location (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    altitude DOUBLE PRECISION,
    accuracy REAL,
    speed REAL,
    provider TEXT, -- gps, network, fused
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_location_participant ON data_location(participant_id, recorded_at);

-- 7. Light Sensor
CREATE TABLE data_light (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    lux REAL NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_light_participant ON data_light(participant_id, recorded_at);

-- 8. Screen State (on/off/lock/unlock)
CREATE TABLE data_screen_state (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('on', 'off', 'locked', 'unlocked')),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_screen_state_participant ON data_screen_state(participant_id, recorded_at);

-- 9. User Gestures (accessibility events)
CREATE TABLE data_gestures (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    interaction_type TEXT NOT NULL CHECK (interaction_type IN ('TYPE_VIEW_SCROLLED', 'TYPE_VIEW_CLICKED', 'TYPE_VIEW_LONG_CLICKED', 'TYPE_WINDOW_CONTENT_CHANGED')),
    app_name TEXT,
    app_category TEXT,
    interaction_data JSONB,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gestures_participant ON data_gestures(participant_id, recorded_at);

-- ============================================================
-- SYNC LOG (track sync health)
-- ============================================================

CREATE TABLE sync_log (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    records_synced INT DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'error')),
    error_message TEXT,
    duration_ms INT
);
CREATE INDEX idx_sync_log_participant ON sync_log(participant_id, synced_at);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_studies_updated_at BEFORE UPDATE ON studies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_participants_updated_at BEFORE UPDATE ON participants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_sensor_configs_updated_at BEFORE UPDATE ON sensor_configs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_esm_schedules_updated_at BEFORE UPDATE ON esm_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_esm_questions_updated_at BEFORE UPDATE ON esm_questions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE esm_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE esm_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_app_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_battery ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sms ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_esm_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_light ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_screen_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_gestures ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

-- Authenticated users (researchers) can read/write all data
CREATE POLICY "Authenticated users full access" ON studies FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON participants FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON sensor_configs FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON esm_schedules FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON esm_questions FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON data_app_usage FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON data_notifications FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON data_battery FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON data_calls FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON data_sms FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON data_esm_responses FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON data_location FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON data_light FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON data_screen_state FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON data_gestures FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users full access" ON sync_log FOR ALL USING (auth.role() = 'authenticated');

-- Anon (mobile app with device key) can insert sensor data and read configs
CREATE POLICY "Anon can insert sensor data" ON data_app_usage FOR INSERT WITH CHECK (auth.role() = 'anon');
CREATE POLICY "Anon can insert sensor data" ON data_notifications FOR INSERT WITH CHECK (auth.role() = 'anon');
CREATE POLICY "Anon can insert sensor data" ON data_battery FOR INSERT WITH CHECK (auth.role() = 'anon');
CREATE POLICY "Anon can insert sensor data" ON data_calls FOR INSERT WITH CHECK (auth.role() = 'anon');
CREATE POLICY "Anon can insert sensor data" ON data_sms FOR INSERT WITH CHECK (auth.role() = 'anon');
CREATE POLICY "Anon can insert sensor data" ON data_esm_responses FOR INSERT WITH CHECK (auth.role() = 'anon');
CREATE POLICY "Anon can insert sensor data" ON data_location FOR INSERT WITH CHECK (auth.role() = 'anon');
CREATE POLICY "Anon can insert sensor data" ON data_light FOR INSERT WITH CHECK (auth.role() = 'anon');
CREATE POLICY "Anon can insert sensor data" ON data_screen_state FOR INSERT WITH CHECK (auth.role() = 'anon');
CREATE POLICY "Anon can insert sensor data" ON data_gestures FOR INSERT WITH CHECK (auth.role() = 'anon');
CREATE POLICY "Anon can insert sync log" ON sync_log FOR INSERT WITH CHECK (auth.role() = 'anon');

-- Anon can read study configs and sensor configs (for the app to fetch settings)
CREATE POLICY "Anon can read studies" ON studies FOR SELECT USING (auth.role() = 'anon' AND status IN ('active', 'paused', 'completed'));
CREATE POLICY "Anon can read sensor configs" ON sensor_configs FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "Anon can read esm schedules" ON esm_schedules FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "Anon can read esm questions" ON esm_questions FOR SELECT USING (auth.role() = 'anon');

-- Anon can read/update own participant record
CREATE POLICY "Anon can read participants" ON participants FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "Anon can insert participants" ON participants FOR INSERT WITH CHECK (auth.role() = 'anon');
CREATE POLICY "Anon can update participants" ON participants FOR UPDATE USING (auth.role() = 'anon');

-- ─── Phone-usage summary views ──────────────────────────────────────────────
-- Computed live from the raw event streams the app uploads. security_invoker
-- keeps the underlying tables' RLS in force (authenticated researchers only).
-- A screen-on "session" runs from an on/unlocked event to the next off/locked
-- event; if a closing event is missing (dropped event) the session is capped at
-- 2 hours. Timestamps bucketed in Europe/London. See migration_2026_10_usage_summary_views.sql.

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
GROUP BY s.participant_id, s.usage_date;

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

-- ─── Additional processed datasets (see migration_2026_10_processed_datasets.sql) ───


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

-- ─── Steps & proximity sensors (see migration_2026_10_steps_proximity.sql) ───


-- ── data_steps ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_steps (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    steps INT NOT NULL,                 -- steps taken during the interval
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_steps_participant ON data_steps(participant_id, recorded_at);
ALTER TABLE data_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON data_steps FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Anon can insert sensor data" ON data_steps FOR INSERT WITH CHECK (auth.role() = 'anon');

-- ── data_proximity ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_proximity (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    proximity_cm REAL,                  -- distance from proximity sensor (null if none)
    orientation TEXT NOT NULL,          -- face_up | face_down | upright | unknown
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proximity_participant ON data_proximity(participant_id, recorded_at);
ALTER TABLE data_proximity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON data_proximity FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Anon can insert sensor data" ON data_proximity FOR INSERT WITH CHECK (auth.role() = 'anon');

-- ── daily_steps processed view ───────────────────────────────────────────────
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

-- ─── Gesture pause/resume log (see migration_2026_10_gesture_pauses.sql) ───


CREATE TABLE IF NOT EXISTS data_gesture_pauses (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    event TEXT NOT NULL,                -- paused | resumed
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gesture_pauses_participant ON data_gesture_pauses(participant_id, recorded_at);
ALTER TABLE data_gesture_pauses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON data_gesture_pauses FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Anon can insert sensor data" ON data_gesture_pauses FOR INSERT WITH CHECK (auth.role() = 'anon');

-- Pair paused -> next resumed into gaps. A still-open pause (no resume yet) has
-- resumed_at = null and an open-ended gap.
CREATE OR REPLACE VIEW gesture_pause_sessions
WITH (security_invoker = on) AS
WITH ordered AS (
    SELECT
        participant_id,
        event,
        recorded_at::timestamptz AS ts,
        LEAD(event)       OVER (PARTITION BY participant_id ORDER BY recorded_at) AS next_event,
        LEAD(recorded_at::timestamptz) OVER (PARTITION BY participant_id ORDER BY recorded_at) AS next_ts
    FROM data_gesture_pauses
)
SELECT
    participant_id,
    ts AS paused_at,
    CASE WHEN next_event = 'resumed' THEN next_ts END AS resumed_at,
    (ts AT TIME ZONE 'Europe/London')::date AS pause_date,
    CASE WHEN next_event = 'resumed'
         THEN ROUND(EXTRACT(EPOCH FROM (next_ts - ts)) / 60.0, 1)
    END AS gap_minutes
FROM ordered
WHERE event = 'paused';

GRANT SELECT ON gesture_pause_sessions TO authenticated;

-- ─── Permission grant/revoke audit log (see migration_2026_10_permission_events.sql) ───


CREATE TABLE IF NOT EXISTS data_permission_events (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,   -- location_fine, usage_access, accessibility, sms, …
    action TEXT NOT NULL,       -- granted | revoked
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_permission_events_participant ON data_permission_events(participant_id, recorded_at);
ALTER TABLE data_permission_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON data_permission_events FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Anon can insert sensor data" ON data_permission_events FOR INSERT WITH CHECK (auth.role() = 'anon');

-- Pair each 'revoked' with the next 'granted' for the same participant+permission
-- into an outage interval (how long a permission was off). A still-revoked
-- permission has restored_at = null and an open gap.
CREATE OR REPLACE VIEW permission_outages
WITH (security_invoker = on) AS
WITH ordered AS (
    SELECT
        participant_id,
        permission,
        action,
        recorded_at::timestamptz AS ts,
        LEAD(action) OVER (PARTITION BY participant_id, permission ORDER BY recorded_at) AS next_action,
        LEAD(recorded_at::timestamptz) OVER (PARTITION BY participant_id, permission ORDER BY recorded_at) AS next_ts
    FROM data_permission_events
)
SELECT
    participant_id,
    permission,
    ts AS revoked_at,
    CASE WHEN next_action = 'granted' THEN next_ts END AS restored_at,
    (ts AT TIME ZONE 'Europe/London')::date AS outage_date,
    CASE WHEN next_action = 'granted'
         THEN ROUND(EXTRACT(EPOCH FROM (next_ts - ts)) / 60.0, 1)
    END AS outage_minutes
FROM ordered
WHERE action = 'revoked';

GRANT SELECT ON permission_outages TO authenticated;

-- ─── Participant merge (see migration_2026_10_participant_merge.sql) ───

-- with a merged_into reference) so the merge is auditable and reversible.

-- 1. Track merges on the participant row.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES participants(id);
ALTER TABLE participants ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS merge_adopted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS participant_merge_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    primary_participant_id UUID NOT NULL REFERENCES participants(id),
    duplicate_participant_id UUID NOT NULL REFERENCES participants(id),
    merged_by UUID DEFAULT auth.uid(),
    merged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    adopted_at TIMESTAMPTZ
);
ALTER TABLE participant_merge_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users read merge audit" ON participant_merge_audit
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users create merge audit" ON participant_merge_audit
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
GRANT SELECT, INSERT ON participant_merge_audit TO authenticated;

-- 2. The merge function. SECURITY INVOKER so it runs under the caller's RLS
--    (authenticated researchers only). All re-points happen in one transaction;
--    any failure rolls the whole thing back (no partial merges).
CREATE OR REPLACE FUNCTION merge_participants(p_primary UUID, p_duplicate UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_study_primary   UUID;
    v_study_duplicate UUID;
    v_moved jsonb := '{}'::jsonb;
    v_n bigint;
BEGIN
    IF p_primary = p_duplicate THEN
        RAISE EXCEPTION 'Primary and duplicate must differ';
    END IF;

    SELECT study_id INTO v_study_primary   FROM participants WHERE id = p_primary FOR UPDATE;
    SELECT study_id INTO v_study_duplicate FROM participants WHERE id = p_duplicate FOR UPDATE;
    IF v_study_primary IS NULL OR v_study_duplicate IS NULL THEN
        RAISE EXCEPTION 'Participant not found';
    END IF;
    IF v_study_primary <> v_study_duplicate THEN
        RAISE EXCEPTION 'Participants are in different studies';
    END IF;
    IF EXISTS (SELECT 1 FROM participants WHERE id = p_primary AND merged_into IS NOT NULL) THEN
        RAISE EXCEPTION 'Primary participant has already been merged';
    END IF;

    -- Re-point every data table + sync_log from duplicate -> primary.
    UPDATE data_app_usage         SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('app_usage', v_n);
    UPDATE data_notifications     SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('notifications', v_n);
    UPDATE data_battery           SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('battery', v_n);
    UPDATE data_calls             SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('calls', v_n);
    UPDATE data_sms               SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('sms', v_n);
    UPDATE data_esm_responses     SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('esm_responses', v_n);
    UPDATE data_location          SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('location', v_n);
    UPDATE data_light             SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('light', v_n);
    UPDATE data_screen_state      SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('screen_state', v_n);
    UPDATE data_gestures          SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('gestures', v_n);
    UPDATE data_steps             SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('steps', v_n);
    UPDATE data_proximity         SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('proximity', v_n);
    UPDATE data_gesture_pauses    SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('gesture_pauses', v_n);
    UPDATE data_permission_events SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('permission_events', v_n);
    UPDATE sync_log               SET participant_id = p_primary WHERE participant_id = p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('sync_log', v_n);

    -- Soft-withdraw the duplicate and record the merge (kept, reversible).
    UPDATE participants
       SET status = 'withdrawn',
           merged_into = p_primary,
           merged_at = now(),
           merge_adopted_at = NULL,
           updated_at = now()
     WHERE id = p_duplicate;

    INSERT INTO participant_merge_audit(study_id, primary_participant_id, duplicate_participant_id)
    VALUES(v_study_primary, p_primary, p_duplicate);

    RETURN jsonb_build_object(
        'primary', p_primary,
        'duplicate', p_duplicate,
        'moved', v_moved
    );
END;
$$;

-- Note on reversibility: the duplicate row is kept (soft-withdrawn with a
-- merged_into reference and a record of what moved), so the merge is auditable.
-- The data rows themselves are re-pointed by participant_id and are not tagged
-- with their origin, so a precise automatic undo is not possible once new data
-- has mixed in. Treat merge as a deliberate, confirmed action.

GRANT EXECUTE ON FUNCTION merge_participants(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION adopt_participant_merge(p_duplicate UUID, p_primary UUID)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM participants WHERE id=p_duplicate AND merged_into=p_primary) THEN RETURN false; END IF;
    UPDATE participants SET merge_adopted_at=COALESCE(merge_adopted_at,now()) WHERE id=p_duplicate;
    UPDATE participant_merge_audit SET adopted_at=COALESCE(adopted_at,now())
      WHERE duplicate_participant_id=p_duplicate AND primary_participant_id=p_primary;
    RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION adopt_participant_merge(UUID, UUID) TO anon, authenticated;

-- ─── Study PIN (optional 4-digit enrolment gate) ───
-- The hash lives in a separate table (study_pins) that anon cannot read, so the
-- studies table keeps its normal anon SELECT grant. studies.pin_required is a
-- readable boolean the app checks to decide whether to prompt.

ALTER TABLE studies ADD COLUMN IF NOT EXISTS pin_required BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS study_pins (
    study_id UUID PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE study_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage study pins" ON study_pins FOR ALL
    USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
REVOKE ALL ON study_pins FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON study_pins TO authenticated;

-- Researcher sets/clears a study PIN (NULL/'' clears it).
CREATE OR REPLACE FUNCTION set_study_pin(p_study UUID, p_pin TEXT)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, extensions AS $$
BEGIN
    IF p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
        DELETE FROM study_pins WHERE study_id = p_study;
        UPDATE studies SET pin_required = false, updated_at = now() WHERE id = p_study;
    ELSIF p_pin !~ '^[0-9]{4}$' THEN
        RAISE EXCEPTION 'PIN must be exactly 4 digits';
    ELSE
        INSERT INTO study_pins (study_id, pin_hash, updated_at)
        VALUES (p_study, crypt(p_pin, gen_salt('bf')), now())
        ON CONFLICT (study_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, updated_at = now();
        UPDATE studies SET pin_required = true, updated_at = now() WHERE id = p_study;
    END IF;
END;
$$;

-- App verifies a PIN without reading the hash (SECURITY DEFINER).
CREATE OR REPLACE FUNCTION verify_study_pin(p_study UUID, p_pin TEXT)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_hash TEXT;
BEGIN
    SELECT pin_hash INTO v_hash FROM study_pins WHERE study_id = p_study;
    IF v_hash IS NULL THEN RETURN true; END IF;
    RETURN crypt(p_pin, v_hash) = v_hash;
END;
$$;

-- PIN brute-force protection + atomic PIN-gated enrolment.
CREATE TABLE IF NOT EXISTS pin_attempts (
    study_id   UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    device_id  TEXT NOT NULL,
    fails      INT  NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_fail_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (study_id, device_id)
);
ALTER TABLE pin_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read pin attempts" ON pin_attempts FOR ALL
    USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
REVOKE ALL ON pin_attempts FROM anon;
GRANT SELECT, UPDATE, DELETE ON pin_attempts TO authenticated;

DROP FUNCTION IF EXISTS enroll_participant(UUID, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS enroll_participant(UUID, TEXT, TEXT, JSONB, UUID);
CREATE FUNCTION enroll_participant(
    p_study UUID, p_device_id TEXT, p_pin TEXT DEFAULT NULL, p_device_info JSONB DEFAULT '{}'::jsonb,
    p_request_id UUID DEFAULT NULL
)
RETURNS TABLE (participant_id UUID, device_id TEXT, error_message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_status TEXT; v_required BOOLEAN; v_resolved TEXT; v_suffix INT := 2; v_id UUID;
    v_locked TIMESTAMPTZ; v_fails INT; v_study_fails INT;
    MAX_FAILS CONSTANT INT := 5; LOCK_MINUTES CONSTANT INT := 15;
    STUDY_WINDOW_MIN CONSTANT INT := 10; STUDY_MAX_FAILS CONSTANT INT := 50;
BEGIN
    IF p_request_id IS NOT NULL THEN
        SELECT p.id, p.device_id INTO v_id, v_resolved FROM participants AS p
         WHERE p.enrollment_request_id = p_request_id AND p.study_id = p_study;
        IF v_id IS NOT NULL THEN
            participant_id := v_id; device_id := v_resolved; error_message := NULL; RETURN NEXT; RETURN;
        END IF;
    END IF;
    SELECT status, pin_required INTO v_status, v_required FROM studies WHERE id = p_study;
    IF v_status IS NULL THEN RAISE EXCEPTION 'Study not found'; END IF;
    IF v_status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'Study is not open for enrolment'; END IF;

    IF v_required THEN
        SELECT pa.locked_until, pa.fails INTO v_locked, v_fails
          FROM pin_attempts AS pa WHERE pa.study_id = p_study AND pa.device_id = p_device_id;
        IF v_locked IS NOT NULL AND v_locked > now() THEN
            participant_id := NULL; device_id := NULL;
            error_message := format('Too many incorrect PIN attempts. Try again in %s minute(s).',
                CEIL(EXTRACT(EPOCH FROM (v_locked - now())) / 60.0));
            RETURN NEXT; RETURN;
        END IF;
        IF v_locked IS NOT NULL THEN
            DELETE FROM pin_attempts AS pa
             WHERE pa.study_id = p_study AND pa.device_id = p_device_id;
            v_fails := 0;
        END IF;
        SELECT COALESCE(SUM(pa.fails), 0) INTO v_study_fails FROM pin_attempts AS pa
         WHERE pa.study_id = p_study AND pa.last_fail_at > now() - make_interval(mins => STUDY_WINDOW_MIN);
        IF v_study_fails >= STUDY_MAX_FAILS THEN
            participant_id := NULL; device_id := NULL;
            error_message := 'This study is temporarily locked due to too many failed attempts. Try again later.';
            RETURN NEXT; RETURN;
        END IF;
        IF NOT verify_study_pin(p_study, COALESCE(p_pin, '')) THEN
            INSERT INTO pin_attempts (study_id, device_id, fails, last_fail_at, locked_until)
            VALUES (p_study, p_device_id, 1, now(),
                    CASE WHEN 1 >= MAX_FAILS THEN now() + make_interval(mins => LOCK_MINUTES) END)
            ON CONFLICT ON CONSTRAINT pin_attempts_pkey DO UPDATE
                SET fails = pin_attempts.fails + 1, last_fail_at = now(),
                    locked_until = CASE WHEN pin_attempts.fails + 1 >= MAX_FAILS
                                        THEN now() + make_interval(mins => LOCK_MINUTES) END;
            SELECT pa.fails INTO v_fails FROM pin_attempts AS pa
             WHERE pa.study_id = p_study AND pa.device_id = p_device_id;
            participant_id := NULL; device_id := NULL;
            error_message := CASE
                WHEN v_fails >= MAX_FAILS THEN format('Too many incorrect PIN attempts. Try again in %s minutes.', LOCK_MINUTES)
                ELSE format('Incorrect study PIN. %s attempt(s) left before a temporary lockout.', MAX_FAILS - v_fails)
            END;
            RETURN NEXT; RETURN;
        END IF;
        DELETE FROM pin_attempts AS pa WHERE pa.study_id = p_study AND pa.device_id = p_device_id;
    END IF;

    v_resolved := p_device_id;
    WHILE EXISTS (
        SELECT 1 FROM participants AS p
         WHERE p.study_id = p_study AND p.device_id = v_resolved
    ) LOOP
        v_resolved := p_device_id || '_' || v_suffix; v_suffix := v_suffix + 1;
    END LOOP;
    INSERT INTO participants (study_id, device_id, label, status, device_info, enrolled_at, enrollment_request_id)
    VALUES (p_study, v_resolved, 'Device ' || v_resolved, 'active', COALESCE(p_device_info, '{}'::jsonb), now(), p_request_id)
    RETURNING id INTO v_id;
    participant_id := v_id; device_id := v_resolved; error_message := NULL; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION enroll_participant(UUID, TEXT, TEXT, JSONB, UUID) TO anon, authenticated;

-- ============================================================
-- POSTGREST TABLE PRIVILEGES
-- ============================================================
-- clear_database.sql recreates the public schema, so Supabase's usual grants
-- are removed with it. RLS policies do not grant table access by themselves:
-- PostgREST roles need both the base privilege below and a matching policy.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

GRANT SELECT ON studies, sensor_configs, esm_schedules, esm_questions TO anon;
GRANT SELECT, INSERT, UPDATE ON participants TO anon;
GRANT INSERT ON
    data_app_usage,
    data_notifications,
    data_battery,
    data_calls,
    data_sms,
    data_esm_responses,
    data_location,
    data_light,
    data_screen_state,
    data_gestures,
    data_steps,
    data_proximity,
    data_gesture_pauses,
    data_permission_events,
    sync_log
TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
