# Security model

The Android app ships the public Supabase anon key, so the anon key alone must
not grant access to participant records or study data. Access is split
between two kinds of caller.

## 1. Devices (anon key + device token)

- Before enrolling, the app generates a random **device token** (32 random
  bytes, hex-encoded) and keeps it on the device.
- `enroll_participant(..., p_device_token)` stores only
  `sha256(token)` in `participants.device_token_hash`. A token belongs to
  exactly one participant row; a new enrolment needs a new token.
- Every later request sends the header `x-device-token: <token>`.
  `device_participant_id()` maps that header to the canonical participant
  (it follows `merged_into`) and returns it only while that participant is
  `active`.
- What anon can do:
  - read `studies`, `sensor_configs`, `esm_schedules` and `esm_questions`
    for studies that are not `draft`;
  - INSERT into the data tables and `sync_log`, only with
    `participant_id = device_participant_id()`. Uploads are made
    duplicate-safe with `client_uuid` + `on_conflict=client_uuid`. Because of
    that, anon can SELECT the `client_uuid` column of its **own** rows and
    nothing else;
  - call `enroll_participant`, `device_get_participant`, `device_heartbeat`,
    `device_withdraw` and `device_adopt_merge`.
- Anon has **no** access to `participants`, `researchers`, `study_pins`,
  `pin_attempts`, `participant_merge_audit` or the processed views, and
  cannot execute any other function. PostgreSQL grants EXECUTE to PUBLIC by
  default, so the schema revokes it from every function and then grants it
  back one function at a time.

## 2. Researchers (dashboard)

- A dashboard user must be signed in with Supabase Auth **and** be listed in
  `public.researchers`. Every researcher policy checks `is_researcher()`;
  being signed in is not enough on its own.
- `merge_participants` and `set_study_pin` refuse callers who are not
  researchers.
- Processed views use `security_invoker = true`, so they apply the RLS rules
  of the underlying tables.
- A signed-in user who is not a researcher sees "Your account is not
  authorised as a researcher" on login, not an empty dashboard.

### Adding or removing a researcher

1. Create the user in Supabase → Authentication → Users (invite or add).
2. In the SQL editor:

   ```sql
   INSERT INTO researchers(user_id) SELECT id FROM auth.users WHERE email = 'name@example.org';
   -- revoke:
   DELETE FROM researchers WHERE user_id = (SELECT id FROM auth.users WHERE email = 'name@example.org');
   ```

`seed_studies.sql` grants researcher access to every account that exists
when it runs, and prints each email as a NOTICE.

## Turn off public sign-up

Anyone can create an account through the public auth endpoint while sign-up
is enabled. RLS stops such an account from seeing data, but sign-up should
still be off. In the Supabase dashboard, go to **Authentication → Sign In /
Providers** (older UI: Authentication → Settings) and turn off **Allow new
users to sign up**. Then add researchers by invitation only.

## Reset / run order

Run in the Supabase SQL editor, in this order:

1. `clear_database.sql`: **destructive**. Drops and recreates the `public`
   schema. Auth users are kept.
2. `supabase_schema.sql`: tables, RLS, views, functions and grants. All
   earlier `migration_*.sql` files have been folded into it.
3. `seed_studies.sql`: example studies (the Digital Habits study has the test
   PIN `1234`) and researcher access for existing accounts.

If you add a function later, re-run the PRIVILEGES section at the end of
`supabase_schema.sql`, or revoke `EXECUTE ... FROM PUBLIC, anon` and grant it
explicitly. New functions are executable by everyone by default.

## Data notes

- `data_battery.voltage` is stored in millivolts, as Android reports it. The
  dashboard displays it in volts.
- SMS: only direction, time and a SHA-256 contact hash are stored. Message
  bodies are not collected and are not hashed either.
