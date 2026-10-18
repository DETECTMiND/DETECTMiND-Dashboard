'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Mail, RefreshCw, Send, UserCheck, UserPlus, UserX, Users } from 'lucide-react'
import { AdminOnly } from '@/components/admin-only'
import { EmptyState, LoadingBlock, Notice, type NoticeState } from '@/components/feedback'
import { useMe, STUDY_ROLE_LABEL, type StudyRole } from '@/lib/access'

type Researcher = {
  user_id: string
  email: string | null
  display_name: string | null
  role: 'admin' | 'researcher'
  active: boolean
  added_at: string | null
  invited_at: string | null
  last_sign_in_at: string | null
  accepted: boolean
  studies: { study_id: string; name: string; role: string }[]
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${res.status})`)
  return body as T
}

function ResearchersAdmin() {
  const me = useMe()
  const [rows, setRows] = useState<Researcher[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<NoticeState>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'researcher' | 'admin'>('researcher')
  const [inviting, setInviting] = useState(false)
  const [showInactive, setShowInactive] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await api<{ researchers: Researcher[] }>('/api/admin/researchers')
      setRows(data.researchers)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load researchers')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api<{ researchers: Researcher[] }>('/api/admin/researchers')
      .then(data => { if (!cancelled) setRows(data.researchers) })
      .catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load researchers') })
    return () => { cancelled = true }
  }, [])

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setNotice(null)
    try {
      const res = await api<{ message: string }>('/api/admin/researchers', {
        method: 'POST', body: JSON.stringify({ email, role }),
      })
      setNotice({ tone: 'success', text: res.message })
      setEmail('')
      setRole('researcher')
      await load()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Invite failed' })
    } finally {
      setInviting(false)
    }
  }

  async function act(r: Researcher, label: string, run: () => Promise<{ message?: string; warning?: string | null }>) {
    setBusy(r.user_id)
    setNotice(null)
    try {
      const res = await run()
      setNotice(res.warning
        ? { tone: 'error', text: res.warning }
        : { tone: 'success', text: res.message ?? `${label}: ${r.email ?? r.user_id}` })
      await load()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : `${label} failed` })
    } finally {
      setBusy(null)
    }
  }

  const changeRole = (r: Researcher, next: 'admin' | 'researcher') => act(r, 'Role changed', () =>
    api(`/api/admin/researchers/${r.user_id}`, { method: 'PATCH', body: JSON.stringify({ role: next }) }))

  const setActive = (r: Researcher, active: boolean) => {
    if (!active && !window.confirm(`Deactivate ${r.email ?? 'this researcher'}? They lose access to every study immediately and are signed out.`)) return
    return act(r, active ? 'Reactivated' : 'Deactivated', () =>
      api(`/api/admin/researchers/${r.user_id}`, { method: 'PATCH', body: JSON.stringify({ active }) }))
  }

  const resend = (r: Researcher) => act(r, 'Email sent', () =>
    api(`/api/admin/researchers/${r.user_id}/resend`, { method: 'POST' }))

  const visible = (rows || []).filter(r => showInactive || r.active)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Researchers</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Invite people to the dashboard and control their access. Study access is granted per study on each study&apos;s Team page.
          </p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800"><UserPlus size={16} /> Invite a researcher</h2>
        <p className="mt-1 text-xs text-gray-500">They receive an email with a link to set their password. Admins can see and manage every study.</p>
        <form onSubmit={invite} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium text-gray-700">Email
            <div className="relative mt-1.5">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@university.ac.uk"
                className="w-full rounded-lg border border-gray-200 py-2 pl-8 pr-3 text-sm font-normal focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </label>
          <label className="text-sm font-medium text-gray-700">Role
            <select value={role} onChange={e => setRole(e.target.value as 'admin' | 'researcher')}
              className="mt-1.5 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal sm:w-44">
              <option value="researcher">Researcher</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" disabled={inviting}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
            <Send size={14} /> {inviting ? 'Sending…' : 'Send invite'}
          </button>
        </form>
      </section>

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {loadError ? (
        <Notice notice={{ tone: 'error', text: loadError }} />
      ) : rows === null ? (
        <LoadingBlock label="Loading researchers…" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Users size={30} />} title="No researchers yet" hint="Invite someone above." />
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-gray-700">{rows.filter(r => r.active).length} active · {rows.filter(r => !r.active).length} deactivated</p>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show deactivated
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5">Researcher</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Studies</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map(r => {
                  const self = r.user_id === me?.userId
                  const isBusy = busy === r.user_id
                  return (
                    <tr key={r.user_id} className={r.active ? '' : 'bg-gray-50/60 text-gray-400'}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{r.email ?? r.user_id}{self && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">You</span>}</p>
                        {r.display_name && <p className="text-xs text-gray-500">{r.display_name}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <select value={r.role} disabled={isBusy || !r.active}
                          onChange={e => void changeRole(r, e.target.value as 'admin' | 'researcher')}
                          aria-label={`Role for ${r.email}`}
                          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs disabled:opacity-60">
                          <option value="researcher">Researcher</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {r.active
                          ? <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Active</span>
                          : <span className="rounded-md bg-gray-200 px-2 py-0.5 font-semibold text-gray-600">Deactivated</span>}
                        <p className="mt-1 text-gray-500">
                          {!r.accepted ? 'Invite pending'
                            : r.last_sign_in_at ? `Last sign-in ${formatDistanceToNow(new Date(r.last_sign_in_at), { addSuffix: true })}`
                            : 'Invite accepted'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {r.role === 'admin' ? (
                          <span className="text-xs text-gray-500">All studies (admin)</span>
                        ) : r.studies.length === 0 ? (
                          <span className="text-xs text-gray-400">None</span>
                        ) : (
                          <div className="flex max-w-xs flex-wrap gap-1">
                            {r.studies.map(s => (
                              <Link key={s.study_id} href={`/studies/${s.study_id}/team`}
                                className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-600 hover:border-blue-300">
                                {s.name} · {STUDY_ROLE_LABEL[s.role as StudyRole] ?? s.role}
                              </Link>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          {r.active && (
                            <button onClick={() => void resend(r)} disabled={isBusy}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                              <Send size={12} /> {r.accepted ? 'Send reset link' : 'Resend invite'}
                            </button>
                          )}
                          {r.active ? (
                            <button onClick={() => void setActive(r, false)} disabled={isBusy || self} title={self ? 'You cannot deactivate yourself' : undefined}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">
                              <UserX size={12} /> Deactivate
                            </button>
                          ) : (
                            <button onClick={() => void setActive(r, true)} disabled={isBusy}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                              <UserCheck size={12} /> Reactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

export default function ResearchersPage() {
  return <AdminOnly><ResearchersAdmin /></AdminOnly>
}
