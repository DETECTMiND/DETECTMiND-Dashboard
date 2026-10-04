-- Run once in the Supabase SQL editor.
-- FIX for migration_2026_10_study_pin.sql, which broke anon reads of `studies`
-- (HTTP 401) by revoking the table-level SELECT grant. This restores the grant
-- and moves the PIN hash into a SEPARATE table that anon cannot read at all, so
-- the secret is protected without touching the studies grant.

-- 1. Restore the table-level SELECT grant the app needs.
GRANT SELECT ON studies TO anon;

-- 2. Move the hash off `studies` into a table anon has no privileges on.
CREATE TABLE IF NOT EXISTS study_pins (
    study_id UUID PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE study_pins ENABLE ROW LEVEL SECURITY;
-- Only authenticated researchers may read/manage rows directly; anon gets nothing.
DROP POLICY IF EXISTS "Authenticated manage study pins" ON study_pins;
CREATE POLICY "Authenticated manage study pins" ON study_pins FOR ALL
    USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
REVOKE ALL ON study_pins FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON study_pins TO authenticated;

-- 3. Migrate any hashes that the first migration put on studies.pin_hash.
INSERT INTO study_pins (study_id, pin_hash)
SELECT id, pin_hash FROM studies WHERE pin_hash IS NOT NULL
ON CONFLICT (study_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash;

-- 4. studies.pin_required stays (readable). Drop the now-unused hash column and
--    the trigger that maintained it from studies.
DROP TRIGGER IF EXISTS trg_sync_pin_required ON studies;
DROP FUNCTION IF EXISTS sync_pin_required();
ALTER TABLE studies DROP COLUMN IF EXISTS pin_hash;

-- 5. Rewrite the functions to use study_pins and keep pin_required in sync.
CREATE OR REPLACE FUNCTION set_study_pin(p_study UUID, p_pin TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER   -- researcher; their RLS allows managing studies + study_pins
AS $$
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
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hash TEXT;
BEGIN
    SELECT pin_hash INTO v_hash FROM study_pins WHERE study_id = p_study;
    IF v_hash IS NULL THEN
        RETURN true;   -- no PIN on this study
    END IF;
    RETURN crypt(p_pin, v_hash) = v_hash;
END;
$$;

-- enroll_participant is unchanged logically; recreate to be safe (it calls
-- verify_study_pin, which now reads study_pins).
-- (No change needed if it already exists from the first migration.)

GRANT EXECUTE ON FUNCTION set_study_pin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_study_pin(UUID, TEXT) TO anon, authenticated;
