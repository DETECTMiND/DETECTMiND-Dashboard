-- Run once in the Supabase SQL editor.
-- Participant merge: re-point all data from a duplicate participant onto a
-- primary one, in a single transaction. The duplicate is kept (soft-withdrawn
-- with a merged_into reference) so the merge is auditable and reversible.

-- 1. Track merges on the participant row.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES participants(id);
ALTER TABLE participants ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;

-- 2. The merge function. SECURITY INVOKER so it runs under the caller's RLS
--    (authenticated researchers only). All re-points happen in one transaction;
--    any failure rolls the whole thing back (no partial merges).
CREATE OR REPLACE FUNCTION merge_participants(p_primary UUID, p_duplicate UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_study_primary   UUID;
    v_study_duplicate UUID;
    v_moved jsonb := '{}'::jsonb;
    v_n bigint;
BEGIN
    IF p_primary = p_duplicate THEN
        RAISE EXCEPTION 'Primary and duplicate must differ';
    END IF;

    SELECT study_id INTO v_study_primary   FROM participants WHERE id = p_primary;
    SELECT study_id INTO v_study_duplicate FROM participants WHERE id = p_duplicate;
    IF v_study_primary IS NULL OR v_study_duplicate IS NULL THEN
        RAISE EXCEPTION 'Participant not found';
    END IF;
    IF v_study_primary <> v_study_duplicate THEN
        RAISE EXCEPTION 'Participants are in different studies';
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

    -- Soft-withdraw the duplicate and record the merge (kept, reversible).
    UPDATE participants
       SET status = 'withdrawn',
           merged_into = p_primary,
           merged_at = now(),
           updated_at = now()
     WHERE id = p_duplicate;

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

GRANT EXECUTE ON FUNCTION merge_participants(UUID, UUID) TO authenticated;
