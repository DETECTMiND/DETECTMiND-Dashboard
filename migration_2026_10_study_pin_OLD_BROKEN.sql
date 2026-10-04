-- Run once in the Supabase SQL editor.
-- Optional 4-digit study PIN so only participants given the PIN can enrol.
-- The PIN is stored HASHED and is never readable by the anon (app) role.
-- Verification happens server-side via a SECURITY DEFINER function.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pin_hash: bcrypt hash of the PIN, or NULL when the study has no PIN.
-- pin_required: a readable boolean the app can check to decide whether to prompt
--   (it never exposes the PIN itself).
ALTER TABLE studies ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE studies ADD COLUMN IF NOT EXISTS pin_required BOOLEAN NOT NULL DEFAULT false;

-- Keep pin_required in sync with whether a hash is set.
CREATE OR REPLACE FUNCTION sync_pin_required()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.pin_required := (NEW.pin_hash IS NOT NULL);
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_pin_required ON studies;
CREATE TRIGGER trg_sync_pin_required
    BEFORE INSERT OR UPDATE OF pin_hash ON studies
    FOR EACH ROW EXECUTE FUNCTION sync_pin_required();

-- IMPORTANT: the anon role must never read pin_hash. The existing
-- "Anon can read studies" SELECT policy returns all columns, so restrict the
-- anon grant to the non-secret columns only (authenticated researchers keep
-- full access via their own policy).
REVOKE SELECT ON studies FROM anon;
GRANT SELECT (id, name, description, app_description, status, config,
              sync_interval_minutes, created_by, created_at, updated_at,
              pin_required)
    ON studies TO anon;

-- Researcher (authenticated) sets or clears a study PIN. Pass NULL/'' to clear.
CREATE OR REPLACE FUNCTION set_study_pin(p_study UUID, p_pin TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER   -- runs as the researcher; their RLS allows UPDATE on studies
AS $$
BEGIN
    IF p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
        UPDATE studies SET pin_hash = NULL, updated_at = now() WHERE id = p_study;
    ELSIF p_pin !~ '^[0-9]{4}$' THEN
        RAISE EXCEPTION 'PIN must be exactly 4 digits';
    ELSE
        UPDATE studies
           SET pin_hash = crypt(p_pin, gen_salt('bf')), updated_at = now()
         WHERE id = p_study;
    END IF;
END;
$$;

-- App (anon) verifies a PIN without ever reading the hash. SECURITY DEFINER so
-- it can read pin_hash even though anon cannot select that column.
CREATE OR REPLACE FUNCTION verify_study_pin(p_study UUID, p_pin TEXT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hash TEXT;
BEGIN
    SELECT pin_hash INTO v_hash FROM studies WHERE id = p_study;
    IF v_hash IS NULL THEN
        RETURN true;   -- no PIN set on this study: nothing to check
    END IF;
    RETURN crypt(p_pin, v_hash) = v_hash;
END;
$$;

-- Atomic PIN-gated enrolment. The app calls this instead of inserting directly,
-- so the PIN check cannot be skipped. Verifies the PIN, resolves a unique
-- device_id (base, then _2, _3, ...), inserts the participant, and returns the
-- new row's id + resolved device_id. SECURITY DEFINER so it can read pin_hash
-- and insert under controlled logic.
CREATE OR REPLACE FUNCTION enroll_participant(
    p_study UUID,
    p_device_id TEXT,
    p_pin TEXT DEFAULT NULL,
    p_device_info JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (participant_id UUID, device_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_resolved TEXT;
    v_suffix INT := 2;
    v_id UUID;
BEGIN
    SELECT status INTO v_status FROM studies WHERE id = p_study;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Study not found';
    END IF;
    IF v_status NOT IN ('active', 'paused') THEN
        RAISE EXCEPTION 'Study is not open for enrolment';
    END IF;

    IF NOT verify_study_pin(p_study, COALESCE(p_pin, '')) THEN
        RAISE EXCEPTION 'Incorrect study PIN';
    END IF;

    -- Resolve a free device_id within this study.
    v_resolved := p_device_id;
    WHILE EXISTS (SELECT 1 FROM participants WHERE study_id = p_study AND device_id = v_resolved) LOOP
        v_resolved := p_device_id || '_' || v_suffix;
        v_suffix := v_suffix + 1;
    END LOOP;

    INSERT INTO participants (study_id, device_id, label, status, device_info, enrolled_at)
    VALUES (p_study, v_resolved, 'Device ' || v_resolved, 'active', COALESCE(p_device_info, '{}'::jsonb), now())
    RETURNING id INTO v_id;

    participant_id := v_id;
    device_id := v_resolved;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION set_study_pin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_study_pin(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION enroll_participant(UUID, TEXT, TEXT, JSONB) TO anon, authenticated;

-- OPTIONAL hardening (uncomment to fully enforce): once the app uses
-- enroll_participant everywhere, remove the ability for anon to insert
-- participants directly, so the PIN gate cannot be bypassed:
--   DROP POLICY "Anon can insert participants" ON participants;
