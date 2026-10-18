'use client'

import { createClient } from '@/lib/supabase-browser'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState } from 'react'
import { ArrowLeft, Mail } from 'lucide-react'
import { Button, Notice, inputClass } from '@/components/ui'
import { PasswordInput } from '@/components/password-fields'
import { AuthCard } from '../auth-card'

const CALLBACK_ERRORS: Record<string, string> = {
  auth: 'That sign-in link is invalid or has expired. Request a new one below.',
}

function LoginForm() {
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(() => CALLBACK_ERRORS[searchParams.get('error') ?? ''] ?? '')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  function switchMode(next: 'signin' | 'forgot') {
    setMode(next)
    setError('')
    setInfo('')
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setInfo('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message)
      setLoading(false)
      return
    }
    // Only active accounts in public.researchers can read study data (RLS).
    const { data: researcher } = await supabase
      .from('researchers').select('active').eq('user_id', data.user.id).maybeSingle()
    if (!researcher || !researcher.active) {
      await supabase.auth.signOut()
      setError(researcher
        ? 'Your account has been deactivated. Contact an admin if you need access again.'
        : 'This account is not authorised to use the dashboard. Ask an admin to invite you.')
      setLoading(false)
      return
    }
    router.push('/')
    router.refresh()
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setInfo('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password&mode=recovery`,
    })
    setLoading(false)
    // Rate-limit errors are worth showing; anything else stays neutral so the
    // form does not reveal which emails have accounts.
    if (error && /rate limit|too many/i.test(error.message)) {
      setError('Too many requests. Wait a few minutes and try again.')
      return
    }
    setInfo('If an account exists for that email, a password reset link is on its way. Check your inbox (and spam folder).')
  }

  const forgot = mode === 'forgot'
  return (
    <AuthCard
      title={forgot ? 'Reset your password' : 'Sign in'}
      description={forgot ? 'Enter your email and we will send you a link to choose a new password.' : 'Sign in to manage your studies.'}
    >
      <form onSubmit={forgot ? handleForgot : handleLogin} className="space-y-4">
        <Notice notice={error ? { tone: 'error', text: error } : null} />
        <Notice notice={info ? { tone: 'success', text: info } : null} />

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-fg">Email</label>
          <div className="relative">
            <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <input id="email" type="email" autoComplete="email" value={email} required
              onChange={e => setEmail(e.target.value)} className={`${inputClass} pl-9`} placeholder="you@university.ac.uk" />
          </div>
        </div>

        {!forgot && (
          <div className="space-y-1.5">
            <PasswordInput id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
            <div className="text-right">
              <button type="button" onClick={() => switchMode('forgot')}
                className="text-xs font-medium text-accent hover:underline">
                Forgot password?
              </button>
            </div>
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full">
          {forgot ? (loading ? 'Sending…' : 'Send reset link') : (loading ? 'Signing in…' : 'Sign in')}
        </Button>

        {forgot && (
          <Button variant="ghost" onClick={() => switchMode('signin')} className="w-full">
            <ArrowLeft size={14} aria-hidden="true" /> Back to sign in
          </Button>
        )}
      </form>
    </AuthCard>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-page" />}>
      <LoginForm />
    </Suspense>
  )
}
