-- Run once in the Supabase SQL editor.
-- Server-side brute-force protection for study PINs. A 4-digit PIN has only
-- 10,000 combinations, so the lockout MUST be server-side (the app check alone is
-- bypassable by calling the RPC directly). Enforced inside enroll_participant.

-- Tracks failed PIN attempts. Keyed by study + the device_id the client claims,
-- with a study-wide guard so rotating device_id doesn't grant fresh budgets.
CREATE TABLE IF NOT EXISTS pin_attempts (
    study_id   UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    device_id  TEXT NOT NULL,
    fails      INT  NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_fail_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (study_id, device_id)
);
ALTER TABLE pin_attempts ENABLE ROW LEVEL SECURITY;
-- No anon access; only the SECURITY DEFINER function touches it. Researchers can
-- read it (to see/clear lockouts if needed).
CREATE POLICY "Authenticated read pin attempts" ON pin_attempts FOR ALL
    USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
REVOKE ALL ON pin_attempts FROM anon;
GRANT SELECT, UPDATE, DELETE ON pin_attempts TO authenticated;

-- Tunables (edit here):
--   MAX_FAILS         = 5    attempts per device before a lockout
--   LOCK_MINUTES      = 15   lockout duration once MAX_FAILS is hit
--   STUDY_WINDOW_MIN  = 10   window for the study-wide guard
--   STUDY_MAX_FAILS   = 50   total fails across all devices in that window

-- Rewritten enrolment: rate-limit the PIN check, then verify + insert.
CREATE OR REPLACE FUNCTION enroll_participant(
    p_study UUID, p_device_id TEXT, p_pin TEXT DEFAULT NULL, p_device_info JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (participant_id UUID, device_id TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_status TEXT;
    v_required BOOLEAN;
    v_resolved TEXT;
    v_suffix INT := 2;
    v_id UUID;
    v_locked TIMESTAMPTZ;
    v_fails INT;
    v_study_fails INT;
    MAX_FAILS CONSTANT INT := 5;
    LOCK_MINUTES CONSTANT INT := 15;
    STUDY_WINDOW_MIN CONSTANT INT := 10;
    STUDY_MAX_FAILS CONSTANT INT := 50;
BEGIN
    SELECT status, pin_required INTO v_status, v_required FROM studies WHERE id = p_study;
    IF v_status IS NULL THEN RAISE EXCEPTION 'Study not found'; END IF;
    IF v_status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'Study is not open for enrolment'; END IF;

    -- Only rate-limit when the study actually has a PIN.
    IF v_required THEN
        -- Per-device lockout check.
        SELECT locked_until, fails INTO v_locked, v_fails
          FROM pin_attempts WHERE study_id = p_study AND device_id = p_device_id;
        IF v_locked IS NOT NULL AND v_locked > now() THEN
            RAISE EXCEPTION 'Too many incorrect PIN attempts. Try again in % minutes.',
                CEIL(EXTRACT(EPOCH FROM (v_locked - now())) / 60.0)
                USING ERRCODE = 'P0002';
        END IF;

        -- Study-wide guard against device_id rotation.
        SELECT COALESCE(SUM(fails), 0) INTO v_study_fails
          FROM pin_attempts
         WHERE study_id = p_study
           AND last_fail_at > now() - make_interval(mins => STUDY_WINDOW_MIN);
        IF v_study_fails >= STUDY_MAX_FAILS THEN
            RAISE EXCEPTION 'This study is temporarily locked due to too many failed attempts. Try again later.'
                USING ERRCODE = 'P0002';
        END IF;

        -- Verify the PIN.
        IF NOT verify_study_pin(p_study, COALESCE(p_pin, '')) THEN
            INSERT INTO pin_attempts (study_id, device_id, fails, last_fail_at, locked_until)
            VALUES (p_study, p_device_id, 1, now(),
                    CASE WHEN 1 >= MAX_FAILS THEN now() + make_interval(mins => LOCK_MINUTES) END)
            ON CONFLICT (study_id, device_id) DO UPDATE
                SET fails = pin_attempts.fails + 1,
                    last_fail_at = now(),
                    locked_until = CASE WHEN pin_attempts.fails + 1 >= MAX_FAILS
                                        THEN now() + make_interval(mins => LOCK_MINUTES) END;
            SELECT fails INTO v_fails FROM pin_attempts WHERE study_id = p_study AND device_id = p_device_id;
            RAISE EXCEPTION 'Incorrect study PIN. % attempt(s) left before a temporary lockout.',
                GREATEST(MAX_FAILS - v_fails, 0)
                USING ERRCODE = 'P0003';
        END IF;

        -- Correct PIN: clear any failed-attempt record for this device.
        DELETE FROM pin_attempts WHERE study_id = p_study AND device_id = p_device_id;
    END IF;

    -- Resolve a free device_id and insert the participant.
    v_resolved := p_device_id;
    WHILE EXISTS (SELECT 1 FROM participants WHERE study_id = p_study AND device_id = v_resolved) LOOP
        v_resolved := p_device_id || '_' || v_suffix; v_suffix := v_suffix + 1;
    END LOOP;

    INSERT INTO participants (study_id, device_id, label, status, device_info, enrolled_at)
    VALUES (p_study, v_resolved, 'Device ' || v_resolved, 'active', COALESCE(p_device_info, '{}'::jsonb), now())
    RETURNING id INTO v_id;

    participant_id := v_id; device_id := v_resolved; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION enroll_participant(UUID, TEXT, TEXT, JSONB) TO anon, authenticated;
