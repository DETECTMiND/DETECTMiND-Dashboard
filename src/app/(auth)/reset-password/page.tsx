'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { FlaskConical, KeyRound, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { MIN_PASSWORD_LENGTH, PasswordInput, passwordProblem } from '@/components/password-fields'

// Reached from an invite or password-reset email (via /auth/callback, which
// exchanges the link for a session). Also accepts the older implicit-flow
// links that carry the session in the URL fragment.

type Phase = 'checking' | 'no-session' | 'ready' | 'done'

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('checking')
  const [email, setEmail] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function init() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')
      const hashError = hash.get('error_description')
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      }
      if (window.location.hash) history.replaceState(null, '', window.location.pathname)
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <title>Set password | DETECTMiND</title>
      <div className="w-full max-w-sm px-4">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 shadow-sm">
            <FlaskConical size={22} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set your password</h1>
          {email && <p className="mt-1 text-sm text-gray-500">for {email}</p>}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-7 shadow-sm">
          {phase === 'checking' && (
            <p className="flex items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" /> Checking your link…
            </p>
          )}

          {phase === 'no-session' && (
            <div className="space-y-4 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><KeyRound size={20} /></span>
              <p className="text-sm text-gray-600">
                {linkError ?? 'This link is invalid or has expired.'} Request a new password reset link from the sign-in page.
              </p>
              <Link href="/login" className="inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                Go to sign in
              </Link>
            </div>
          )}

          {phase === 'ready' && (
            <form onSubmit={submit} className="space-y-4">
              {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
              <PasswordInput id="new-password" label="New password" value={password} onChange={setPassword}
                autoComplete="new-password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
              <PasswordInput id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm}
                autoComplete="new-password" />
              <button type="submit" disabled={saving}
                className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? 'Saving…' : 'Save password'}
              </button>
            </form>
          )}

          {phase === 'done' && (
            <p role="status" className="text-center text-sm text-emerald-700">Password saved. Taking you to the dashboard…</p>
          )}
        </div>
      </div>
    </div>
  )
}
