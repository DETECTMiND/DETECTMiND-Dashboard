-- Run once in the Supabase SQL editor.
-- Gesture pause/resume event log (banking-pause data quality) + a processed view
-- that pairs each 'paused' with the next 'resumed' into a gap interval.

CREATE TABLE IF NOT EXISTS data_gesture_pauses (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    event TEXT NOT NULL,                -- paused | resumed
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gesture_pauses_participant ON data_gesture_pauses(participant_id, recorded_at);
ALTER TABLE data_gesture_pauses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON data_gesture_pauses FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Anon can insert sensor data" ON data_gesture_pauses FOR INSERT WITH CHECK (auth.role() = 'anon');

-- Pair paused -> next resumed into gaps. A still-open pause (no resume yet) has
-- resumed_at = null and an open-ended gap.
CREATE OR REPLACE VIEW gesture_pause_sessions
WITH (security_invoker = on) AS
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

GRANT SELECT ON gesture_pause_sessions TO authenticated;
