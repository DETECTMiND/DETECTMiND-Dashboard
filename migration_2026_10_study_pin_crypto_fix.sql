-- Run once in the Supabase SQL editor.
-- Fix: pgcrypto's crypt()/gen_salt() live in the `extensions` schema on Supabase,
-- but the PIN functions set search_path = public only, so crypt() was "not found"
-- (HTTP 404 / 42883 on enrol). Add `extensions` to their search_path.

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

CREATE OR REPLACE FUNCTION verify_study_pin(p_study UUID, p_pin TEXT)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_hash TEXT;
BEGIN
    SELECT pin_hash INTO v_hash FROM study_pins WHERE study_id = p_study;
    IF v_hash IS NULL THEN RETURN true; END IF;
    RETURN crypt(p_pin, v_hash) = v_hash;
END;
$$;
