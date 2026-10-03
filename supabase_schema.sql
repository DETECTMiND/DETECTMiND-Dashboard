-- ============================================================
-- Research Data Collection App - Supabase Database Schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
        'location', 'light', 'screen_state', 'gestures'
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
-- 2 hours. Timestamps bucketed in UTC. See migration_2026_10_usage_summary_views.sql.

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

GRANT SELECT ON screen_sessions, daily_usage, hourly_usage, daily_app_usage TO authenticated;
