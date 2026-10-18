'use client'

import { useMemo, useState } from 'react'
import { KeyRound, UserRound } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { useMe, useMyStudyRoles, STUDY_ROLE_LABEL } from '@/lib/access'
import { Notice, type NoticeState } from '@/components/feedback'
import { MIN_PASSWORD_LENGTH, PasswordInput, passwordProblem } from '@/components/password-fields'

export default function AccountPage() {
  const me = useMe()
  const { roles, loading: rolesLoading } = useMyStudyRoles()
  const supabase = useMemo(() => createClient(), [])
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [notice, setNotice] = useState<NoticeState>(null)
  const [saving, setSaving] = useState(false)

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!me?.email) return
    const problem = passwordProblem(password, confirm)
    if (problem) { setNotice({ tone: 'error', text: problem }); return }
    if (password === current) {
      setNotice({ tone: 'error', text: 'The new password must be different from the current one.' })
      return
    }
    setSaving(true)
    setNotice(null)
    // Re-authenticate first so a left-open session cannot change the password.
    const { error: authError } = await supabase.auth.signInWithPassword({ email: me.email, password: current })
    if (authError) {
      setSaving(false)
      setNotice({ tone: 'error', text: 'Your current password is incorrect.' })
      return
    }
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) { setNotice({ tone: 'error', text: error.message }); return }
    setCurrent(''); setPassword(''); setConfirm('')
    setNotice({ tone: 'success', text: 'Password changed.' })
  }

  const studyCount = Object.keys(roles).length

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Account</h1>
        <p className="mt-0.5 text-sm text-gray-500">Your sign-in details and password</p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600"><UserRound size={18} /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">{me?.email ?? '—'}</p>
            <p className="text-xs text-gray-500">
              {me?.role === 'admin' ? 'Administrator — full access to every study, researcher and the audit log' : 'Researcher'}
            </p>
          </div>
        </div>
        {me?.role !== 'admin' && (
          <p className="mt-4 border-t border-gray-100 pt-4 text-xs text-gray-500">
            {rolesLoading ? 'Loading study access…'
              : studyCount === 0 ? 'You are not a member of any study yet. A study owner or an admin can add you.'
              : `Member of ${studyCount} ${studyCount === 1 ? 'study' : 'studies'}: ${Object.values(roles).map(r => STUDY_ROLE_LABEL[r]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}.`}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800"><KeyRound size={16} /> Change password</h2>
        <form onSubmit={changePassword} className="mt-4 max-w-sm space-y-4">
          <Notice notice={notice} onClose={() => setNotice(null)} />
          <PasswordInput id="current-password" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
          <PasswordInput id="new-password" label="New password" value={password} onChange={setPassword}
            autoComplete="new-password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
          <PasswordInput id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          <button type="submit" disabled={saving || !me?.email}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </section>
    </div>
  )
}
