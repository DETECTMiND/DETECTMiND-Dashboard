'use client'

import { useMemo, useState } from 'react'
import { KeyRound, UserRound } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { useMe, useMyStudyRoles, STUDY_ROLE_LABEL } from '@/lib/access'
import { Button, Card, CardHeader, DescriptionList, Notice, PageHeader, Skeleton, type NoticeState } from '@/components/ui'
import { RoleBadge } from '@/components/role-badge'
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

  const isAdmin = me?.role === 'admin'
  const roleCounts = Object.values(roles).reduce<Record<string, number>>((acc, r) => { acc[r] = (acc[r] ?? 0) + 1; return acc }, {})
  const studyCount = Object.keys(roles).length

  const access = isAdmin
    ? 'Every study (admin)'
    : rolesLoading
      ? <Skeleton className="h-4 w-40" />
      : studyCount === 0
        ? 'No studies yet. A study owner or an admin can add you.'
        : `${studyCount} ${studyCount === 1 ? 'study' : 'studies'} (${Object.entries(roleCounts)
            .map(([r, n]) => `${n} as ${(STUDY_ROLE_LABEL[r as keyof typeof STUDY_ROLE_LABEL] ?? r).toLowerCase()}`).join(', ')})`

  return (
    <div>
      <PageHeader title="Account" />

      <div className="space-y-5">
        <Card>
          <CardHeader icon={<UserRound size={16} />} title="Profile" />
          <DescriptionList className="lg:grid-cols-4" items={[
            { label: 'Name', value: me?.displayName || <span className="text-subtle">Not set</span> },
            { label: 'Email', value: me?.email ?? '—' },
            { label: 'Account type', value: me ? <RoleBadge role={isAdmin ? 'admin' : 'researcher'} /> : <Skeleton className="h-4 w-20" /> },
            { label: 'Study access', value: access },
          ]} />
        </Card>

        <Card>
          <CardHeader icon={<KeyRound size={16} />} title="Change password" />
          <form onSubmit={changePassword} className="space-y-4">
            <Notice notice={notice} onClose={() => setNotice(null)} />
            <div className="grid gap-4 md:grid-cols-3 md:items-start">
              <PasswordInput id="current-password" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
              <PasswordInput id="new-password" label="New password" value={password} onChange={setPassword}
                autoComplete="new-password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
              <PasswordInput id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            </div>
            <Button type="submit" loading={saving} disabled={!me?.email}>
              {saving ? 'Saving…' : 'Change password'}
            </Button>
          </form>
        </Card>

      </div>
    </div>
  )
}
