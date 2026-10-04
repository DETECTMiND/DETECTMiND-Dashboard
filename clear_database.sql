-- ============================================================
-- DESTRUCTIVE: remove every application object in the public schema.
-- Supabase Auth users and objects in auth/storage/extensions are preserved.
-- Next run supabase_schema.sql, then seed_studies.sql.
-- ============================================================

BEGIN;

-- Deliberate confirmation guard. Do not change only the check below: the SET
-- and expected value must agree, making accidental partial execution fail.
SET LOCAL app.confirm_public_schema_reset = 'DELETE PARTICIPANT MONITOR DATA';

DO $$
BEGIN
  IF current_setting('app.confirm_public_schema_reset', true)
       <> 'DELETE PARTICIPANT MONITOR DATA' THEN
    RAISE EXCEPTION 'Reset confirmation missing';
  END IF;
END $$;

DROP SCHEMA public CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;

COMMIT;
