# DETECTMiND research dashboard

Web dashboard for the DETECTMiND Android sensing app. Researchers create
studies, configure sensors and experience-sampling surveys, monitor
participants, and browse or export the collected data. Data lives in
Supabase (Postgres + Auth); access is enforced by row-level security.

- **Stack:** Next.js 16 (App Router), React 19, Tailwind CSS 4, Supabase (`@supabase/ssr`), Recharts.
- **Access model:** invite-only. Admins manage researchers; each study has
  owners, editors and viewers. See [SECURITY_NOTES.md](SECURITY_NOTES.md).
- **Deploying:** see [DEPLOY.md](DEPLOY.md).

## Run locally

Requirements: Node.js 20+, a Supabase project with the schema applied.

```bash
npm install
cp .env.example .env.local   # fill in your project's URL and keys
npm run dev
```

Open http://localhost:3000 and sign in. Add `http://localhost:3000/auth/callback`
to Supabase → Authentication → URL Configuration → Redirect URLs so invite and
password-reset links work locally.

## Database

SQL files at the repo root, run in the Supabase SQL editor in this order:

| File | Purpose |
| --- | --- |
| `clear_database.sql` | **Destructive** reset of the `public` schema (auth users are kept) |
| `supabase_schema.sql` | Tables, RLS policies, views, functions, grants |
| `seed_studies.sql` | Two example studies (no team); listed emails become admins, other accounts researchers |

`PROCESSED_DATA_PLAN.md` describes the processed (derived) views.

`data_calls` holds the phone's own calls and, when the calls sensor's
"Calls in other apps" option is on (`sensor_configs.config.include_app_calls`,
missing = on), calls in other apps such as WhatsApp, Botim or Zoom. Columns:
`direction` (incoming | outgoing | missed), `event_time`, `duration_seconds`
(talk time), `contact_hash` (SHA-256 of the number; NULL for app calls),
`source` ('phone' or the app's package name), `call_kind` (cellular | voip),
`outcome` (answered | missed | declined | unanswered | unknown), `is_video`,
`video_seconds`, `ring_seconds`, `connected_at`, `ended_at` and `signals`
(JSON array of how the call was detected). The new columns are nullable, so
older app versions still upload. `daily_calls` summarises them per
participant, day, app, network, audio/video and outcome.

## Scripts

```bash
npm run dev     # development server
npm run lint    # ESLint
npx tsc --noEmit
npm run build   # production build
npm start       # serve the production build
```

## End-to-end tests

The Playwright suite runs the dashboard against a **local** Supabase stack in Docker,
never the hosted project (the setup refuses any non-localhost URL). Test accounts for every
role (admin, owner, editor, viewer, researcher, outsider) exist only in that local stack.

```bash
npx supabase start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,studio,postgres-meta
npm run test:e2e        # resets the local DB (clear -> schema -> seed), creates test users, runs all flows
npx supabase stop       # when finished
```

Invite and password-reset emails are caught by the local Mailpit at http://127.0.0.1:54324.
`npm run db:local:reset` rebuilds just the local database.

Covered: study approval, owner/editor/viewer limits (UI and direct database access),
admin owner assignment and study deletion, owner invites (email link → set password →
restricted view), change and forgot password, participant deletion, deactivation and the
last-admin guard, the menus and tabs, old-address redirects, dark mode, and every page at
phone width.

`SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts` saves every page in light and
dark to `e2e-screenshots/review/`, and every page at phone (375 px), tablet (768 px) and
tablet-landscape (1024 px) widths to `e2e-screenshots/responsive/`, reporting any sideways overflow.

## Navigation

- **Study** (for the study picked at the top of the sidebar): Overview, Participants,
  Data (Raw data · Processed), Surveys (Responses · Setup), Settings (General · Sensors · Team).
- **Admin** (admins only): Approvals, Studies, People, Activity log.
- Each action has one home: people are added to a study on its **Team** tab, accounts are
  invited on **People**, new studies are approved on **Approvals**, status changes and
  deletion live in **Settings → General**.

## Project layout

```
src/
  proxy.ts                     session refresh + redirects for signed-out users
  lib/
    supabase-browser.ts        browser client (anon key + user session)
    supabase-server.ts         server client for route handlers / server code
    supabase-admin.ts          service-role client (server-only)
    admin-auth.ts              "caller must be an active admin" check for admin routes
    access.tsx                 current researcher + per-study role, for the UI
    export-study.ts            "Export all study data" (zip of CSVs)
    csv.ts                     paged fetchAll (past the 1000-row cap) and CSV download
    sensors.ts, status.ts      sensor catalogue and labels; study status names and colours
    nav.ts                     menu labels and addresses
    theme.ts                   light / dark / system theme
  app/
    (auth)/login               sign in, forgot password
    (auth)/reset-password      set a password after an invite or reset link
    auth/callback              exchanges invite / recovery links for a session
    (dashboard)/               the signed-in app (overview, studies, admin, account)
    api/admin/researchers      invite, resend, change role, deactivate (admins only)
    api/enroll                 test enrolment from the dashboard
  components/
    ui/                        shared kit: Button, Badge, Field, Toggle, Card, PageHeader,
                               tabs, Modal, table + Pagination, unsaved-changes guard
    study/ data/ charts/       page-specific pieces
  app/globals.css              colour tokens (light and dark)
  app/theme-dark.css           generated by scripts/gen-dark-theme.py
```
