'use client'

import { createClient } from '@/lib/supabase-browser'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState } from 'react'
import { ArrowLeft, FlaskConical, Lock, Mail } from 'lucide-react'

const INPUT = 'w-full border border-gray-200 text-gray-900 placeholder-gray-400 pl-9 pr-3 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all'
const BUTTON = 'w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm font-semibold transition-colors mt-1 shadow-sm'

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
        ? 'Your researcher account has been deactivated. Contact an administrator if you need access again.'
        : 'Your account is not authorised as a researcher. Ask an administrator to invite you.')
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
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
    setLoading(false)
    // Rate-limit errors are worth showing; anything else stays neutral so the
    // form does not reveal which emails have accounts.
    if (error && /rate limit|too many/i.test(error.message)) {
      setError('Too many requests. Please wait a few minutes and try again.')
      return
    }
    setInfo('If an account exists for that email, a password reset link is on its way. Check your inbox (and spam folder).')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-2xl mb-4 shadow-sm">
            <FlaskConical size={22} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">DETECTMiND Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            {mode === 'signin' ? 'Sign in to manage your studies' : 'Reset your password'}
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-7 shadow-sm">
          <form onSubmit={mode === 'signin' ? handleLogin : handleForgot} className="space-y-4">
            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm">
                {error}
              </div>
            )}
            {info && (
              <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-sm">
                {info}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input id="email" type="email" autoComplete="email" value={email}
                  onChange={e => setEmail(e.target.value)} className={INPUT} placeholder="you@example.com" required />
              </div>
            </div>

            {mode === 'signin' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
                  <button type="button" onClick={() => { setMode('forgot'); setError(''); setInfo('') }}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700">
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input id="password" type="password" autoComplete="current-password" value={password}
                    onChange={e => setPassword(e.target.value)} className={INPUT} placeholder="••••••••" required />
                </div>
              </div>
            )}

            <button type="submit" disabled={loading} className={BUTTON}>
              {mode === 'signin'
                ? (loading ? 'Signing in…' : 'Sign In')
                : (loading ? 'Sending…' : 'Send reset link')}
            </button>

            {mode === 'forgot' && (
              <button type="button" onClick={() => { setMode('signin'); setError(''); setInfo('') }}
                className="flex w-full items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
                <ArrowLeft size={14} /> Back to sign in
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <LoginForm />
    </Suspense>
  )
}
