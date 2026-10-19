-- Only owners and admins add people to a study (reverts 2026-10-19_editors_can_invite.sql).
-- Run once in the Supabase SQL editor. No data is changed. A fresh
-- clear -> schema -> seed already includes this.

DROP POLICY IF EXISTS "Owners and editors add members" ON study_members;
DROP POLICY IF EXISTS "Owners add members" ON study_members;
CREATE POLICY "Owners add members" ON study_members FOR INSERT TO authenticated
    WITH CHECK ((SELECT is_admin()) OR (role IN ('editor', 'viewer') AND can_manage_study(study_id)));

CREATE OR REPLACE FUNCTION researcher_directory(p_study UUID DEFAULT NULL)
RETURNS TABLE (user_id UUID, email TEXT, display_name TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT (is_admin()
            OR (p_study IS NOT NULL AND COALESCE(study_role(p_study) = 'owner', false))
            OR (p_study IS NULL AND is_researcher()
                AND EXISTS (SELECT 1 FROM study_members m
                             WHERE m.user_id = auth.uid() AND m.role = 'owner'))) THEN
        RAISE EXCEPTION 'Only admins and owners of this study can list researchers' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT r.user_id, r.email, r.display_name FROM researchers r
         WHERE r.active ORDER BY r.email;
END;
$$;
