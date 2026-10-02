-- ============================================================
-- Seed: Digital Habits & Focus Study + Sleep & Wellbeing Study
-- Run against your Supabase project (as an authenticated user or
-- via the SQL editor). UUIDs are generated inline so the script
-- is idempotent when run once; re-running will create duplicates.
-- ============================================================

DO $$
DECLARE
  v_digital_study_id   UUID := gen_random_uuid();
  v_sleep_study_id     UUID := gen_random_uuid();

  -- ESM schedule IDs
  v_digital_sched_id   UUID := gen_random_uuid();
  v_sleep_evening_id   UUID := gen_random_uuid();
  v_sleep_morning_id   UUID := gen_random_uuid();
BEGIN

-- ============================================================
-- 1. DIGITAL HABITS & FOCUS STUDY
-- ============================================================

INSERT INTO studies (id, name, description, app_description, status, sync_interval_minutes, config)
VALUES (
  v_digital_study_id,
  'Digital Habits & Focus Study',
  'Investigates how smartphone usage patterns relate to self-reported focus and productivity. Captures passive behavioural data and experience-sampled focus ratings throughout the day.',
  'You are taking part in a study exploring digital habits and focus. The app will passively collect usage data in the background. You will receive short surveys a few times a day asking about your current focus and phone use. Your data is kept private and used only for research.',
  'active',
  30,
  jsonb_build_object(
    'guided_permissions', true,
    'banking_pause', jsonb_build_object(
      'enabled', true,
      'apps', jsonb_build_array(
        'uk.co.hsbc.hsbcukmobilebanking',
        'com.barclays.android.barclaysmobilebanking',
        'com.htsu.hsbcpersonalbanking',
        'com.monzo.android',
        'com.starlingbank.android',
        'com.revolut.app'
      ),
      'reminder_minutes', 30,
      'escalation_minutes', 120
    )
  )
);

-- Sensor configs for Digital Habits & Focus Study
INSERT INTO sensor_configs (study_id, sensor_type, enabled, interval_seconds, config)
VALUES
  (v_digital_study_id, 'app_usage',      true,  NULL, '{}'),
  (v_digital_study_id, 'notifications',  true,  NULL, '{}'),
  (v_digital_study_id, 'screen_state',   true,  NULL, '{}'),
  (v_digital_study_id, 'calls',          true,  NULL, '{}'),
  (v_digital_study_id, 'sms',            true,  NULL, '{}'),
  (v_digital_study_id, 'gestures',       true,  NULL, jsonb_build_object(
    'interaction_types', jsonb_build_object(
      'TYPE_VIEW_SCROLLED',           true,
      'TYPE_VIEW_CLICKED',            true,
      'TYPE_VIEW_LONG_CLICKED',       true,
      'TYPE_WINDOW_CONTENT_CHANGED',  false
    ),
    'skip_rules', jsonb_build_object(
      'skip_system_ui',       true,
      'skip_launchers',       true,
      'skip_keyboards',       true,
      'skip_system_settings', true
    )
  )),
  (v_digital_study_id, 'battery',        true,  600,  '{}'),
  (v_digital_study_id, 'light',          true,  600,  '{}'),
  (v_digital_study_id, 'location',       true,  600,  jsonb_build_object('movement_threshold', 0));

-- ESM schedule: 4× daily fixed prompts (focus check-ins)
INSERT INTO esm_schedules (
  id, study_id, name, description,
  schedule_type, times_of_day,
  expiry_minutes, notification_title, notification_body, enabled
)
VALUES (
  v_digital_sched_id,
  v_digital_study_id,
  'Focus Check-in',
  '4× daily fixed prompts assessing current focus, phone use, and context.',
  'fixed',
  ARRAY['09:00', '12:00', '15:30', '19:00'],
  60,
  'Quick Focus Check',
  'Take 1 minute to tell us how you''re doing.',
  true
);

-- ESM questions for the Focus Check-in schedule
INSERT INTO esm_questions (schedule_id, question_order, question_type, question_text, required, options, config)
VALUES
  (v_digital_sched_id, 0, 'likert',
   'How focused are you feeling right now?',
   true, NULL,
   jsonb_build_object('min', 1, 'max', 7, 'label_min', 'Not at all focused', 'label_max', 'Extremely focused')),

  (v_digital_sched_id, 1, 'single_choice',
   'What are you mainly doing right now?',
   true,
   '["Working / studying", "Relaxing / leisure", "Socialising", "Commuting / travelling", "Household tasks", "Other"]',
   '{}'),

  (v_digital_sched_id, 2, 'yes_no',
   'Have you used your phone for anything non-essential in the last 30 minutes?',
   true, NULL, '{}'),

  (v_digital_sched_id, 3, 'likert',
   'How much has your phone use affected your ability to concentrate today?',
   true, NULL,
   jsonb_build_object('min', 1, 'max', 5, 'label_min', 'Not at all', 'label_max', 'A great deal')),

  (v_digital_sched_id, 4, 'slider',
   'How productive have you been in the last few hours? (0 = not at all, 100 = extremely productive)',
   true, NULL,
   jsonb_build_object('min', 0, 'max', 100, 'step', 1)),

  (v_digital_sched_id, 5, 'text',
   'Is there anything else you''d like to note about your focus or phone use right now? (optional)',
   false, NULL, '{}');


-- ============================================================
-- 2. SLEEP & WELLBEING STUDY
-- ============================================================

INSERT INTO studies (id, name, description, app_description, status, sync_interval_minutes, config)
VALUES (
  v_sleep_study_id,
  'Sleep & Wellbeing Study',
  'Examines the relationship between device usage in the evening/night and self-reported sleep quality and next-day wellbeing. Combines passive sensing with morning and evening experience-sampling.',
  'You are taking part in a study about sleep and wellbeing. The app runs quietly in the background and you will receive two short surveys each day — one in the evening and one in the morning. Your responses help us understand how phone use relates to sleep. All data is anonymised.',
  'active',
  60,
  jsonb_build_object(
    'guided_permissions', true,
    'banking_pause', jsonb_build_object(
      'enabled', true,
      'apps', jsonb_build_array(
        'uk.co.hsbc.hsbcukmobilebanking',
        'com.barclays.android.barclaysmobilebanking',
        'com.htsu.hsbcpersonalbanking',
        'com.monzo.android',
        'com.starlingbank.android',
        'com.revolut.app'
      ),
      'reminder_minutes', 30,
      'escalation_minutes', 120
    )
  )
);

-- Sensor configs for Sleep & Wellbeing Study
INSERT INTO sensor_configs (study_id, sensor_type, enabled, interval_seconds, config)
VALUES
  (v_sleep_study_id, 'screen_state',  true,  NULL, '{}'),
  (v_sleep_study_id, 'app_usage',     true,  NULL, '{}'),
  (v_sleep_study_id, 'notifications', true,  NULL, '{}'),
  (v_sleep_study_id, 'calls',         true,  NULL, '{}'),
  (v_sleep_study_id, 'sms',           true,  NULL, '{}'),
  (v_sleep_study_id, 'gestures',      true,  NULL, jsonb_build_object(
    'interaction_types', jsonb_build_object(
      'TYPE_VIEW_SCROLLED',           true,
      'TYPE_VIEW_CLICKED',            true,
      'TYPE_VIEW_LONG_CLICKED',       true,
      'TYPE_WINDOW_CONTENT_CHANGED',  false
    ),
    'skip_rules', jsonb_build_object(
      'skip_system_ui',       true,
      'skip_launchers',       true,
      'skip_keyboards',       true,
      'skip_system_settings', true
    )
  )),
  (v_sleep_study_id, 'battery',       true,  600,  '{}'),
  (v_sleep_study_id, 'light',         true,  600,  '{}'),
  (v_sleep_study_id, 'location',      true,  600,  jsonb_build_object('movement_threshold', 0));

-- ── ESM Schedule 1: Evening Wind-Down Survey (21:30) ───────────────────────

INSERT INTO esm_schedules (
  id, study_id, name, description,
  schedule_type, times_of_day,
  expiry_minutes, notification_title, notification_body, enabled
)
VALUES (
  v_sleep_evening_id,
  v_sleep_study_id,
  'Evening Wind-Down',
  'Evening survey capturing pre-sleep phone use, stress, and bed-time intention.',
  'fixed',
  ARRAY['21:30'],
  90,
  'Evening Check-in',
  'A quick survey before you wind down for the night.',
  true
);

INSERT INTO esm_questions (schedule_id, question_order, question_type, question_text, required, options, config)
VALUES
  (v_sleep_evening_id, 0, 'time',
   'What time do you plan to go to bed tonight?',
   true, NULL, '{}'),

  (v_sleep_evening_id, 1, 'slider',
   'How stressed or anxious are you feeling right now? (0 = completely calm, 100 = extremely stressed)',
   true, NULL,
   jsonb_build_object('min', 0, 'max', 100, 'step', 1)),

  (v_sleep_evening_id, 2, 'likert',
   'How much have you used your phone in the last 2 hours?',
   true, NULL,
   jsonb_build_object('min', 1, 'max', 5, 'label_min', 'Very little', 'label_max', 'A lot')),

  (v_sleep_evening_id, 3, 'single_choice',
   'What was your main phone activity in the last 2 hours?',
   true,
   '["Social media", "Messaging / calls", "Video / streaming", "Work / email", "News / reading", "Gaming", "I haven''t used my phone much", "Other"]',
   '{}'),

  (v_sleep_evening_id, 4, 'yes_no',
   'Did you use your phone in bed last night?',
   true, NULL, '{}'),

  (v_sleep_evening_id, 5, 'likert',
   'How tired do you feel right now?',
   true, NULL,
   jsonb_build_object('min', 1, 'max', 7, 'label_min', 'Wide awake', 'label_max', 'Exhausted'));

-- ── ESM Schedule 2: Morning Wellbeing Survey (08:00) ──────────────────────

INSERT INTO esm_schedules (
  id, study_id, name, description,
  schedule_type, times_of_day,
  expiry_minutes, notification_title, notification_body, enabled
)
VALUES (
  v_sleep_morning_id,
  v_sleep_study_id,
  'Morning Wellbeing',
  'Morning survey capturing last night''s sleep quality, wake time, and current mood.',
  'fixed',
  ARRAY['08:00'],
  120,
  'Good Morning!',
  'Tell us how you slept — it only takes a minute.',
  true
);

INSERT INTO esm_questions (schedule_id, question_order, question_type, question_text, required, options, config)
VALUES
  (v_sleep_morning_id, 0, 'time',
   'What time did you actually go to sleep last night?',
   true, NULL, '{}'),

  (v_sleep_morning_id, 1, 'time',
   'What time did you wake up this morning?',
   true, NULL, '{}'),

  (v_sleep_morning_id, 2, 'likert',
   'How would you rate the quality of your sleep last night?',
   true, NULL,
   jsonb_build_object('min', 1, 'max', 7, 'label_min', 'Very poor', 'label_max', 'Excellent')),

  (v_sleep_morning_id, 3, 'slider',
   'How rested do you feel right now? (0 = completely exhausted, 100 = fully refreshed)',
   true, NULL,
   jsonb_build_object('min', 0, 'max', 100, 'step', 1)),

  (v_sleep_morning_id, 4, 'yes_no',
   'Were you woken up during the night by a phone notification?',
   true, NULL, '{}'),

  (v_sleep_morning_id, 5, 'single_choice',
   'How would you describe your mood this morning?',
   true,
   '["Very positive", "Positive", "Neutral", "Negative", "Very negative"]',
   '{}'),

  (v_sleep_morning_id, 6, 'likert',
   'How motivated do you feel to tackle today''s tasks?',
   true, NULL,
   jsonb_build_object('min', 1, 'max', 5, 'label_min', 'Not at all motivated', 'label_max', 'Very motivated'));

END $$;
