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
--   * Dashboard = Supabase Auth users with an ACTIVE row in
--     public.researchers (role admin | researcher). Admins see and manage
--     everything. Other researchers see only studies they are members of
--     (study_members: owner | editor | viewer), through can_view_study(),
--     can_edit_study() and can_manage_study(). Being merely
--     "authenticated" grants nothing.
--   * Admin-only: approving a study (draft -> anything), deleting a study,
--     assigning / removing study owners, researchers and the audit log.
--     Owners: pause / complete an approved study, manage editors and viewers,
--     delete participants. Editors: edit everything else in the study.
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
    created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
    config JSONB DEFAULT '{}', -- general study config
    sync_interval_minutes INT NOT NULL DEFAULT 30,
    -- Optional 4-digit enrolment PIN. The hash lives in study_pins (never
    -- readable by anon); this flag tells the app whether to prompt.
    pin_required BOOLEAN NOT NULL DEFAULT false,
    -- Admin approval. A study created by a non-admin starts as 'draft' with
    -- approved_at NULL ("pending approval"); only an admin can move it out of
    -- draft, which stamps these. Set only by tr_studies_status_guard().
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_studies_pending ON studies(created_at DESC) WHERE status = 'draft' AND approved_at IS NULL;

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
    -- Version of the consent text the participant accepted in the app, and
    -- when (set by enroll_participant; NULL for an app that did not send it).
    consent_version TEXT,
    consent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(study_id, device_id)
);

-- Dashboard users. Rows are created by the dashboard's server-side admin API
-- (service role) when an admin invites someone, or by seed_studies.sql.
--   role admin      : sees and manages every study, researcher and the audit log
--   role researcher : sees only studies they are a member of (study_members)
--   active = false  : no access at all (deactivated), row kept for the audit trail
-- email is copied at invite time for display (auth.users is not client-readable).
CREATE TABLE researchers (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'researcher' CHECK (role IN ('admin', 'researcher')),
    active BOOLEAN NOT NULL DEFAULT true,
    added_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-study access for non-admin researchers.
--   owner  : everything an editor can do + pause/complete an approved study,
--            add/change/remove editors and viewers, delete participants.
--            Owners are assigned and removed by admins only.
--   editor : edit study settings, sensors, surveys, PIN, participants (label/status, merge)
--   viewer : read-only
CREATE TABLE study_members (
    study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (study_id, user_id)
);
CREATE INDEX idx_study_members_user ON study_members(user_id);

-- Append-only record of sensitive actions. Admin-readable only. Written by
-- SECURITY DEFINER functions/triggers and by the dashboard's admin API.
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor UUID DEFAULT auth.uid(),
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_at ON audit_log(at DESC);
CREATE INDEX idx_audit_log_action ON audit_log(action, at DESC);

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
CREATE TRIGGER tr_researchers_updated_at BEFORE UPDATE ON researchers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- IDENTITY HELPERS (used by RLS policies, so defined before them)
-- ============================================================

-- True when the signed-in Supabase Auth user has an ACTIVE researchers row.
CREATE OR REPLACE FUNCTION is_researcher()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT auth.uid() IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.researchers r
                    WHERE r.user_id = auth.uid() AND r.active);
$$;

-- True for an active researcher with role admin.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT auth.uid() IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.researchers r
                    WHERE r.user_id = auth.uid() AND r.active AND r.role = 'admin');
$$;

-- The caller's study role (owner | editor | viewer), or NULL. Only for active
-- researchers; admins get NULL here and are handled by the can_* functions.
CREATE OR REPLACE FUNCTION study_role(p_study UUID)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT m.role
      FROM public.study_members m
      JOIN public.researchers r ON r.user_id = m.user_id AND r.active
     WHERE m.study_id = p_study AND m.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION can_view_study(p_study UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT is_admin() OR study_role(p_study) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION can_edit_study(p_study UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT is_admin() OR COALESCE(study_role(p_study) IN ('owner', 'editor'), false);
$$;

CREATE OR REPLACE FUNCTION can_manage_study(p_study UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT is_admin() OR COALESCE(study_role(p_study) = 'owner', false);
$$;

-- Set-returning forms of can_view_study / can_edit_study for RLS policies.
-- Policies call them as (SELECT ...) so they are evaluated once per statement
-- instead of once per row (dashboard reads of large data tables).
CREATE OR REPLACE FUNCTION viewable_study_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT CASE
        WHEN is_admin() THEN COALESCE((SELECT array_agg(s.id) FROM public.studies s), '{}')
        ELSE COALESCE((SELECT array_agg(m.study_id)
                         FROM public.study_members m
                         JOIN public.researchers r ON r.user_id = m.user_id AND r.active
                        WHERE m.user_id = auth.uid()), '{}')
    END;
$$;

CREATE OR REPLACE FUNCTION editable_study_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT CASE
        WHEN is_admin() THEN COALESCE((SELECT array_agg(s.id) FROM public.studies s), '{}')
        ELSE COALESCE((SELECT array_agg(m.study_id)
                         FROM public.study_members m
                         JOIN public.researchers r ON r.user_id = m.user_id AND r.active
                        WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'editor')), '{}')
    END;
$$;

-- Internal: append an audit_log row (not executable by clients).
CREATE OR REPLACE FUNCTION write_audit(p_action TEXT, p_target_type TEXT, p_target_id TEXT, p_details JSONB)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions
AS $$
    INSERT INTO public.audit_log(actor, action, target_type, target_id, details)
    VALUES (auth.uid(), p_action, p_target_type, p_target_id, COALESCE(p_details, '{}'::jsonb));
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
-- ACCESS-CONTROL TRIGGERS (study ownership, membership guards, audit)
-- ============================================================

-- The researcher who creates a study becomes its owner. SECURITY DEFINER
-- because the creator cannot insert into study_members yet (they are not an
-- owner until this row exists). No-op when there is no signed-in user (seed).
CREATE OR REPLACE FUNCTION tr_study_creator_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF auth.uid() IS NOT NULL
       AND EXISTS (SELECT 1 FROM researchers r WHERE r.user_id = auth.uid() AND r.active) THEN
        INSERT INTO study_members(study_id, user_id, role)
        VALUES (NEW.id, auth.uid(), 'owner')
        ON CONFLICT (study_id, user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tr_studies_creator_owner AFTER INSERT ON studies
    FOR EACH ROW EXECUTE FUNCTION tr_study_creator_owner();

-- True when the current statement comes straight from a client role
-- (PostgREST anon / authenticated) whose user is NOT an active admin. False
-- for admins and for trusted server-side contexts: the SQL editor and the
-- seed (postgres), the service role (dashboard admin API), and statements run
-- inside SECURITY DEFINER functions or FK cascades (those run as the table
-- owner and do their own permission checks). Only meaningful when called
-- from a SECURITY INVOKER function, so current_user is the caller's role.
CREATE OR REPLACE FUNCTION is_client_non_admin()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    SELECT current_user IN ('anon', 'authenticated') AND NOT is_admin();
$$;

-- Study approval and status rules (SECURITY INVOKER, see is_client_non_admin):
--   INSERT  non-admin: forced to status 'draft', approved_* NULL, created_by =
--           the caller ("pending approval"). Admin / server: a non-draft study
--           counts as approved (approved_at = now(), approved_by = caller); a
--           draft one is pending like any other.
--   UPDATE  * approved_at / approved_by: admins and the server only.
--           * leaving 'draft' (approval) or returning to 'draft': admins only.
--             Leaving draft stamps approved_at / approved_by if not set yet.
--           * active / paused / completed among themselves: owners and admins
--             (editors may edit every other column, but not status).
CREATE OR REPLACE FUNCTION tr_studies_status_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions AS $$
DECLARE
    v_limited BOOLEAN := is_client_non_admin();
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF v_limited THEN
            NEW.status      := 'draft';
            NEW.approved_at := NULL;
            NEW.approved_by := NULL;
            NEW.created_by  := auth.uid();
        ELSIF NEW.status = 'draft' THEN
            NEW.approved_at := NULL;
            NEW.approved_by := NULL;
        ELSE
            NEW.approved_at := COALESCE(NEW.approved_at, now());
            NEW.approved_by := COALESCE(NEW.approved_by, auth.uid());
        END IF;
        RETURN NEW;
    END IF;

    IF v_limited AND (NEW.approved_at IS DISTINCT FROM OLD.approved_at
                      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by) THEN
        RAISE EXCEPTION 'Only an admin can change a study''s approval' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;
    IF OLD.status = 'draft' THEN
        IF v_limited THEN
            RAISE EXCEPTION 'This study is waiting for admin approval. Only an admin can approve it.'
                USING ERRCODE = '42501';
        END IF;
        IF OLD.approved_at IS NULL THEN
            NEW.approved_at := COALESCE(NEW.approved_at, now());
            NEW.approved_by := COALESCE(NEW.approved_by, auth.uid());
        END IF;
    ELSIF NEW.status = 'draft' THEN
        IF v_limited THEN
            RAISE EXCEPTION 'Only an admin can move a study back to draft' USING ERRCODE = '42501';
        END IF;
    ELSIF v_limited AND NOT can_manage_study(NEW.id) THEN
        RAISE EXCEPTION 'Only a study owner or an admin can change the study status' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tr_studies_status_guard BEFORE INSERT OR UPDATE ON studies
    FOR EACH ROW EXECUTE FUNCTION tr_studies_status_guard();

-- Study audit: study_created, study_approved (first move out of draft),
-- study_status_changed (any other status change) and study_deleted (BEFORE
-- DELETE, so the name, owners and participant count are still readable; the
-- optional reason comes from delete_study()).
CREATE OR REPLACE FUNCTION tr_studies_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM write_audit('study_created', 'study', NEW.id::text,
            jsonb_build_object('study_name', NEW.name, 'status', NEW.status,
                               'approved', NEW.approved_at IS NOT NULL,
                               'created_by', NEW.created_by,
                               'email', (SELECT email FROM researchers WHERE user_id = NEW.created_by)));
        RETURN NULL;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            PERFORM write_audit(
                CASE WHEN OLD.status = 'draft' AND OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL
                     THEN 'study_approved' ELSE 'study_status_changed' END,
                'study', NEW.id::text,
                jsonb_build_object('study_name', NEW.name, 'from', OLD.status, 'to', NEW.status));
        END IF;
        RETURN NULL;
    END IF;
    -- DELETE
    PERFORM write_audit('study_deleted', 'study', OLD.id::text,
        jsonb_build_object(
            'study_name', OLD.name,
            'status', OLD.status,
            'approved', OLD.approved_at IS NOT NULL,
            'participant_count', (SELECT count(*) FROM participants p WHERE p.study_id = OLD.id),
            'owners', COALESCE((SELECT jsonb_agg(r.email ORDER BY r.email)
                                  FROM study_members m JOIN researchers r ON r.user_id = m.user_id
                                 WHERE m.study_id = OLD.id AND m.role = 'owner'), '[]'::jsonb),
            'reason', NULLIF(current_setting('detectmind.study_delete_reason', true), '')));
    RETURN OLD;
END;
$$;
CREATE TRIGGER tr_studies_audit AFTER INSERT OR UPDATE ON studies
    FOR EACH ROW EXECUTE FUNCTION tr_studies_audit();
CREATE TRIGGER tr_studies_audit_delete BEFORE DELETE ON studies
    FOR EACH ROW EXECUTE FUNCTION tr_studies_audit();

-- Membership rules:
--   * members must be researchers;
--   * a membership cannot be moved to another study or user (delete + add);
--   * a study always keeps at least one owner. Removals caused by deleting
--     the study itself, or the auth user, are allowed.
CREATE OR REPLACE FUNCTION tr_study_members_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF NOT EXISTS (SELECT 1 FROM researchers r WHERE r.user_id = NEW.user_id) THEN
            RAISE EXCEPTION 'Only researchers can be added to a study' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.study_id <> OLD.study_id OR NEW.user_id <> OLD.user_id) THEN
        RAISE EXCEPTION 'A membership cannot be moved; remove it and add a new one' USING ERRCODE = '23514';
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.role = 'owner'
       AND (TG_OP = 'DELETE' OR NEW.role <> 'owner') THEN
        -- Serialise concurrent owner changes on the same study.
        PERFORM 1 FROM studies WHERE id = OLD.study_id FOR UPDATE;
        IF FOUND
           AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id)
           AND NOT EXISTS (SELECT 1 FROM study_members m
                            WHERE m.study_id = OLD.study_id AND m.role = 'owner'
                              AND m.user_id <> OLD.user_id) THEN
            RAISE EXCEPTION 'A study must keep at least one owner. Make someone else owner first.'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tr_study_members_guard BEFORE INSERT OR UPDATE OR DELETE ON study_members
    FOR EACH ROW EXECUTE FUNCTION tr_study_members_guard();

-- Owner rows are admin-only: a study owner (or any other non-admin client) may
-- add, change and remove only editor / viewer memberships, so they can neither
-- create, promote to, demote nor remove an owner. SECURITY INVOKER (see
-- is_client_non_admin): the creator-becomes-owner trigger, FK cascades, the
-- seed and the service role are not affected. Paired with the WITH CHECK of
-- the study_members policies.
CREATE OR REPLACE FUNCTION tr_study_members_owner_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions AS $$
BEGIN
    IF is_client_non_admin()
       AND ((TG_OP IN ('UPDATE', 'DELETE') AND OLD.role = 'owner')
            OR (TG_OP IN ('INSERT', 'UPDATE') AND NEW.role = 'owner')) THEN
        RAISE EXCEPTION 'Only an admin can add, change or remove study owners' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tr_study_members_auth_guard BEFORE INSERT OR UPDATE OR DELETE ON study_members
    FOR EACH ROW EXECUTE FUNCTION tr_study_members_owner_guard();

-- Membership audit. Rows with role owner on either side are logged as
-- study_owner_assigned / study_owner_removed; editor / viewer changes as
-- study_member_added / _changed / _removed. Nothing is logged for rows removed
-- because the whole study is being deleted (study_deleted covers that).
CREATE OR REPLACE FUNCTION tr_study_members_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_study UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.study_id ELSE NEW.study_id END;
    v_user  UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
    v_name  TEXT;
    v_base  JSONB;
BEGIN
    SELECT s.name INTO v_name FROM studies s WHERE s.id = v_study;
    IF NOT FOUND THEN
        RETURN NULL;  -- study is being deleted
    END IF;
    v_base := jsonb_build_object('user_id', v_user, 'study_name', v_name,
                                 'email', (SELECT email FROM researchers WHERE user_id = v_user));
    IF TG_OP = 'INSERT' THEN
        PERFORM write_audit(CASE WHEN NEW.role = 'owner' THEN 'study_owner_assigned' ELSE 'study_member_added' END,
            'study', v_study::text, v_base || jsonb_build_object('role', NEW.role));
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            PERFORM write_audit(CASE WHEN NEW.role = 'owner' THEN 'study_owner_assigned'
                                     WHEN OLD.role = 'owner' THEN 'study_owner_removed'
                                     ELSE 'study_member_changed' END,
                'study', v_study::text, v_base || jsonb_build_object('from', OLD.role, 'to', NEW.role));
        END IF;
    ELSE
        PERFORM write_audit(CASE WHEN OLD.role = 'owner' THEN 'study_owner_removed' ELSE 'study_member_removed' END,
            'study', v_study::text, v_base || jsonb_build_object('role', OLD.role));
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER tr_study_members_audit AFTER INSERT OR UPDATE OR DELETE ON study_members
    FOR EACH ROW EXECUTE FUNCTION tr_study_members_audit();

-- Researchers: user_id/email are fixed, and the last active admin cannot be
-- demoted, deactivated or deleted (that would lock everyone out of admin).
CREATE OR REPLACE FUNCTION tr_researchers_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.user_id <> OLD.user_id THEN
        RAISE EXCEPTION 'researchers.user_id cannot change' USING ERRCODE = '23514';
    END IF;
    IF OLD.role = 'admin' AND OLD.active
       AND (TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NOT NEW.active)
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id)
       AND NOT EXISTS (SELECT 1 FROM researchers r
                        WHERE r.role = 'admin' AND r.active AND r.user_id <> OLD.user_id) THEN
        RAISE EXCEPTION 'This is the last active admin. Make another researcher admin first.'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tr_researchers_guard BEFORE UPDATE OR DELETE ON researchers
    FOR EACH ROW EXECUTE FUNCTION tr_researchers_guard();

CREATE OR REPLACE FUNCTION tr_researchers_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        PERFORM write_audit('researcher_role_changed', 'researcher', NEW.user_id::text,
            jsonb_build_object('email', NEW.email, 'from', OLD.role, 'to', NEW.role));
    END IF;
    IF NEW.active IS DISTINCT FROM OLD.active THEN
        PERFORM write_audit(CASE WHEN NEW.active THEN 'researcher_reactivated' ELSE 'researcher_deactivated' END,
            'researcher', NEW.user_id::text, jsonb_build_object('email', NEW.email));
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER tr_researchers_audit AFTER UPDATE ON researchers
    FOR EACH ROW EXECUTE FUNCTION tr_researchers_audit();

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
ALTER TABLE study_members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log               ENABLE ROW LEVEL SECURITY;

-- ── Researchers (dashboard) ─────────────────────────────────────────────────
-- Admins: everything. Other active researchers: only studies they are members
-- of, at the level of their study role. Inactive researchers and signed-in
-- users without a researchers row match no policy, so they see nothing.

-- Studies: any active researcher may create one (they become its owner; a
-- non-admin's study starts as a draft pending admin approval, see
-- tr_studies_status_guard). Owners/editors update; status changes are further
-- limited by that trigger. Only admins delete. Admins see every study,
-- including pending ones (status 'draft' AND approved_at IS NULL).
CREATE POLICY "Members read studies" ON studies FOR SELECT TO authenticated
    USING (id = ANY ((SELECT viewable_study_ids())::uuid[]));
CREATE POLICY "Researchers create studies" ON studies FOR INSERT TO authenticated
    WITH CHECK ((SELECT is_researcher()));
CREATE POLICY "Editors update studies" ON studies FOR UPDATE TO authenticated
    USING (id = ANY ((SELECT editable_study_ids())::uuid[]))
    WITH CHECK (id = ANY ((SELECT editable_study_ids())::uuid[]));
CREATE POLICY "Admins delete studies" ON studies FOR DELETE TO authenticated
    USING ((SELECT is_admin()));

-- Study configuration: read for members, write for owners/editors.
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['sensor_configs', 'esm_schedules'] LOOP
        EXECUTE format(
            'CREATE POLICY "Members read" ON public.%I FOR SELECT TO authenticated '
            'USING (study_id = ANY ((SELECT public.viewable_study_ids())::uuid[]))', t);
        EXECUTE format(
            'CREATE POLICY "Editors insert" ON public.%I FOR INSERT TO authenticated '
            'WITH CHECK (study_id = ANY ((SELECT public.editable_study_ids())::uuid[]))', t);
        EXECUTE format(
            'CREATE POLICY "Editors update" ON public.%I FOR UPDATE TO authenticated '
            'USING (study_id = ANY ((SELECT public.editable_study_ids())::uuid[])) '
            'WITH CHECK (study_id = ANY ((SELECT public.editable_study_ids())::uuid[]))', t);
        EXECUTE format(
            'CREATE POLICY "Editors delete" ON public.%I FOR DELETE TO authenticated '
            'USING (study_id = ANY ((SELECT public.editable_study_ids())::uuid[]))', t);
    END LOOP;
END $$;

CREATE POLICY "Members read" ON esm_questions FOR SELECT TO authenticated
    USING (schedule_id IN (SELECT es.id FROM esm_schedules es
                            WHERE es.study_id = ANY ((SELECT viewable_study_ids())::uuid[])));
CREATE POLICY "Editors insert" ON esm_questions FOR INSERT TO authenticated
    WITH CHECK (schedule_id IN (SELECT es.id FROM esm_schedules es
                                 WHERE es.study_id = ANY ((SELECT editable_study_ids())::uuid[])));
CREATE POLICY "Editors update" ON esm_questions FOR UPDATE TO authenticated
    USING (schedule_id IN (SELECT es.id FROM esm_schedules es
                            WHERE es.study_id = ANY ((SELECT editable_study_ids())::uuid[])))
    WITH CHECK (schedule_id IN (SELECT es.id FROM esm_schedules es
                                 WHERE es.study_id = ANY ((SELECT editable_study_ids())::uuid[])));
CREATE POLICY "Editors delete" ON esm_questions FOR DELETE TO authenticated
    USING (schedule_id IN (SELECT es.id FROM esm_schedules es
                            WHERE es.study_id = ANY ((SELECT editable_study_ids())::uuid[])));

-- Participants: read for members, update (label/status) for owners/editors.
-- Created only by enroll_participant(); deleted only by delete_participant().
CREATE POLICY "Members read participants" ON participants FOR SELECT TO authenticated
    USING (study_id = ANY ((SELECT viewable_study_ids())::uuid[]));
CREATE POLICY "Editors update participants" ON participants FOR UPDATE TO authenticated
    USING (study_id = ANY ((SELECT editable_study_ids())::uuid[]))
    WITH CHECK (study_id = ANY ((SELECT editable_study_ids())::uuid[]));

-- Collected data and sync health: read-only for members of the study.
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
            'CREATE POLICY "Members read data" ON public.%I FOR SELECT TO authenticated '
            'USING (participant_id IN (SELECT p.id FROM public.participants p '
            'WHERE p.study_id = ANY ((SELECT public.viewable_study_ids())::uuid[])))', t);
    END LOOP;
END $$;

-- Merge history: read for members (written by merge_participants()).
CREATE POLICY "Members read merge audit" ON participant_merge_audit FOR SELECT TO authenticated
    USING (study_id = ANY ((SELECT viewable_study_ids())::uuid[]));

-- PIN lockouts: read for members, clear for owners/editors. study_pins has no
-- client policy at all: the hash is only touched by set_study_pin().
CREATE POLICY "Members read pin attempts" ON pin_attempts FOR SELECT TO authenticated
    USING (study_id = ANY ((SELECT viewable_study_ids())::uuid[]));
CREATE POLICY "Editors clear pin attempts" ON pin_attempts FOR DELETE TO authenticated
    USING (study_id = ANY ((SELECT editable_study_ids())::uuid[]));

-- Team: members see the team. Admins manage every membership; an owner
-- manages only editor / viewer memberships of their own study; an editor may
-- add editors and viewers (not change or remove anyone). The policies
-- check the NEW role; tr_study_members_owner_guard also checks the OLD role
-- (UPDATE/DELETE of an owner row) and raises a clear error instead of
-- silently matching no rows.
CREATE POLICY "Members read team" ON study_members FOR SELECT TO authenticated
    USING (study_id = ANY ((SELECT viewable_study_ids())::uuid[]));
CREATE POLICY "Owners and editors add members" ON study_members FOR INSERT TO authenticated
    WITH CHECK ((SELECT is_admin()) OR (role IN ('editor', 'viewer') AND can_edit_study(study_id)));
CREATE POLICY "Owners change members" ON study_members FOR UPDATE TO authenticated
    USING (can_manage_study(study_id))
    WITH CHECK ((SELECT is_admin()) OR (role IN ('editor', 'viewer') AND can_manage_study(study_id)));
CREATE POLICY "Owners remove members" ON study_members FOR DELETE TO authenticated
    USING (can_manage_study(study_id));

-- Researchers: everyone reads their own row (role/active, for the UI); admins
-- read and update all. Rows are inserted by the server admin API or the seed.
CREATE POLICY "Read own researcher row" ON researchers FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()) OR (SELECT is_admin()));
CREATE POLICY "Admins update researchers" ON researchers FOR UPDATE TO authenticated
    USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));

-- Audit log: admins only, read-only.
CREATE POLICY "Admins read audit log" ON audit_log FOR SELECT TO authenticated
    USING ((SELECT is_admin()));

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
-- researchers see rows (anon has no privileges on any view).
--
-- A screen-on "session" runs from a cleaned 'on' transition to the next 'off'.
-- The app logs a wake as two events ('on' then 'unlocked') and a sleep as two
-- ('off' then 'locked'), and often drops the closing event entirely when the OS
-- kills it. We collapse the raw stream to clean ALTERNATING on/off transitions,
-- then pair each 'on' with the next transition -- so sessions can never overlap
-- and no hour can exceed 60 minutes. A missing or implausibly long close is
-- capped at 3 hours (long enough not to truncate a normal session, short enough
-- that a dropped close cannot invent a day of usage). daily_usage is rolled up
-- from hourly_usage, so the daily total always equals the sum of that day's
-- hourly cells. All timestamps are bucketed in the single fixed zone returned by
-- app_tz() (formerly migration_2026_10_usage_views_fix.sql, now folded in).

-- One place to set the bucketing timezone for every summary view. Views call
-- it as the researcher, so authenticated is granted EXECUTE (see PRIVILEGES).
CREATE OR REPLACE FUNCTION app_tz() RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 'Europe/London' $$;

CREATE OR REPLACE VIEW screen_sessions
WITH (security_invoker = true) AS
WITH normalized AS (
    SELECT
        participant_id,
        recorded_at::timestamptz AS ts,
        id,
        CASE WHEN state IN ('on', 'unlocked') THEN 'on' ELSE 'off' END AS dir
    FROM data_screen_state
    WHERE state IN ('on', 'off', 'locked', 'unlocked')
),
-- Keep only direction CHANGES, so the stream strictly alternates on,off,on,off.
-- (id breaks ties when two events share a timestamp, keeping the order stable.)
deduped AS (
    SELECT participant_id, ts, dir
    FROM (
        SELECT
            participant_id, ts, dir,
            LAG(dir) OVER (PARTITION BY participant_id ORDER BY ts, id) AS prev_dir
        FROM normalized
    ) t
    WHERE prev_dir IS DISTINCT FROM dir
),
paired AS (
    SELECT
        participant_id,
        ts AS start_ts,
        dir,
        LEAD(ts)  OVER (PARTITION BY participant_id ORDER BY ts) AS next_ts,
        LEAD(dir) OVER (PARTITION BY participant_id ORDER BY ts) AS next_dir
    FROM deduped
)
SELECT
    participant_id,
    start_ts,
    LEAST(COALESCE(next_ts, start_ts + interval '3 hours'),
          start_ts + interval '3 hours') AS end_ts,
    (next_ts IS NULL
     OR next_ts - start_ts > interval '3 hours') AS was_capped
FROM paired
WHERE dir = 'on';

-- Single source of truth for screen-on time; daily_usage rolls up from it.
CREATE OR REPLACE VIEW hourly_usage
WITH (security_invoker = true) AS
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

CREATE OR REPLACE VIEW daily_usage
WITH (security_invoker = true) AS
WITH hourly AS (
    SELECT participant_id, usage_date, SUM(screen_on_seconds) AS screen_on_seconds
    FROM hourly_usage
    GROUP BY participant_id, usage_date
),
sessions AS (
    SELECT
        participant_id,
        (start_ts AT TIME ZONE app_tz())::date AS usage_date,
        COUNT(*)                                        AS session_count,
        AVG(EXTRACT(EPOCH FROM (end_ts - start_ts)))    AS avg_session_seconds,
        SUM(CASE WHEN was_capped THEN 1 ELSE 0 END)     AS capped_sessions
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

CREATE OR REPLACE VIEW daily_app_usage
WITH (security_invoker = true) AS
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

CREATE OR REPLACE VIEW hourly_app_usage
WITH (security_invoker = true) AS
SELECT
    participant_id,
    date_trunc('hour', start_time AT TIME ZONE app_tz()) AT TIME ZONE app_tz() AS usage_hour,
    (start_time AT TIME ZONE app_tz())::date                        AS usage_date,
    EXTRACT(HOUR FROM start_time AT TIME ZONE app_tz())::int        AS hour_of_day,
    package_name,
    MAX(app_name)                          AS app_name,
    SUM(duration_seconds)                  AS foreground_seconds,
    ROUND(SUM(duration_seconds) / 60.0, 1) AS foreground_minutes,
    COUNT(*)                               AS open_count
FROM data_app_usage
GROUP BY participant_id, 2, 3, 4, package_name;

CREATE OR REPLACE VIEW daily_app_usage_total
WITH (security_invoker = true) AS
SELECT
    participant_id,
    (start_time AT TIME ZONE app_tz())::date AS usage_date,
    SUM(duration_seconds)                    AS total_foreground_seconds,
    ROUND(SUM(duration_seconds) / 60.0, 1)   AS total_foreground_minutes,
    ROUND(SUM(duration_seconds) / 3600.0, 2) AS total_foreground_hours,
    COUNT(DISTINCT package_name)             AS unique_apps,
    COUNT(*)                                 AS total_opens
FROM data_app_usage
GROUP BY participant_id, 2;

CREATE OR REPLACE VIEW daily_pickups
WITH (security_invoker = true) AS
SELECT
    participant_id,
    (recorded_at::timestamptz AT TIME ZONE app_tz())::date AS usage_date,
    EXTRACT(HOUR FROM recorded_at::timestamptz AT TIME ZONE app_tz())::int AS hour_of_day,
    COUNT(*) AS pickups
FROM data_screen_state
WHERE state = 'unlocked'
GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW daily_first_last_use
WITH (security_invoker = true) AS
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
WITH (security_invoker = true) AS
SELECT
    participant_id,
    (posted_at::timestamptz AT TIME ZONE app_tz())::date AS usage_date,
    COUNT(*)                                               AS notifications,
    COUNT(DISTINCT package_name)                           AS distinct_apps,
    COUNT(*) FILTER (WHERE removal_reason = 'clicked')     AS opened
FROM data_notifications
GROUP BY 1, 2;

CREATE OR REPLACE VIEW daily_battery_summary
WITH (security_invoker = true) AS
SELECT
    participant_id,
    (recorded_at::timestamptz AT TIME ZONE app_tz())::date AS usage_date,
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
    (recorded_at::timestamptz AT TIME ZONE app_tz())::date AS usage_date,
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
    (ts AT TIME ZONE app_tz())::date AS pause_date,
    CASE WHEN next_event = 'resumed'
         THEN ROUND(EXTRACT(EPOCH FROM (next_ts - ts)) / 60.0, 1)
    END AS gap_minutes
FROM ordered
WHERE event = 'paused';

-- Pair each 'revoked' with the next 'granted' for the same participant+permission
-- into an outage interval. A still-revoked permission has restored_at = null.
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
    (ts AT TIME ZONE app_tz())::date AS outage_date,
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
        (recorded_at AT TIME ZONE app_tz())::date AS usage_date,
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
-- PARTICIPANT MERGE (study owners/editors and admins)
-- ============================================================
-- SECURITY DEFINER so it can write audit_log; it checks can_edit_study() on
-- the participants' study itself. All re-points happen in one transaction;
-- any failure rolls the whole thing back (no partial merges).
CREATE OR REPLACE FUNCTION merge_participants(p_primary UUID, p_duplicate UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
    IF NOT can_edit_study(v_study_primary) THEN
        RAISE EXCEPTION 'You need editor or owner access to this study to merge participants'
            USING ERRCODE = '42501';
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

    INSERT INTO participant_merge_audit(study_id, primary_participant_id, duplicate_participant_id, merged_by)
    VALUES(v_study_primary, p_primary, p_duplicate, auth.uid());

    PERFORM write_audit('participant_merged', 'participant', p_primary::text,
        jsonb_build_object('study_id', v_study_primary, 'duplicate', p_duplicate, 'moved', v_moved));

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

-- Owner/editor (or admin) sets/clears a study PIN (NULL/'' clears it).
-- SECURITY DEFINER so it does not depend on the caller's access to pgcrypto
-- in the extensions schema; it checks can_edit_study() itself.
CREATE OR REPLACE FUNCTION set_study_pin(p_study UUID, p_pin TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT can_edit_study(p_study) THEN
        RAISE EXCEPTION 'You need editor or owner access to this study to change its PIN'
            USING ERRCODE = '42501';
    END IF;
    IF p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
        DELETE FROM study_pins WHERE study_id = p_study;
        UPDATE studies SET pin_required = false, updated_at = now() WHERE id = p_study;
        PERFORM write_audit('study_pin_changed', 'study', p_study::text, jsonb_build_object('pin_required', false));
    ELSIF p_pin !~ '^[0-9]{4}$' THEN
        RAISE EXCEPTION 'PIN must be exactly 4 digits';
    ELSIF NOT EXISTS (SELECT 1 FROM studies WHERE id = p_study) THEN
        RAISE EXCEPTION 'Study not found';
    ELSE
        INSERT INTO study_pins (study_id, pin_hash, updated_at)
        VALUES (p_study, crypt(p_pin, gen_salt('bf')), now())
        ON CONFLICT (study_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, updated_at = now();
        UPDATE studies SET pin_required = true, updated_at = now() WHERE id = p_study;
        PERFORM write_audit('study_pin_changed', 'study', p_study::text, jsonb_build_object('pin_required', true));
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
    p_request_id UUID DEFAULT NULL, p_device_token TEXT DEFAULT NULL,
    p_consent_version TEXT DEFAULT NULL
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
                              enrollment_request_id, device_token_hash, consent_version, consent_at)
    VALUES (p_study, v_resolved, 'Device ' || v_resolved, 'active', COALESCE(p_device_info, '{}'::jsonb), now(),
            p_request_id, v_token_hash,
            NULLIF(left(trim(p_consent_version), 64), ''),
            CASE WHEN NULLIF(trim(p_consent_version), '') IS NOT NULL THEN now() END)
    RETURNING id INTO v_id;
    participant_id := v_id; device_id := v_resolved; error_message := NULL; RETURN NEXT;
END;
$$;

-- ============================================================
-- PARTICIPANT DELETION (study owners and admins)
-- ============================================================
-- Permanently removes a participant and everything collected from them.
-- Refuses while other participants are merged into this one (delete those
-- first, so no data is orphaned or silently re-homed). Returns and audits the
-- number of rows removed per table.
CREATE OR REPLACE FUNCTION delete_participant(p_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_p       participants%ROWTYPE;
    v_counts  jsonb := '{}'::jsonb;
    v_n       bigint;
    v_merged  TEXT;
    t         TEXT;
BEGIN
    SELECT * INTO v_p FROM participants WHERE id = p_id FOR UPDATE;
    IF v_p.id IS NULL THEN
        RAISE EXCEPTION 'Participant not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT can_manage_study(v_p.study_id) THEN
        RAISE EXCEPTION 'Only a study owner or an admin can delete participants' USING ERRCODE = '42501';
    END IF;
    SELECT string_agg(COALESCE(label, device_id), ', ') INTO v_merged
      FROM participants WHERE merged_into = p_id;
    IF v_merged IS NOT NULL THEN
        RAISE EXCEPTION 'Other participants are merged into this one (%). Delete them first.', v_merged
            USING ERRCODE = '23503';
    END IF;

    FOREACH t IN ARRAY ARRAY[
        'data_app_usage', 'data_notifications', 'data_battery', 'data_calls', 'data_sms',
        'data_esm_responses', 'data_location', 'data_light', 'data_screen_state',
        'data_gestures', 'data_steps', 'data_proximity', 'data_gesture_pauses',
        'data_permission_events', 'sync_log'
    ] LOOP
        EXECUTE format('DELETE FROM public.%I WHERE participant_id = $1', t) USING p_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_counts := v_counts || jsonb_build_object(t, v_n);
    END LOOP;

    DELETE FROM participant_merge_audit
     WHERE primary_participant_id = p_id OR duplicate_participant_id = p_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('participant_merge_audit', v_n);

    DELETE FROM participants WHERE id = p_id;

    PERFORM write_audit('participant_deleted', 'participant', p_id::text,
        jsonb_build_object('study_id', v_p.study_id, 'device_id', v_p.device_id,
                           'label', v_p.label, 'counts', v_counts));

    RETURN jsonb_build_object('participant_id', p_id, 'study_id', v_p.study_id, 'counts', v_counts);
END;
$$;

-- ============================================================
-- TEAM HELPERS (dashboard)
-- ============================================================
-- researchers is only readable row-by-row (own row) for non-admins, so these
-- return just the display fields the Team tab needs.

-- The team of a study, with each member's email. Members of the study only.
CREATE OR REPLACE FUNCTION study_team(p_study UUID)
RETURNS TABLE (user_id UUID, email TEXT, display_name TEXT, member_role TEXT,
               researcher_active BOOLEAN, added_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT can_view_study(p_study) THEN
        RAISE EXCEPTION 'Not a member of this study' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT m.user_id, r.email, r.display_name, m.role, COALESCE(r.active, false), m.added_at
          FROM study_members m
          LEFT JOIN researchers r ON r.user_id = m.user_id
         WHERE m.study_id = p_study
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, r.email;
END;
$$;

-- Active researchers that can be added to study p_study: callable by an
-- admin, or by an owner or editor of that study. p_study NULL is the legacy form
-- (admin, or owner of any study); kept for older dashboard builds.
CREATE OR REPLACE FUNCTION researcher_directory(p_study UUID DEFAULT NULL)
RETURNS TABLE (user_id UUID, email TEXT, display_name TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT (is_admin()
            OR (p_study IS NOT NULL AND COALESCE(study_role(p_study) IN ('owner', 'editor'), false))
            OR (p_study IS NULL AND is_researcher()
                AND EXISTS (SELECT 1 FROM study_members m
                             WHERE m.user_id = auth.uid() AND m.role = 'owner'))) THEN
        RAISE EXCEPTION 'Only admins, owners and editors of this study can list researchers' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT r.user_id, r.email, r.display_name FROM researchers r
         WHERE r.active ORDER BY r.email;
END;
$$;

-- ============================================================
-- STUDY DELETION (admins only)
-- ============================================================
-- Same as DELETE FROM studies (admin RLS policy) but records an optional
-- reason, e.g. when rejecting a pending study, in the study_deleted audit row.
CREATE OR REPLACE FUNCTION delete_study(p_study UUID, p_reason TEXT DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_name TEXT;
    v_participants BIGINT;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Only an admin can delete a study' USING ERRCODE = '42501';
    END IF;
    SELECT s.name INTO v_name FROM studies s WHERE s.id = p_study FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Study not found' USING ERRCODE = 'P0002';
    END IF;
    SELECT count(*) INTO v_participants FROM participants WHERE study_id = p_study;
    PERFORM set_config('detectmind.study_delete_reason', COALESCE(left(p_reason, 1000), ''), true);
    DELETE FROM studies WHERE id = p_study;
    PERFORM set_config('detectmind.study_delete_reason', '', true);
    RETURN jsonb_build_object('study_id', p_study, 'study_name', v_name,
                              'participant_count', v_participants);
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
-- to admins and study members (see ROW LEVEL SECURITY).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
-- Tables the dashboard only reads (writes go through SECURITY DEFINER
-- functions, the device, or the server admin API). Belt and braces on top of RLS.
REVOKE INSERT, UPDATE, DELETE ON
    researchers, audit_log, study_pins, participant_merge_audit,
    data_app_usage, data_notifications, data_battery, data_calls, data_sms,
    data_esm_responses, data_location, data_light, data_screen_state,
    data_gestures, data_steps, data_proximity, data_gesture_pauses,
    data_permission_events, sync_log
FROM authenticated;
REVOKE INSERT, DELETE ON participants FROM authenticated;    -- enroll_/delete_participant()
REVOKE INSERT, UPDATE ON pin_attempts FROM authenticated;    -- clear (DELETE) only
REVOKE SELECT ON study_pins FROM authenticated;              -- the hash is never client-readable
GRANT UPDATE (display_name, role, active) ON researchers TO authenticated;  -- admins only (RLS)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
-- Used by RLS policies (the caller needs EXECUTE):
GRANT EXECUTE ON FUNCTION is_researcher() TO authenticated;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION study_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_view_study(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_edit_study(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_manage_study(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION viewable_study_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION editable_study_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION is_client_non_admin() TO authenticated;      -- used by SECURITY INVOKER guard triggers
GRANT EXECUTE ON FUNCTION app_tz() TO authenticated;                 -- used by the processed views (security_invoker)
-- Dashboard RPCs (each checks the caller's study permission itself):
GRANT EXECUTE ON FUNCTION merge_participants(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_study_pin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_participant(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION study_team(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION researcher_directory(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_study(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION enroll_participant(UUID, TEXT, TEXT, JSONB, UUID, TEXT, TEXT) TO authenticated;

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
GRANT EXECUTE ON FUNCTION enroll_participant(UUID, TEXT, TEXT, JSONB, UUID, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION device_get_participant() TO anon;
GRANT EXECUTE ON FUNCTION device_heartbeat(TIMESTAMPTZ, JSONB, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION device_withdraw() TO anon;
GRANT EXECUTE ON FUNCTION device_adopt_merge() TO anon;
-- Required because the data-table INSERT policies call it as the anon role.
-- It only reveals the caller's own participant id for the token it sent.
GRANT EXECUTE ON FUNCTION device_participant_id() TO anon;

-- Reload PostgREST's schema cache so the new functions/columns are visible.
NOTIFY pgrst, 'reload schema';
