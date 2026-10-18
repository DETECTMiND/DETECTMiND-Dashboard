-- ============================================================
-- DETECTMiND - Supabase Database Schema
-- ============================================================
-- Run order on a fresh project / after a reset:
--   1. clear_database.sql   (DESTRUCTIVE: drops and recreates schema public)
--   2. supabase_schema.sql  (this file)
--   3. seed_studies.sql     (example studies + grants researcher access)
-- All earlier migration_*.sql files are folded into this file.
--
-- Security model (see SECURITY_NOTES.md):
--   * Android app = anon key + a per-device secret sent as the
--     `x-device-token` header. Only sha256(token) is stored
--     (participants.device_token_hash). The app can read non-draft study
--     configuration, INSERT data rows for its own (canonical, active)
--     participant, and call the device_* RPCs. It cannot read, insert or
--     update participants directly.
--   * Dashboard = Supabase Auth users listed in public.researchers.
--     Every researcher policy is is_researcher(); being merely
--     "authenticated" grants nothing.
-- ============================================================

-- Supabase keeps extension-owned objects outside public so resetting the
-- application schema does not orphan them.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET search_path = public, extensions;

-- Note: Postgres grants EXECUTE to PUBLIC on every new function. The end of
-- this file revokes that for every function in public and grants back only
-- what each role needs. Re-run that section after adding a function.

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE studies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    app_description TEXT, -- shown in the mobile app
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    config JSONB DEFAULT '{}', -- general study config
    sync_interval_minutes INT NOT NULL DEFAULT 30,
    -- Optional 4-digit enrolment PIN. The hash lives in study_pins (never
    -- readable by anon); this flag tells the app whether to prompt.
    pin_required BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Participants (devices enrolled in studies). Created only through
-- enroll_participant(); the app never touches this table directly.
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
    -- sha256(hex) of the per-device secret sent as the x-device-token header.
    device_token_hash TEXT UNIQUE,
    -- Participant merge (duplicate enrolments of the same person).
    merged_into UUID REFERENCES participants(id),
    merged_at TIMESTAMPTZ,
    merge_adopted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(study_id, device_id)
);

-- Dashboard users allowed to see and manage study data. Add one with:
--   INSERT INTO researchers(user_id) SELECT id FROM auth.users WHERE email = '...';
CREATE TABLE researchers (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT now()
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
-- Every data table (and sync_log) has client_uuid: a random UUID the app
-- assigns when it stores the row locally. The app POSTs with
-- ?on_conflict=client_uuid and Prefer: resolution=ignore-duplicates, so a
-- retried batch never creates duplicate rows.

-- 1. App Usage (screen usage per app)
CREATE TABLE data_app_usage (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    package_name TEXT NOT NULL,
    app_name TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_seconds INT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_app_usage_participant ON data_app_usage(participant_id, start_time);
CREATE UNIQUE INDEX uq_app_usage_client_uuid ON data_app_usage(client_uuid);

-- 2. App Notifications
CREATE TABLE data_notifications (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    package_name TEXT NOT NULL,
    app_name TEXT,
    posted_at TIMESTAMPTZ NOT NULL,
    removed_at TIMESTAMPTZ,
    removal_reason TEXT, -- clicked | dismissed | app_cancel | timeout | listener_cancel | blocked | other
    title TEXT,          -- legacy, no longer collected
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_participant ON data_notifications(participant_id, posted_at);
CREATE UNIQUE INDEX uq_notifications_client_uuid ON data_notifications(client_uuid);

-- 3. Battery
CREATE TABLE data_battery (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    level INT NOT NULL, -- 0-100
    is_charging BOOLEAN,
    charging_type TEXT, -- usb, ac, wireless
    temperature REAL,   -- degrees Celsius
    voltage REAL,       -- millivolts as reported by Android (e.g. 4371); the dashboard shows volts
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_battery_participant ON data_battery(participant_id, recorded_at);
CREATE UNIQUE INDEX uq_battery_client_uuid ON data_battery(client_uuid);

-- 4a. Phone Calls
CREATE TABLE data_calls (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing', 'missed')),
    event_time TIMESTAMPTZ NOT NULL,
    duration_seconds INT,
    contact_hash TEXT, -- SHA-256 of the phone number
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_calls_participant ON data_calls(participant_id, event_time);
CREATE UNIQUE INDEX uq_calls_client_uuid ON data_calls(client_uuid);

-- 4b. SMS (metadata only; message bodies are not collected, not even hashed)
CREATE TABLE data_sms (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    event_time TIMESTAMPTZ NOT NULL,
    contact_hash TEXT, -- SHA-256 of the phone number
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sms_participant ON data_sms(participant_id, event_time);
CREATE UNIQUE INDEX uq_sms_client_uuid ON data_sms(client_uuid);

-- 5. ESM/EMA Responses
CREATE TABLE data_esm_responses (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    schedule_id UUID REFERENCES esm_schedules(id) ON DELETE SET NULL,
    triggered_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    expired BOOLEAN DEFAULT false,
    responses JSONB, -- {question_id: answer, ...}
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_esm_responses_participant ON data_esm_responses(participant_id, triggered_at);
CREATE UNIQUE INDEX uq_esm_responses_client_uuid ON data_esm_responses(client_uuid);

-- 6. Location
CREATE TABLE data_location (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    altitude DOUBLE PRECISION,
    accuracy REAL,
    speed REAL,
    provider TEXT, -- gps, network, fused
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_location_participant ON data_location(participant_id, recorded_at);
CREATE UNIQUE INDEX uq_location_client_uuid ON data_location(client_uuid);

-- 7. Light Sensor
CREATE TABLE data_light (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    lux REAL NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_light_participant ON data_light(participant_id, recorded_at);
CREATE UNIQUE INDEX uq_light_client_uuid ON data_light(client_uuid);

-- 8. Screen State (on/off/lock/unlock)
CREATE TABLE data_screen_state (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    state TEXT NOT NULL CHECK (state IN ('on', 'off', 'locked', 'unlocked')),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_screen_state_participant ON data_screen_state(participant_id, recorded_at);
CREATE UNIQUE INDEX uq_screen_state_client_uuid ON data_screen_state(client_uuid);

-- 9. User Gestures (accessibility events). interaction_type is an open
--    identifier so new gesture kinds (touch, swipe, long_press, scroll,
--    page_swipe, ...) need no schema change.
CREATE TABLE data_gestures (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    interaction_type TEXT NOT NULL CHECK (interaction_type ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
    app_name TEXT,
    app_category TEXT,
    interaction_data JSONB,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gestures_participant ON data_gestures(participant_id, recorded_at);
CREATE UNIQUE INDEX uq_gestures_client_uuid ON data_gestures(client_uuid);

-- 10. Steps
CREATE TABLE data_steps (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    steps INT NOT NULL,                 -- steps taken during the interval
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_steps_participant ON data_steps(participant_id, recorded_at);
CREATE UNIQUE INDEX uq_steps_client_uuid ON data_steps(client_uuid);

-- 11. Proximity / orientation
CREATE TABLE data_proximity (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    proximity_cm REAL,                  -- distance from proximity sensor (null if none)
    orientation TEXT NOT NULL,          -- face_up | face_down | upright | unknown
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_proximity_participant ON data_proximity(participant_id, recorded_at);
CREATE UNIQUE INDEX uq_proximity_client_uuid ON data_proximity(client_uuid);

-- 12. Gesture collection pause/resume log (banking-app pause etc.)
CREATE TABLE data_gesture_pauses (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    event TEXT NOT NULL,                -- paused | resumed
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gesture_pauses_participant ON data_gesture_pauses(participant_id, recorded_at);
CREATE UNIQUE INDEX uq_gesture_pauses_client_uuid ON data_gesture_pauses(client_uuid);

-- 13. Permission grant/revoke audit log
CREATE TABLE data_permission_events (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    permission TEXT NOT NULL,   -- location_fine, usage_access, accessibility, sms, ...
    action TEXT NOT NULL,       -- granted | revoked
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_permission_events_participant ON data_permission_events(participant_id, recorded_at);
CREATE UNIQUE INDEX uq_permission_events_client_uuid ON data_permission_events(client_uuid);

-- ============================================================
-- SYNC LOG (track sync health)
-- ============================================================

CREATE TABLE sync_log (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_uuid UUID,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    records_synced INT DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'error')),
    error_message TEXT,
    duration_ms INT
);
CREATE INDEX idx_sync_log_participant ON sync_log(participant_id, synced_at);
CREATE UNIQUE INDEX uq_sync_log_client_uuid ON sync_log(client_uuid);

-- ============================================================
-- MERGE AUDIT, STUDY PINS, PIN ATTEMPTS
-- ============================================================

CREATE TABLE participant_merge_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    primary_participant_id UUID NOT NULL REFERENCES participants(id),
    duplicate_participant_id UUID NOT NULL REFERENCES participants(id),
    merged_by UUID DEFAULT auth.uid(),
    merged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    adopted_at TIMESTAMPTZ
);

-- PIN hash lives here, never readable by anon.
CREATE TABLE study_pins (
    study_id UUID PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PIN brute-force protection for enroll_participant().
CREATE TABLE pin_attempts (
    study_id   UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    device_id  TEXT NOT NULL,
    fails      INT  NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_fail_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (study_id, device_id)
);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_studies_updated_at BEFORE UPDATE ON studies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_participants_updated_at BEFORE UPDATE ON participants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_sensor_configs_updated_at BEFORE UPDATE ON sensor_configs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_esm_schedules_updated_at BEFORE UPDATE ON esm_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_esm_questions_updated_at BEFORE UPDATE ON esm_questions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- IDENTITY HELPERS (used by RLS policies, so defined before them)
-- ============================================================

-- True when the signed-in Supabase Auth user is listed in researchers.
CREATE OR REPLACE FUNCTION is_researcher()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT auth.uid() IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.researchers r WHERE r.user_id = auth.uid());
$$;

-- The participants row whose device_token_hash matches sha256 of the
-- x-device-token request header, or NULL. NULL-safe: request.headers is
-- unset outside PostgREST (SQL editor), may be '' on a pooled connection,
-- and the header may be missing or malformed.
CREATE OR REPLACE FUNCTION device_token_participant()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_headers TEXT;
    v_token   TEXT;
BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '');
    IF v_headers IS NULL THEN
        RETURN NULL;
    END IF;
    BEGIN
        v_token := v_headers::json ->> 'x-device-token';
    EXCEPTION WHEN others THEN
        RETURN NULL;
    END;
    IF v_token IS NULL OR length(v_token) < 32 THEN
        RETURN NULL;
    END IF;
    RETURN (
        SELECT p.id FROM public.participants p
         WHERE p.device_token_hash = encode(digest(v_token, 'sha256'), 'hex')
    );
END;
$$;

-- Follow merged_into from p_id to the end of the chain (max 10 hops).
-- Returns NULL for an unknown id, a cycle, or a chain longer than 10 hops.
CREATE OR REPLACE FUNCTION resolve_canonical_participant(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_current UUID := p_id;
    v_next    UUID;
    v_seen    UUID[] := ARRAY[p_id];
    v_found   BOOLEAN;
BEGIN
    IF p_id IS NULL THEN
        RETURN NULL;
    END IF;
    FOR i IN 1..11 LOOP
        SELECT true, p.merged_into INTO v_found, v_next
          FROM public.participants p WHERE p.id = v_current;
        IF v_found IS NOT TRUE THEN
            RETURN NULL;              -- dangling reference
        END IF;
        IF v_next IS NULL THEN
            RETURN v_current;         -- end of chain
        END IF;
        IF v_next = ANY(v_seen) OR i > 10 THEN
            RETURN NULL;              -- cycle or too many hops
        END IF;
        v_seen := v_seen || v_next;
        v_current := v_next;
        v_found := NULL;
    END LOOP;
    RETURN NULL;
END;
$$;

-- The canonical participant this device may upload data for: the token's row
-- followed through merged_into, and only while that participant is active.
CREATE OR REPLACE FUNCTION device_participant_id()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_canonical UUID;
BEGIN
    v_canonical := resolve_canonical_participant(device_token_participant());
    IF v_canonical IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN (
        SELECT p.id FROM public.participants p
         WHERE p.id = v_canonical AND p.status = 'active'
    );
END;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Policy functions are wrapped in (SELECT ...) so Postgres evaluates them once
-- per statement rather than once per row (500-row upload batches).

ALTER TABLE studies                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE researchers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_configs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE esm_schedules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE esm_questions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_app_usage          ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_battery            ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_calls              ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sms                ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_esm_responses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_location           ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_light              ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_screen_state       ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_gestures           ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_steps              ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_proximity          ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_gesture_pauses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_permission_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log                ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_merge_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_pins              ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_attempts            ENABLE ROW LEVEL SECURITY;

-- ── Researchers (dashboard) ─────────────────────────────────────────────────
-- Full read/write on study tables, but only for users in researchers.
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'studies', 'participants', 'sensor_configs', 'esm_schedules', 'esm_questions',
        'data_app_usage', 'data_notifications', 'data_battery', 'data_calls', 'data_sms',
        'data_esm_responses', 'data_location', 'data_light', 'data_screen_state',
        'data_gestures', 'data_steps', 'data_proximity', 'data_gesture_pauses',
        'data_permission_events', 'sync_log', 'study_pins', 'pin_attempts'
    ] LOOP
        EXECUTE format(
            'CREATE POLICY "Researchers full access" ON public.%I FOR ALL TO authenticated '
            'USING ((SELECT public.is_researcher())) WITH CHECK ((SELECT public.is_researcher()))',
            t);
    END LOOP;
END $$;

CREATE POLICY "Researchers read researchers" ON researchers
    FOR SELECT TO authenticated USING ((SELECT is_researcher()));

CREATE POLICY "Researchers read merge audit" ON participant_merge_audit
    FOR SELECT TO authenticated USING ((SELECT is_researcher()));
CREATE POLICY "Researchers create merge audit" ON participant_merge_audit
    FOR INSERT TO authenticated WITH CHECK ((SELECT is_researcher()));

-- ── Android app (anon key + x-device-token) ─────────────────────────────────
-- Study configuration: readable for non-draft studies.
CREATE POLICY "Anon read non-draft studies" ON studies
    FOR SELECT TO anon
    USING (status IN ('active', 'paused', 'completed'));

CREATE POLICY "Anon read sensor configs" ON sensor_configs
    FOR SELECT TO anon
    USING (EXISTS (SELECT 1 FROM studies s
                    WHERE s.id = sensor_configs.study_id AND s.status <> 'draft'));

CREATE POLICY "Anon read esm schedules" ON esm_schedules
    FOR SELECT TO anon
    USING (EXISTS (SELECT 1 FROM studies s
                    WHERE s.id = esm_schedules.study_id AND s.status <> 'draft'));

CREATE POLICY "Anon read esm questions" ON esm_questions
    FOR SELECT TO anon
    USING (EXISTS (SELECT 1 FROM esm_schedules es
                     JOIN studies s ON s.id = es.study_id
                    WHERE es.id = esm_questions.schedule_id AND s.status <> 'draft'));

-- Data uploads: INSERT only, and only for the device's own canonical, active
-- participant. No anon UPDATE/DELETE, and no anon SELECT of any data column
-- (only client_uuid of its own rows, required by ON CONFLICT; see below).
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'data_app_usage', 'data_notifications', 'data_battery', 'data_calls', 'data_sms',
        'data_esm_responses', 'data_location', 'data_light', 'data_screen_state',
        'data_gestures', 'data_steps', 'data_proximity', 'data_gesture_pauses',
        'data_permission_events', 'sync_log'
    ] LOOP
        EXECUTE format(
            'CREATE POLICY "Device inserts own data" ON public.%I FOR INSERT TO anon '
            'WITH CHECK (participant_id = (SELECT public.device_participant_id()))',
            t);
        -- Needed for duplicate-safe uploads: INSERT ... ON CONFLICT (client_uuid)
        -- DO NOTHING requires SELECT on the arbiter column, and Postgres then
        -- also checks each new row against the SELECT policies. Anon's only
        -- column privilege is client_uuid (see grants), so at most a device can
        -- list the upload ids of its own rows; no sensor values are readable.
        EXECUTE format(
            'CREATE POLICY "Device sees own upload ids" ON public.%I FOR SELECT TO anon '
            'USING (participant_id = (SELECT public.device_participant_id()))',
            t);
    END LOOP;
END $$;

-- participants, researchers, study_pins, pin_attempts, participant_merge_audit:
-- no anon policies at all (and no anon table privileges, see grants below).

-- ============================================================
-- PROCESSED VIEWS
-- ============================================================
-- Computed live from the raw event streams the app uploads.
-- security_invoker = true keeps the underlying tables' RLS in force, so only
-- researchers see rows. A screen-on "session" runs from an on/unlocked event
-- to the next off/locked event. Timestamps bucket in the database timezone
-- (Europe/London).

CREATE OR REPLACE VIEW screen_sessions
WITH (security_invoker = true) AS
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
    COALESCE(EXTRACT(EPOCH FROM (next_ts - start_ts)), 0)::bigint AS session_seconds,
    (next_dir IS DISTINCT FROM 'off' OR next_ts IS NULL) AS was_capped
FROM with_next
WHERE dir = 'on';

CREATE OR REPLACE VIEW daily_usage
WITH (security_invoker = true) AS
WITH sessions AS (
    SELECT
        participant_id,
        start_ts::date AS usage_date,
        -- Cap session_seconds to only count time up to now() for today
        CASE
            WHEN start_ts::date = now()::date
            THEN LEAST(session_seconds, EXTRACT(EPOCH FROM (now() - start_ts))::int)
            ELSE session_seconds
        END AS session_seconds,
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

CREATE OR REPLACE VIEW hourly_usage
WITH (security_invoker = true) AS
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
        -- Include current hour but cap end_ts to now() to show partial hour data
        generate_series(
            date_trunc('hour', start_ts),
            LEAST(date_trunc('hour', end_ts), date_trunc('hour', now())),
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
            LEAST(end_ts, hour_start + interval '1 hour', now())
            - GREATEST(start_ts, hour_start)
        ))
    )::bigint AS screen_on_seconds
FROM hour_buckets
GROUP BY participant_id, hour_start
HAVING SUM(
    EXTRACT(EPOCH FROM (
        LEAST(end_ts, hour_start + interval '1 hour', now())
        - GREATEST(start_ts, hour_start)
    ))
) > 0;

CREATE OR REPLACE VIEW daily_app_usage
WITH (security_invoker = true) AS
SELECT
    participant_id,
    start_time::date AS usage_date,
    package_name,
    MAX(app_name)                          AS app_name,
    SUM(duration_seconds)                  AS foreground_seconds,
    ROUND(SUM(duration_seconds) / 60.0, 1) AS foreground_minutes,
    COUNT(*)                               AS open_count
FROM data_app_usage
GROUP BY participant_id, usage_date, package_name;

CREATE OR REPLACE VIEW hourly_app_usage
WITH (security_invoker = true) AS
SELECT
    participant_id,
    date_trunc('hour', start_time)::timestamp AS usage_hour,
    (date_trunc('hour', start_time))::date AS usage_date,
    EXTRACT(HOUR FROM date_trunc('hour', start_time))::int AS hour_of_day,
    package_name,
    MAX(app_name)                          AS app_name,
    SUM(duration_seconds)                  AS foreground_seconds,
    ROUND(SUM(duration_seconds) / 60.0, 1) AS foreground_minutes,
    COUNT(*)                               AS open_count
FROM data_app_usage
GROUP BY participant_id, date_trunc('hour', start_time), package_name;

CREATE OR REPLACE VIEW daily_app_usage_total
WITH (security_invoker = true) AS
SELECT
    participant_id,
    start_time::date AS usage_date,
    SUM(duration_seconds)                  AS total_foreground_seconds,
    ROUND(SUM(duration_seconds) / 60.0, 1) AS total_foreground_minutes,
    ROUND(SUM(duration_seconds) / 3600.0, 2) AS total_foreground_hours,
    COUNT(DISTINCT package_name)           AS unique_apps,
    COUNT(*)                               AS total_opens
FROM data_app_usage
GROUP BY participant_id, start_time::date;

CREATE OR REPLACE VIEW daily_pickups
WITH (security_invoker = true) AS
SELECT
    participant_id,
    recorded_at::date AS usage_date,
    EXTRACT(HOUR FROM recorded_at)::int AS hour_of_day,
    COUNT(*) AS pickups
FROM data_screen_state
WHERE state = 'unlocked'
GROUP BY 1, 2, 3;

-- 2. First and last phone use per day (sleep/wake proxy) ----------------------
CREATE OR REPLACE VIEW daily_first_last_use
WITH (security_invoker = true) AS
WITH uses AS (
    SELECT
        participant_id,
        recorded_at::date AS usage_date,
        recorded_at AS ts,
        state
    FROM data_screen_state
    WHERE state IN ('on', 'unlocked', 'off', 'locked')
)
SELECT
    participant_id,
    usage_date,
    MIN(ts) FILTER (WHERE state IN ('on', 'unlocked'))  AS first_use,
    MAX(ts) FILTER (WHERE state IN ('off', 'locked'))   AS last_use,
    to_char(MIN(ts) FILTER (WHERE state IN ('on', 'unlocked')), 'HH24:MI') AS first_use_local,
    to_char(MAX(ts) FILTER (WHERE state IN ('off', 'locked')), 'HH24:MI') AS last_use_local
FROM uses
GROUP BY participant_id, usage_date;

-- 3. Daily notifications received ---------------------------------------------
CREATE OR REPLACE VIEW daily_notifications
WITH (security_invoker = true) AS
SELECT
    participant_id,
    posted_at::date AS usage_date,
    COUNT(*)                                               AS notifications,
    COUNT(DISTINCT package_name)                           AS distinct_apps,
    COUNT(*) FILTER (WHERE removal_reason = 'clicked')     AS opened
FROM data_notifications
GROUP BY 1, 2;

-- 4. Daily battery summary ----------------------------------------------------
CREATE OR REPLACE VIEW daily_battery_summary
WITH (security_invoker = true) AS
SELECT
    participant_id,
    recorded_at::date AS usage_date,
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

CREATE OR REPLACE VIEW daily_steps
WITH (security_invoker = true) AS
SELECT
    participant_id,
    recorded_at::date AS usage_date,
    SUM(steps)  AS steps,
    COUNT(*)    AS samples
FROM data_steps
GROUP BY 1, 2;

-- Pair paused -> next resumed into gaps. A still-open pause (no resume yet) has
-- resumed_at = null and an open-ended gap.
CREATE OR REPLACE VIEW gesture_pause_sessions
WITH (security_invoker = true) AS
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

-- Pair each 'revoked' with the next 'granted' for the same participant+permission
-- into an outage interval (how long a permission was off). A still-revoked
-- permission has restored_at = null and an open gap.
CREATE OR REPLACE VIEW permission_outages
WITH (security_invoker = true) AS
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

-- Feed scrolling and full-screen pager (reels / Shorts / stories) swipes per
-- participant, day and app, from data_gestures:
--   page_swipe: interaction_data.dwell_ms = time on the item before swiping
--   scroll    : one feed scroll burst; distance_dp, items_passed, duration_ms
-- Non-numeric JSON values are ignored rather than failing the view.
CREATE OR REPLACE VIEW daily_scroll_activity
WITH (security_invoker = true) AS
WITH g AS (
    SELECT
        participant_id,
        recorded_at::date AS usage_date,
        COALESCE(app_name, interaction_data->>'package_name') AS app_name,
        interaction_type,
        CASE WHEN jsonb_typeof(interaction_data->'dwell_ms')     = 'number' THEN (interaction_data->>'dwell_ms')::numeric     END AS dwell_ms,
        CASE WHEN jsonb_typeof(interaction_data->'distance_dp')  = 'number' THEN (interaction_data->>'distance_dp')::numeric  END AS distance_dp,
        CASE WHEN jsonb_typeof(interaction_data->'items_passed') = 'number' THEN (interaction_data->>'items_passed')::numeric END AS items_passed,
        CASE WHEN jsonb_typeof(interaction_data->'duration_ms')  = 'number' THEN (interaction_data->>'duration_ms')::numeric  END AS duration_ms
    FROM data_gestures
    WHERE interaction_type IN ('page_swipe', 'scroll')
)
SELECT
    participant_id,
    usage_date,
    app_name,
    COUNT(*) FILTER (WHERE interaction_type = 'page_swipe')                                   AS reel_swipes,
    ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY dwell_ms)
           FILTER (WHERE interaction_type = 'page_swipe'))::numeric / 1000.0, 1)              AS median_dwell_seconds,
    ROUND(AVG(dwell_ms) FILTER (WHERE interaction_type = 'page_swipe') / 1000.0, 1)          AS avg_dwell_seconds,
    COUNT(*) FILTER (WHERE interaction_type = 'scroll')                                       AS feed_scroll_bursts,
    COALESCE(ROUND(SUM(distance_dp) FILTER (WHERE interaction_type = 'scroll')), 0)::bigint   AS feed_distance_dp,
    COALESCE(SUM(items_passed) FILTER (WHERE interaction_type = 'scroll'), 0)::bigint         AS feed_items_passed,
    ROUND(COALESCE(SUM(duration_ms) FILTER (WHERE interaction_type = 'scroll'), 0) / 1000.0, 1) AS feed_scroll_seconds
FROM g
GROUP BY participant_id, usage_date, app_name;

-- ============================================================
-- PARTICIPANT MERGE (researchers only)
-- ============================================================
-- SECURITY INVOKER so it runs under the caller's RLS; additionally refuses any
-- caller that is not a researcher. All re-points happen in one transaction;
-- any failure rolls the whole thing back (no partial merges).
CREATE OR REPLACE FUNCTION merge_participants(p_primary UUID, p_duplicate UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
    v_study_primary   UUID;
    v_study_duplicate UUID;
    v_moved jsonb := '{}'::jsonb;
    v_n bigint;
BEGIN
    IF NOT is_researcher() THEN
        RAISE EXCEPTION 'Not authorised as a researcher' USING ERRCODE = '42501';
    END IF;
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

    -- Soft-withdraw the duplicate and record the merge (kept, auditable). The
    -- duplicate's device keeps its token; device_participant_id() follows
    -- merged_into, so its future uploads land on the primary.
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

-- ============================================================
-- STUDY PIN (optional 4-digit enrolment gate)
-- ============================================================

-- Researcher sets/clears a study PIN (NULL/'' clears it). SECURITY DEFINER so
-- it does not depend on the caller's access to pgcrypto in the extensions
-- schema; it refuses anyone who is not a researcher.
CREATE OR REPLACE FUNCTION set_study_pin(p_study UUID, p_pin TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT is_researcher() THEN
        RAISE EXCEPTION 'Not authorised as a researcher' USING ERRCODE = '42501';
    END IF;
    IF p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
        DELETE FROM study_pins WHERE study_id = p_study;
        UPDATE studies SET pin_required = false, updated_at = now() WHERE id = p_study;
    ELSIF p_pin !~ '^[0-9]{4}$' THEN
        RAISE EXCEPTION 'PIN must be exactly 4 digits';
    ELSIF NOT EXISTS (SELECT 1 FROM studies WHERE id = p_study) THEN
        RAISE EXCEPTION 'Study not found';
    ELSE
        INSERT INTO study_pins (study_id, pin_hash, updated_at)
        VALUES (p_study, crypt(p_pin, gen_salt('bf')), now())
        ON CONFLICT (study_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, updated_at = now();
        UPDATE studies SET pin_required = true, updated_at = now() WHERE id = p_study;
    END IF;
END;
$$;

-- Internal: PIN check used by enroll_participant (not executable by clients).
CREATE OR REPLACE FUNCTION verify_study_pin(p_study UUID, p_pin TEXT)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_hash TEXT;
BEGIN
    SELECT pin_hash INTO v_hash FROM study_pins WHERE study_id = p_study;
    IF v_hash IS NULL THEN RETURN true; END IF;
    RETURN crypt(p_pin, v_hash) = v_hash;
END;
$$;

-- ============================================================
-- ENROLMENT (anon) — PIN-gated, rate limited, idempotent, binds device token
-- ============================================================

CREATE FUNCTION enroll_participant(
    p_study UUID, p_device_id TEXT, p_pin TEXT DEFAULT NULL, p_device_info JSONB DEFAULT '{}'::jsonb,
    p_request_id UUID DEFAULT NULL, p_device_token TEXT DEFAULT NULL
)
RETURNS TABLE (participant_id UUID, device_id TEXT, error_message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_status TEXT; v_required BOOLEAN; v_resolved TEXT; v_suffix INT := 2; v_id UUID;
    v_locked TIMESTAMPTZ; v_fails INT; v_study_fails INT;
    v_token_hash TEXT; v_existing_hash TEXT;
    MAX_FAILS CONSTANT INT := 5; LOCK_MINUTES CONSTANT INT := 15;
    STUDY_WINDOW_MIN CONSTANT INT := 10; STUDY_MAX_FAILS CONSTANT INT := 50;
BEGIN
    IF p_device_token IS NULL OR length(p_device_token) < 32 THEN
        RAISE EXCEPTION 'Device token required';
    END IF;
    v_token_hash := encode(digest(p_device_token, 'sha256'), 'hex');

    -- Idempotent retry: same request id returns the row it created.
    IF p_request_id IS NOT NULL THEN
        SELECT p.id, p.device_id, p.device_token_hash INTO v_id, v_resolved, v_existing_hash
          FROM participants AS p
         WHERE p.enrollment_request_id = p_request_id AND p.study_id = p_study;
        IF v_id IS NOT NULL THEN
            IF v_existing_hash IS DISTINCT FROM v_token_hash THEN
                RAISE EXCEPTION 'Enrollment request reused with a different token';
            END IF;
            participant_id := v_id; device_id := v_resolved; error_message := NULL; RETURN NEXT; RETURN;
        END IF;
    END IF;

    SELECT s.status, s.pin_required INTO v_status, v_required FROM studies AS s WHERE s.id = p_study;
    IF v_status IS NULL THEN RAISE EXCEPTION 'Study not found'; END IF;
    IF v_status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'Study is not open for enrolment'; END IF;

    -- A token identifies exactly one participant row.
    IF EXISTS (SELECT 1 FROM participants AS p WHERE p.device_token_hash = v_token_hash) THEN
        RAISE EXCEPTION 'Device token already registered; generate a new token for a new enrolment';
    END IF;

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
    INSERT INTO participants (study_id, device_id, label, status, device_info, enrolled_at,
                              enrollment_request_id, device_token_hash)
    VALUES (p_study, v_resolved, 'Device ' || v_resolved, 'active', COALESCE(p_device_info, '{}'::jsonb), now(),
            p_request_id, v_token_hash)
    RETURNING id INTO v_id;
    participant_id := v_id; device_id := v_resolved; error_message := NULL; RETURN NEXT;
END;
$$;

-- ============================================================
-- DEVICE RPCs (anon; all keyed off the x-device-token header)
-- ============================================================
-- Each raises 'Unknown device' (PostgREST: HTTP 400) when the header is
-- missing or matches no participant.

CREATE FUNCTION device_get_participant()
RETURNS TABLE (
    id UUID, study_id UUID, device_id TEXT, status TEXT, merged_into UUID,
    canonical_id UUID, canonical_status TEXT, last_sync_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_own UUID := device_token_participant();
    v_canonical UUID;
BEGIN
    IF v_own IS NULL THEN
        RAISE EXCEPTION 'Unknown device';
    END IF;
    v_canonical := resolve_canonical_participant(v_own);
    RETURN QUERY
        SELECT p.id, p.study_id, p.device_id, p.status, p.merged_into,
               c.id, c.status, p.last_sync_at
          FROM participants AS p
          LEFT JOIN participants AS c ON c.id = v_canonical
         WHERE p.id = v_own;
END;
$$;

CREATE FUNCTION device_heartbeat(p_last_sync_at TIMESTAMPTZ, p_device_info JSONB, p_permissions JSONB)
RETURNS TABLE (id UUID, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_own UUID := device_token_participant();
    v_target UUID;
    v_id UUID;
    v_status TEXT;
BEGIN
    IF v_own IS NULL THEN
        RAISE EXCEPTION 'Unknown device';
    END IF;
    -- Canonical participant (even if withdrawn, so researchers still see the
    -- device is alive); fall back to the token's own row on a broken chain.
    v_target := COALESCE(resolve_canonical_participant(v_own), v_own);
    UPDATE participants AS p
       SET last_sync_at = LEAST(COALESCE(p_last_sync_at, now()), now()),
           device_info  = COALESCE(p_device_info, p.device_info),
           permissions  = COALESCE(p_permissions, p.permissions),
           updated_at   = now()
     WHERE p.id = v_target
    RETURNING p.id, p.status INTO v_id, v_status;
    id := v_id; status := v_status;
    RETURN NEXT;
END;
$$;

CREATE FUNCTION device_withdraw()
RETURNS TABLE (id UUID, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_own UUID := device_token_participant();
    v_target UUID;
    v_id UUID;
    v_status TEXT;
BEGIN
    IF v_own IS NULL THEN
        RAISE EXCEPTION 'Unknown device';
    END IF;
    v_target := COALESCE(resolve_canonical_participant(v_own), v_own);
    -- Idempotent: an already-withdrawn participant is left untouched.
    UPDATE participants AS p
       SET status = 'withdrawn'
     WHERE p.id = v_target AND p.status <> 'withdrawn';
    SELECT p.id, p.status INTO v_id, v_status FROM participants AS p WHERE p.id = v_target;
    id := v_id; status := v_status;
    RETURN NEXT;
END;
$$;

CREATE FUNCTION device_adopt_merge()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_own UUID := device_token_participant();
    v_primary UUID;
BEGIN
    IF v_own IS NULL THEN
        RAISE EXCEPTION 'Unknown device';
    END IF;
    SELECT p.merged_into INTO v_primary FROM participants AS p WHERE p.id = v_own;
    IF v_primary IS NULL THEN
        RETURN false;
    END IF;
    UPDATE participants AS p
       SET merge_adopted_at = COALESCE(p.merge_adopted_at, now())
     WHERE p.id = v_own;
    UPDATE participant_merge_audit AS a
       SET adopted_at = COALESCE(a.adopted_at, now())
     WHERE a.duplicate_participant_id = v_own AND a.primary_participant_id = v_primary;
    RETURN true;
END;
$$;

-- ============================================================
-- PRIVILEGES
-- ============================================================
-- clear_database.sql recreates the public schema, so Supabase's usual
-- default grants are gone; everything PostgREST roles can touch is granted
-- explicitly here. RLS policies do not grant access by themselves: a role
-- needs both the privilege below and a matching policy.

-- Start from nothing for the client roles.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- service_role (server-side only, bypasses RLS).
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- authenticated: table privileges for every table and view; RLS limits rows
-- to researchers (is_researcher()). researchers itself is read-only.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON researchers FROM authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION is_researcher() TO authenticated;          -- used by RLS policies
GRANT EXECUTE ON FUNCTION merge_participants(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_study_pin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION enroll_participant(UUID, TEXT, TEXT, JSONB, UUID, TEXT) TO authenticated;

-- anon (Android app): read non-draft config, insert own data, device RPCs.
GRANT SELECT ON studies, sensor_configs, esm_schedules, esm_questions TO anon;
GRANT INSERT ON
    data_app_usage, data_notifications, data_battery, data_calls, data_sms,
    data_esm_responses, data_location, data_light, data_screen_state,
    data_gestures, data_steps, data_proximity, data_gesture_pauses,
    data_permission_events, sync_log
TO anon;
-- INSERT ... ON CONFLICT (client_uuid) DO NOTHING needs SELECT on the arbiter
-- column. Paired with the "Device sees own upload ids" policy this exposes
-- only the client_uuid values of the device's own rows.
GRANT SELECT (client_uuid) ON
    data_app_usage, data_notifications, data_battery, data_calls, data_sms,
    data_esm_responses, data_location, data_light, data_screen_state,
    data_gestures, data_steps, data_proximity, data_gesture_pauses,
    data_permission_events, sync_log
TO anon;
GRANT USAGE ON SEQUENCE
    data_app_usage_id_seq, data_notifications_id_seq, data_battery_id_seq,
    data_calls_id_seq, data_sms_id_seq, data_esm_responses_id_seq,
    data_location_id_seq, data_light_id_seq, data_screen_state_id_seq,
    data_gestures_id_seq, data_steps_id_seq, data_proximity_id_seq,
    data_gesture_pauses_id_seq, data_permission_events_id_seq, sync_log_id_seq
TO anon;
GRANT EXECUTE ON FUNCTION enroll_participant(UUID, TEXT, TEXT, JSONB, UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION device_get_participant() TO anon;
GRANT EXECUTE ON FUNCTION device_heartbeat(TIMESTAMPTZ, JSONB, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION device_withdraw() TO anon;
GRANT EXECUTE ON FUNCTION device_adopt_merge() TO anon;
-- Required because the data-table INSERT policies call it as the anon role.
-- It only reveals the caller's own participant id for the token it sent.
GRANT EXECUTE ON FUNCTION device_participant_id() TO anon;

-- Reload PostgREST's schema cache so the new functions/columns are visible.
NOTIFY pgrst, 'reload schema';
