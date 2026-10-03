-- Run once in the Supabase SQL editor.
-- Permission grant/revoke audit log: a timestamped record of when participants
-- turned a permission off and back on, for coverage/data-quality analysis.

CREATE TABLE IF NOT EXISTS data_permission_events (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,   -- location_fine, usage_access, accessibility, sms, …
    action TEXT NOT NULL,       -- granted | revoked
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_permission_events_participant ON data_permission_events(participant_id, recorded_at);
ALTER TABLE data_permission_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON data_permission_events FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Anon can insert sensor data" ON data_permission_events FOR INSERT WITH CHECK (auth.role() = 'anon');

-- Pair each 'revoked' with the next 'granted' for the same participant+permission
-- into an outage interval (how long a permission was off). A still-revoked
-- permission has restored_at = null and an open gap.
CREATE OR REPLACE VIEW permission_outages
WITH (security_invoker = on) AS
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
    (ts AT TIME ZONE 'Europe/London')::date AS outage_date,
    CASE WHEN next_action = 'granted'
         THEN ROUND(EXTRACT(EPOCH FROM (next_ts - ts)) / 60.0, 1)
    END AS outage_minutes
FROM ordered
WHERE action = 'revoked';

GRANT SELECT ON permission_outages TO authenticated;
