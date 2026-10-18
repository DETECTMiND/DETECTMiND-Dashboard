# Deploying the DETECTMiND dashboard

The dashboard is a Next.js app that talks to one Supabase project. These
steps take a fresh Supabase project and a Vercel account to a working,
invite-only dashboard.

## 1. Database

In the Supabase SQL editor, run in this order (see SECURITY_NOTES.md):

1. `clear_database.sql` (**destructive**: drops and recreates `public`)
2. `supabase_schema.sql`
3. `seed_studies.sql`

Create your own account first (Authentication → Users → **Add user**), so the
seed makes you an **admin** and owner of the example studies. Its NOTICE
output lists every account it promoted. Change the example study PIN (`1234`)
before recruiting anyone.

## 2. Vercel environment variables

Project → Settings → Environment Variables (Production, Preview, Development):

| Name | Value | Exposed to browser |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` `public` key | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` key | **no — server only** |

The service-role key bypasses row-level security. It is only read by
`src/lib/supabase-admin.ts`, which is `server-only`. Never give it a
`NEXT_PUBLIC_` prefix, never paste it into client code, and rotate it in
Supabase if it ever leaks. Without it the dashboard works, but
**Admin → Researchers** shows "The server is missing SUPABASE_SERVICE_ROLE_KEY".

Redeploy after changing environment variables.

## 3. Supabase Auth settings

**Authentication → URL Configuration**

- **Site URL**: your production URL, e.g. `https://detectmind.vercel.app`
- **Redirect URLs** (add each):
  - `https://<your-domain>/auth/callback`
  - `https://<your-domain>/auth/callback**` (the links carry `?next=/reset-password`)
  - `http://localhost:3000/auth/callback`
  - `http://localhost:3000/auth/callback**`
  - optionally `https://*-<team>.vercel.app/auth/callback**` for preview deployments

Invite and password-reset links are only accepted for URLs on this list; if
one is missing, Supabase silently falls back to the Site URL.

**Authentication → Sign In / Providers**

- Turn **off** "Allow new users to sign up". Researchers join by invitation only
  (invites from the admin API still work).
- Keep Email provider enabled. "Confirm email" can stay on.
- Optional: set a minimum password length of 10 to match the dashboard.

**Authentication → Email Templates**

The default templates work: invites land on `/auth/callback`, which forwards
to `/reset-password`, where the new researcher sets a password. For more
robust links (they survive email scanners and work in a different browser),
change the link in these templates to the token-hash form:

- **Invite user**

  ```html
  <h2>You have been invited to the DETECTMiND research dashboard</h2>
  <p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/reset-password">Accept the invite and set your password</a></p>
  <p>If you were not expecting this, you can ignore this email.</p>
  ```

- **Reset Password**

  ```html
  <h2>Reset your DETECTMiND dashboard password</h2>
  <p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Choose a new password</a></p>
  <p>If you did not ask for this, you can ignore this email; your password is unchanged.</p>
  ```

Set the subjects too (e.g. "Your DETECTMiND dashboard invitation").

**Custom SMTP (recommended)**

Supabase's built-in email sender is rate limited (a few emails per hour) and
meant for testing. Before inviting a team, configure **Project Settings →
Authentication → SMTP Settings** with your institution's SMTP or a provider
(Resend, Postmark, SES, ...), and a sender such as `no-reply@your-domain`.

## 4. First sign-in

1. Open the Vercel URL and sign in with the account the seed made admin.
2. **Admin → Researchers → Invite a researcher** for each colleague.
3. On each study's **Team** page, add them as owner, editor or viewer.
4. Everyone can change their password under **Account**; "Forgot password?"
   on the sign-in page sends a reset link.

## 5. Checklist

- [ ] Schema + seed ran without errors; your email appeared as "Granted admin access".
- [ ] Three env vars set in Vercel; `SUPABASE_SERVICE_ROLE_KEY` is not `NEXT_PUBLIC_`.
- [ ] Site URL and Redirect URLs set; public sign-up off.
- [ ] Custom SMTP configured; Invite and Reset Password templates customised.
- [ ] Invited a test researcher, accepted the invite, set a password, saw only the studies they were added to.
- [ ] Example PIN changed; Android app points at the same Supabase project.
