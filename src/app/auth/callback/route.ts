import { createClient } from '@/lib/supabase-server'
import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

// Lands invite, password-recovery and magic links.
//   ?code=...                  PKCE links (resetPasswordForEmail from this site)
//   ?token_hash=...&type=...   email templates that link here directly (see DEPLOY.md)
// `next` is only honoured when it is a same-site relative path.

const OTP_TYPES: EmailOtpType[] = ['invite', 'recovery', 'magiclink', 'signup', 'email', 'email_change']

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  try {
    // Reject anything that would resolve to another origin.
    const url = new URL(raw, 'http://local.invalid')
    if (url.origin !== 'http://local.invalid') return '/'
    return url.pathname + url.search
  } catch {
    return '/'
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  let next = safeNext(searchParams.get('next'))
  // Invite and recovery links must always end on the set-password page.
  if (type === 'invite' || type === 'recovery') next = '/reset-password'

  const supabase = await createClient()
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  } else if (next === '/reset-password') {
    // Invites sent with the admin API and the default email template arrive
    // via the implicit flow: the session is in the URL #fragment, which the
    // server never sees. Browsers keep the fragment across this redirect, and
    // the reset-password page picks it up (or explains that the link expired).
    return NextResponse.redirect(`${origin}/reset-password`)
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
