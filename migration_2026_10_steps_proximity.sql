-- Run once in the Supabase SQL editor.
-- New raw sensor tables for step counts and proximity/orientation, plus a
-- daily_steps processed view. Mirrors the RLS of the other data_* tables:
-- anon (the app) can INSERT, authenticated (researchers) have full access.

-- ── Allow the new sensor types in sensor_configs ─────────────────────────────
-- The sensor_configs.sensor_type CHECK constraint must include the new types or
-- the dashboard/app cannot create their config rows.
ALTER TABLE sensor_configs DROP CONSTRAINT IF EXISTS sensor_configs_sensor_type_check;
ALTER TABLE sensor_configs ADD CONSTRAINT sensor_configs_sensor_type_check
  CHECK (sensor_type IN (
    'app_usage', 'notifications', 'battery', 'calls', 'sms',
    'location', 'light', 'screen_state', 'gestures',
    'steps', 'proximity'
  ));

-- Add steps + proximity configs to every existing study that lacks them.
INSERT INTO sensor_configs (study_id, sensor_type, enabled, interval_seconds, config)
SELECT s.id, v.sensor_type, true, v.interval_seconds, '{}'::jsonb
FROM studies s
CROSS JOIN (VALUES ('steps', 300), ('proximity', 60)) AS v(sensor_type, interval_seconds)
ON CONFLICT (study_id, sensor_type) DO NOTHING;

-- ── data_steps ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_steps (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    steps INT NOT NULL,                 -- steps taken during the interval
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_steps_participant ON data_steps(participant_id, recorded_at);
ALTER TABLE data_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON data_steps FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Anon can insert sensor data" ON data_steps FOR INSERT WITH CHECK (auth.role() = 'anon');

-- ── data_proximity ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_proximity (
    id BIGSERIAL PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    proximity_cm REAL,                  -- distance from proximity sensor (null if none)
    orientation TEXT NOT NULL,          -- face_up | face_down | upright | unknown
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proximity_participant ON data_proximity(participant_id, recorded_at);
ALTER TABLE data_proximity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON data_proximity FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Anon can insert sensor data" ON data_proximity FOR INSERT WITH CHECK (auth.role() = 'anon');

-- ── daily_steps processed view ───────────────────────────────────────────────
CREATE OR REPLACE VIEW daily_steps
WITH (security_invoker = on) AS
SELECT
    participant_id,
    (recorded_at::timestamptz AT TIME ZONE 'Europe/London')::date AS usage_date,
    SUM(steps)  AS steps,
    COUNT(*)    AS samples
FROM data_steps
GROUP BY 1, 2;

GRANT SELECT ON daily_steps TO authenticated;
