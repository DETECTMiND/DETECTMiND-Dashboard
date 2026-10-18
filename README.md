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
| `seed_studies.sql` | Two example studies; existing accounts become admins and owners |

`PROCESSED_DATA_PLAN.md` describes the processed (derived) views.

## Scripts

```bash
npm run dev     # development server
npm run lint    # ESLint
npx tsc --noEmit
npm run build   # production build
npm start       # serve the production build
```

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
  app/
    (auth)/login               sign in, forgot password
    (auth)/reset-password      set a password after an invite or reset link
    auth/callback              exchanges invite / recovery links for a session
    (dashboard)/               the signed-in app (overview, studies, admin, account)
    api/admin/researchers      invite, resend, change role, deactivate (admins only)
    api/enroll                 test enrolment from the dashboard
  components/                  shell, charts, modals, shared feedback UI
```
