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
seed makes you an **admin**. The example studies start with no team: add
owners, editors and viewers on each study's **Settings → Team** tab. The
NOTICE output lists every account and its account type. Change the example study PIN (`1234`)
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
**Admin → People** shows "The server is missing SUPABASE_SERVICE_ROLE_KEY".

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

Branded templates are in `supabase/templates/` (the local stack already uses
them via `supabase/config.toml`). For each template in the hosted project,
paste the file's HTML into the body and set the subject:

| Template | File | Subject |
|---|---|---|
| Invite user | `invite.html` | You're invited to the DETECTMiND dashboard |
| Reset password | `recovery.html` | Reset your DETECTMiND password |
| Magic link | `magic_link.html` | Your DETECTMiND sign-in link |
| Confirm signup | `confirmation.html` | Confirm your email for DETECTMiND |
| Change email address | `email_change.html` | Confirm your new email for DETECTMiND |

The links use the token-hash form (`/auth/callback?token_hash=…`), which
survives email link scanners and works in a different browser. The logo is
loaded from `{{ .SiteURL }}/logo.png`, so the **Site URL** must be the
dashboard's address.

**Sender name and address: Custom SMTP**

Without custom SMTP, Supabase sends as "Supabase Auth
&lt;noreply@mail.app.supabase.io&gt;" with a footer about Supabase, and only a
few emails per hour. To send as **DETECTMiND &lt;no-reply@your-domain&gt;**:

1. Pick a provider (Resend, Postmark, Amazon SES, Brevo, or your
   university's SMTP) and verify your sending domain there (SPF/DKIM records).
2. **Project Settings → Authentication → SMTP Settings**: enable custom SMTP,
   enter the provider's host, port, user and password, set **Sender name** to
   `DETECTMiND` and **Sender email** to e.g. `no-reply@your-domain`.
3. Raise the email rate limit under **Authentication → Rate Limits** if you
   invite many people at once.

## 4. First sign-in

1. Open the Vercel URL and sign in with the account the seed made admin.
2. **Admin → People → Invite someone** for each colleague, or add them by email on a
   study's **Settings → Team** tab (owners and editors can do this too).
3. Admins make someone an owner on the Team tab, or an admin on People.
4. Everyone can change their password under **Account**; "Forgot password?"
   on the sign-in page sends a reset link.

## 5. Checklist

- [ ] Schema + seed ran without errors; the NOTICE output shows your email as admin.
- [ ] Each example study has an owner (Admin → Studies shows "No owner" otherwise).
- [ ] Three env vars set in Vercel; `SUPABASE_SERVICE_ROLE_KEY` is not `NEXT_PUBLIC_`.
- [ ] Site URL and Redirect URLs set; public sign-up off.
- [ ] Custom SMTP configured; Invite and Reset Password templates customised.
- [ ] Invited a test researcher, accepted the invite, set a password, saw only the studies they were added to.
- [ ] Example PIN changed; Android app points at the same Supabase project.
