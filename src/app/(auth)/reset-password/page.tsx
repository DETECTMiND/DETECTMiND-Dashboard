'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { Button, ButtonLink, Notice } from '@/components/ui'
import { MIN_PASSWORD_LENGTH, PasswordInput, passwordProblem } from '@/components/password-fields'
import { AuthCard } from '../auth-card'

// Reached from an invite or password-reset email (via /auth/callback, which
// exchanges the link for a session and adds ?mode=invite|recovery). Also
// accepts the implicit-flow links that carry the session (and its type) in
// the URL fragment.

type Phase = 'checking' | 'no-session' | 'ready' | 'done'
type Mode = 'invite' | 'recovery'

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('checking')
  const [mode, setMode] = useState<Mode>('recovery')
  const [email, setEmail] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function init() {
      const search = new URLSearchParams(window.location.search)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const rawMode = search.get('mode') ?? hash.get('type')
      const nextMode: Mode = rawMode === 'invite' ? 'invite' : 'recovery'
      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')
      const hashError = hash.get('error_description')
      const failedLink = search.get('error') === 'link' || !!hashError
      if (accessToken && refreshToken && !failedLink) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      }
      // Keep the mode in the address (for a reload) but drop tokens and errors.
      if (window.location.hash || search.has('error')) {
        history.replaceState(null, '', `${window.location.pathname}?mode=${nextMode}`)
      }
      const { data: { user } } = failedLink ? { data: { user: null } } : await supabase.auth.getUser()
      if (cancelled) return
      setMode(nextMode)
      if (hashError) setLinkError(hashError.replace(/\+/g, ' '))
      setEmail(user?.email ?? null)
      setPhase(user ? 'ready' : 'no-session')
    }
    void init()
    return () => { cancelled = true }
  }, [supabase])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const problem = passwordProblem(password, confirm)
    if (problem) { setError(problem); return }
    setSaving(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) {
      setError(/different from the old/i.test(error.message)
        ? 'Choose a password you have not used for this account before.'
        : error.message)
      return
    }
    setPhase('done')
    setTimeout(() => { router.push('/'); router.refresh() }, 1200)
  }

  const invite = mode === 'invite'
  const title = phase === 'checking' ? 'Checking your link'
    : phase === 'no-session' ? (invite ? 'This invite link has expired' : 'This reset link has expired')
    : invite ? 'Welcome to DETECTMiND' : 'Choose a new password'
  const description = phase === 'ready' || phase === 'done'
    ? (invite ? 'Set a password to finish setting up your account.' : email ? `For ${email}.` : undefined)
    : undefined

  return (
    <AuthCard title={title} description={description}>
      <title>{invite ? 'Set up your account | DETECTMiND' : 'Choose a new password | DETECTMiND'}</title>

      {phase === 'checking' && (
        <p role="status" className="flex items-center justify-center gap-2 text-sm text-subtle">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Checking your link…
        </p>
      )}

      {phase === 'no-session' && (
        <div className="space-y-4 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-warning-soft text-warning"><KeyRound size={20} aria-hidden="true" /></span>
          <p className="text-sm text-muted">
            {invite
              ? 'Invite links work once and expire after a while. Ask the person who invited you to send a new invite.'
              : 'Reset links work once and expire after a while. Request a new one from the sign-in page.'}
          </p>
          {linkError && <p className="text-xs text-subtle">Details: {linkError}</p>}
          <ButtonLink href="/login" variant={invite ? 'secondary' : 'primary'}>{invite ? 'Go to sign in' : 'Request a new link'}</ButtonLink>
        </div>
      )}

      {phase === 'ready' && (
        <form onSubmit={submit} className="space-y-4">
          {invite && email && <p className="text-sm text-muted">Your account: <span className="font-medium text-fg">{email}</span></p>}
          <Notice notice={error ? { tone: 'error', text: error } : null} />
          <PasswordInput id="new-password" label="New password" value={password} onChange={setPassword}
            autoComplete="new-password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
          <PasswordInput id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm}
            autoComplete="new-password" />
          <Button type="submit" loading={saving} className="w-full">
            {saving ? 'Saving…' : invite ? 'Set password' : 'Save password'}
          </Button>
        </form>
      )}

      {phase === 'done' && (
        <p role="status" className="flex items-center justify-center gap-2 text-center text-sm text-success">
          <CheckCircle2 size={16} aria-hidden="true" /> Password saved. Taking you to the dashboard…
        </p>
      )}
    </AuthCard>
  )
}
