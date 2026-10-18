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
- Anon has **no** access to `participants`, `researchers`, `study_members`,
  `audit_log`, `study_pins`, `pin_attempts`, `participant_merge_audit` or the
  processed views, and
  cannot execute any other function. PostgreSQL grants EXECUTE to PUBLIC by
  default, so the schema revokes it from every function and then grants it
  back one function at a time.

## 2. Researchers (dashboard)

A dashboard user must be signed in with Supabase Auth **and** have an
**active** row in `public.researchers`. Being signed in is not enough on its
own: every policy goes through the helpers below.

### Roles

| Level | Where | Can do |
| --- | --- | --- |
| `admin` | `researchers.role` | Everything, in every study: researchers, the audit log, all study data and settings. |
| `researcher` | `researchers.role` | Only studies they are a member of, at their study role. Any active researcher may create a study and becomes its owner. |
| `owner` | `study_members.role` | Editor rights + manage the study team, delete participants, delete the study. |
| `editor` | `study_members.role` | Edit study settings, sensors, surveys, PIN; rename/withdraw/merge participants; clear PIN lockouts. |
| `viewer` | `study_members.role` | Read-only: study, participants, data, processed views, team list. |

`researchers.active = false` (deactivated) removes all access immediately,
whatever the roles; the row is kept for the audit trail.

### Helpers (all `SECURITY DEFINER`, used by RLS)

- `is_researcher()`: active researcher. `is_admin()`: active admin.
- `can_view_study(id)`: admin, or active member of the study.
- `can_edit_study(id)`: admin, or owner/editor.
- `can_manage_study(id)`: admin, or owner.
- `viewable_study_ids()` / `editable_study_ids()`: the same rules as arrays,
  so policies evaluate them once per statement.

### What RLS allows (role `authenticated`)

- `studies`: read if viewable; insert by any active researcher (a trigger adds
  the creator as owner); update if editable; delete if manageable.
- `sensor_configs`, `esm_schedules`, `esm_questions`: read if viewable, write if editable.
- `participants`: read if viewable, update (label/status) if editable. No
  client insert/delete: enrolment is `enroll_participant()`, deletion is
  `delete_participant()`.
- `data_*`, `sync_log`: read-only for members (table privileges for writes are revoked).
- `study_members`: read if viewable; insert/update/delete if manageable.
  Triggers make sure members are researchers and that a study always keeps at
  least one owner.
- `researchers`: everyone reads their own row; admins read all and may update
  `role`, `active`, `display_name`. A trigger refuses demoting or
  deactivating the last active admin. Rows are inserted only by the server
  admin API (service role) or the seed.
- `audit_log`: admins read; nobody writes from the client.
- `study_pins`: no client access at all (the PIN hash is only touched by
  `set_study_pin()`). `pin_attempts`: read if viewable, clear if editable.
- Processed views use `security_invoker = true`, so they apply all of the
  above automatically.

A signed-in user without an active researchers row sees "Your account is not
authorised as a researcher" (or "...has been deactivated") instead of an
empty dashboard.

### Functions that check study permission themselves

- `merge_participants` and `set_study_pin`: `can_edit_study`.
- `delete_participant(p_id)`: `can_manage_study`. Deletes the participant and
  every row collected from them (all `data_*` tables, `sync_log`, merge
  records), refuses while other participants are still merged into it, and
  returns + audits per-table counts.
- `study_team(study)`: team with emails, for members. `researcher_directory()`:
  active researchers' emails, for admins and study owners (to add people).

### Audit log

`audit_log` records `participant_deleted`, `participant_merged`,
`study_pin_changed`, `study_member_added/changed/removed` (written by the
functions/triggers above, actor = `auth.uid()`), `researcher_role_changed`,
`researcher_deactivated`, `researcher_reactivated` (trigger on
`researchers`), and `researcher_invited` (server admin API). Admins browse it
under **Admin → Audit log**.

### Server admin API and the service-role key

`src/lib/supabase-admin.ts` creates a service-role client. It imports
`server-only` (the build fails if a Client Component imports it) and reads
`SUPABASE_SERVICE_ROLE_KEY`, which has no `NEXT_PUBLIC_` prefix and so never
reaches the browser. The routes under `src/app/api/admin/` first verify the
caller's own session and that they are an active admin, and only then use the
service role for things RLS cannot do: sending invites
(`auth.admin.inviteUserByEmail`), creating `researchers` rows, and banning /
unbanning a deactivated account so its sessions stop refreshing. Role and
active changes are made with the caller's own session so the last-admin guard
and audit trigger apply.

### Adding or removing a researcher

Use **Admin → Researchers** in the dashboard: invite by email (choose
`researcher` or `admin`), resend the invite, change the role, or deactivate.
Then grant study access on the study's **Team** page. Deactivate rather than
delete, so the audit trail keeps a name.

Emergency SQL (SQL editor), if no admin can sign in:

```sql
INSERT INTO researchers(user_id, email, role)
SELECT id, email, 'admin' FROM auth.users WHERE email = 'name@example.org'
ON CONFLICT (user_id) DO UPDATE SET role = 'admin', active = true;
```

`seed_studies.sql` makes every account that exists when it runs an active
**admin** and owner of the seeded studies, and prints each email as a NOTICE.

### Consent

`enroll_participant(..., p_consent_version)` stores the consent text version
the participant accepted in the app (`participants.consent_version`, with
`consent_at`). The app sends `2026-10-v2`. Older app builds that do not send
it leave both columns NULL ("Consent not recorded" in the dashboard).

## Turn off public sign-up

Anyone can create an account through the public auth endpoint while sign-up
is enabled. RLS stops such an account from seeing data, but sign-up should
still be off. In the Supabase dashboard, go to **Authentication → Sign In /
Providers** (older UI: Authentication → Settings) and turn off **Allow new
users to sign up**. Invitations from the admin API still work with sign-up
off. See DEPLOY.md for the rest of the Auth settings.

## Reset / run order

Run in the Supabase SQL editor, in this order:

1. `clear_database.sql`: **destructive**. Drops and recreates the `public`
   schema. Auth users are kept.
2. `supabase_schema.sql`: tables, RLS, views, functions and grants. All
   earlier `migration_*.sql` files have been folded into it.
3. `seed_studies.sql`: example studies (the Digital Habits study has the test
   PIN `1234`); every existing account becomes an admin and owner of them.

If you add a function later, re-run the PRIVILEGES section at the end of
`supabase_schema.sql`, or revoke `EXECUTE ... FROM PUBLIC, anon` and grant it
explicitly. New functions are executable by everyone by default.

## Data notes

- `data_battery.voltage` is stored in millivolts, as Android reports it. The
  dashboard displays it in volts.
- SMS: only direction, time and a SHA-256 contact hash are stored. Message
  bodies are not collected and are not hashed either.
