-- Run this entire file in the Supabase SQL editor. It supersedes the earlier
-- PIN RPC fixes and is safe to run again.
--
-- enroll_participant RETURNS TABLE (..., device_id TEXT), which creates a
-- PL/pgSQL output variable named device_id. Unqualified device_id references
-- inside the function are therefore ambiguous (PostgreSQL 42702) whenever the
-- PIN-required branch executes. Qualify every table column in the function.

DROP FUNCTION IF EXISTS enroll_participant(UUID, TEXT, TEXT, JSONB);

CREATE FUNCTION enroll_participant(
    p_study UUID, p_device_id TEXT, p_pin TEXT DEFAULT NULL, p_device_info JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (participant_id UUID, device_id TEXT, error_message TEXT)
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
    SELECT s.status, s.pin_required INTO v_status, v_required
      FROM studies AS s WHERE s.id = p_study;
    IF v_status IS NULL THEN RAISE EXCEPTION 'Study not found'; END IF;
    IF v_status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'Study is not open for enrolment'; END IF;

    IF v_required THEN
        SELECT pa.locked_until, pa.fails INTO v_locked, v_fails
          FROM pin_attempts AS pa
         WHERE pa.study_id = p_study AND pa.device_id = p_device_id;
        IF v_locked IS NOT NULL AND v_locked > now() THEN
            participant_id := NULL;
            device_id := NULL;
            error_message := format('Too many incorrect PIN attempts. Try again in %s minute(s).',
                CEIL(EXTRACT(EPOCH FROM (v_locked - now())) / 60.0));
            RETURN NEXT;
            RETURN;
        END IF;
        -- Once the timed lock expires, start a fresh attempt budget.
        IF v_locked IS NOT NULL THEN
            DELETE FROM pin_attempts AS pa
             WHERE pa.study_id = p_study AND pa.device_id = p_device_id;
            v_fails := 0;
        END IF;

        SELECT COALESCE(SUM(pa.fails), 0) INTO v_study_fails
          FROM pin_attempts AS pa
         WHERE pa.study_id = p_study
           AND pa.last_fail_at > now() - make_interval(mins => STUDY_WINDOW_MIN);
        IF v_study_fails >= STUDY_MAX_FAILS THEN
            participant_id := NULL;
            device_id := NULL;
            error_message := 'This study is temporarily locked due to too many failed attempts. Try again later.';
            RETURN NEXT;
            RETURN;
        END IF;

        IF NOT verify_study_pin(p_study, COALESCE(p_pin, '')) THEN
            INSERT INTO pin_attempts AS pa (study_id, device_id, fails, last_fail_at, locked_until)
            VALUES (p_study, p_device_id, 1, now(),
                    CASE WHEN 1 >= MAX_FAILS THEN now() + make_interval(mins => LOCK_MINUTES) END)
            ON CONFLICT ON CONSTRAINT pin_attempts_pkey DO UPDATE
                SET fails = pa.fails + 1,
                    last_fail_at = now(),
                    locked_until = CASE WHEN pa.fails + 1 >= MAX_FAILS
                                        THEN now() + make_interval(mins => LOCK_MINUTES) END;
            SELECT pa.fails INTO v_fails
              FROM pin_attempts AS pa
             WHERE pa.study_id = p_study AND pa.device_id = p_device_id;
            participant_id := NULL;
            device_id := NULL;
            error_message := CASE
                WHEN v_fails >= MAX_FAILS THEN
                    format('Too many incorrect PIN attempts. Try again in %s minutes.', LOCK_MINUTES)
                ELSE
                    format('Incorrect study PIN. %s attempt(s) left before a temporary lockout.',
                        MAX_FAILS - v_fails)
            END;
            RETURN NEXT;
            RETURN;
        END IF;

        DELETE FROM pin_attempts AS pa
         WHERE pa.study_id = p_study AND pa.device_id = p_device_id;
    END IF;

    v_resolved := p_device_id;
    WHILE EXISTS (
        SELECT 1 FROM participants AS p
         WHERE p.study_id = p_study AND p.device_id = v_resolved
    ) LOOP
        v_resolved := p_device_id || '_' || v_suffix;
        v_suffix := v_suffix + 1;
    END LOOP;

    INSERT INTO participants (study_id, device_id, label, status, device_info, enrolled_at)
    VALUES (p_study, v_resolved, 'Device ' || v_resolved, 'active', COALESCE(p_device_info, '{}'::jsonb), now())
    RETURNING id INTO v_id;

    participant_id := v_id;
    device_id := v_resolved;
    error_message := NULL;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION enroll_participant(UUID, TEXT, TEXT, JSONB) TO anon, authenticated;
