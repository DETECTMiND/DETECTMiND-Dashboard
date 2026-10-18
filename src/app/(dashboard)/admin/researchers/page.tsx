'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Info, Mail, Plus, RefreshCw, Search, Send, UserCheck, UserPlus, UserX, Users, X } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { AdminOnly } from '@/components/admin-only'
import { useConfirm } from '@/components/confirm-dialog'
import { EmptyState, LoadingBlock, Notice, type NoticeState } from '@/components/feedback'
import { RoleBadge } from '@/components/role-badge'
import { RESEARCHER_ROLE_HELP, STUDY_ROLE_HELP, STUDY_ROLE_LABEL, useMe, type StudyRole } from '@/lib/access'

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
type StudyOption = { id: string; name: string }
type StudyGrant = { studyId: string; role: 'editor' | 'viewer' }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${res.status})`)
  return body as T
}

const inputCls = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30'

function statusOf(r: Researcher): 'active' | 'invited' | 'deactivated' {
  if (!r.active) return 'deactivated'
  return r.accepted ? 'active' : 'invited'
}

function ResearchersAdmin() {
  const me = useMe()
  const supabase = useMemo(() => createClient(), [])
  const { ask, dialog } = useConfirm()
  const [rows, setRows] = useState<Researcher[] | null>(null)
  const [studies, setStudies] = useState<StudyOption[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<NoticeState>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'' | 'admin' | 'researcher'>('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'invited' | 'deactivated'>('')
  const [studyFilter, setStudyFilter] = useState('')

  // Invite form
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'researcher' | 'admin'>('researcher')
  const [grants, setGrants] = useState<StudyGrant[]>([])
  const [grantStudy, setGrantStudy] = useState('')
  const [grantRole, setGrantRole] = useState<'editor' | 'viewer'>('viewer')
  const [inviting, setInviting] = useState(false)

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
    supabase.from('studies').select('id, name').order('name').then(({ data }) => {
      if (!cancelled) setStudies((data || []) as StudyOption[])
    })
    return () => { cancelled = true }
  }, [supabase])

  const studyName = (id: string) => studies.find(s => s.id === id)?.name ?? id.slice(0, 8)

  function addGrant() {
    if (!grantStudy || grants.some(g => g.studyId === grantStudy)) return
    setGrants(g => [...g, { studyId: grantStudy, role: grantRole }])
    setGrantStudy('')
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setNotice(null)
    const target = email.trim().toLowerCase()
    const parts: string[] = []
    let failed = false
    try {
      try {
        const res = await api<{ message: string }>('/api/admin/researchers', {
          method: 'POST', body: JSON.stringify({ email: target, role }),
        })
        parts.push(res.message)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invite failed'
        // Already a researcher: still add them to the chosen studies.
        if (grants.length > 0 && role === 'researcher' && /already a researcher/i.test(msg)) {
          parts.push(`${target} already has a researcher account.`)
        } else {
          throw err
        }
      }
      if (role === 'researcher') {
        for (const g of grants) {
          try {
            const res = await api<{ message?: string; status: string }>(`/api/studies/${g.studyId}/invite`, {
              method: 'POST', body: JSON.stringify({ email: target, role: g.role }),
            })
            parts.push(res.message ?? `Added to ${studyName(g.studyId)} as ${g.role}.`)
          } catch (err) {
            failed = true
            parts.push(`Could not add to ${studyName(g.studyId)}: ${err instanceof Error ? err.message : 'failed'}`)
          }
        }
      }
      setNotice({ tone: failed ? 'error' : 'success', text: parts.join(' ') })
      setEmail('')
      setRole('researcher')
      setGrants([])
      await load()
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Invite failed' })
    } finally {
      setInviting(false)
    }
  }

  async function patch(r: Researcher, body: Record<string, unknown>, success: string): Promise<string | null> {
    setBusy(r.user_id)
    try {
      const res = await api<{ warning?: string | null }>(`/api/admin/researchers/${r.user_id}`, { method: 'PATCH', body: JSON.stringify(body) })
      setNotice(res.warning ? { tone: 'error', text: res.warning } : { tone: 'success', text: success })
      await load()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'The change failed'
    } finally {
      setBusy(null)
    }
  }

  function changeRole(r: Researcher, next: 'admin' | 'researcher') {
    if (next === r.role) return
    const who = r.email ?? 'this researcher'
    if (next === 'admin') {
      ask({
        title: `Make ${who} an admin?`,
        tone: 'danger',
        confirmLabel: 'Make admin',
        body: <>
          <p><strong>Admins have full control of the whole dashboard.</strong> They can:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>see and edit every study and all participant data;</li>
            <li>approve and delete studies, and assign or remove owners;</li>
            <li>invite, promote and deactivate other researchers, including you;</li>
            <li>read the audit log.</li>
          </ul>
          <p>Only promote people you fully trust.</p>
        </>,
        run: () => patch(r, { role: next }, `${who} is now an admin.`),
      })
    } else {
      ask({
        title: `Remove admin rights from ${who}?`,
        confirmLabel: 'Make researcher',
        body: <p>They keep access only to studies where they are an owner, editor or viewer. They can no longer approve studies, manage researchers or read the audit log.</p>,
        run: () => patch(r, { role: next }, `${who} is now a researcher.`),
      })
    }
  }

  function setActive(r: Researcher, active: boolean) {
    const who = r.email ?? 'this researcher'
    ask(active ? {
      title: `Reactivate ${who}?`,
      confirmLabel: 'Reactivate',
      body: <p>They can sign in again and regain their previous study access.</p>,
      run: () => patch(r, { active: true }, `${who} reactivated.`),
    } : {
      title: `Deactivate ${who}?`,
      tone: 'danger',
      confirmLabel: 'Deactivate',
      body: <p>They lose access to every study immediately and are signed out. Their study memberships are kept, so you can reactivate them later.</p>,
      run: () => patch(r, { active: false }, `${who} deactivated.`),
    })
  }

  async function resend(r: Researcher) {
    setBusy(r.user_id)
    setNotice(null)
    try {
      const res = await api<{ message?: string }>(`/api/admin/researchers/${r.user_id}/resend`, { method: 'POST' })
      setNotice({ tone: 'success', text: res.message ?? `Email sent to ${r.email}` })
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not send the email' })
    } finally {
      setBusy(null)
    }
  }

  const needle = search.trim().toLowerCase()
  const visible = (rows || []).filter(r =>
    (!needle || (r.email ?? '').toLowerCase().includes(needle) || (r.display_name ?? '').toLowerCase().includes(needle))
    && (!roleFilter || r.role === roleFilter)
    && (!statusFilter || statusOf(r) === statusFilter)
    && (!studyFilter || r.studies.some(s => s.study_id === studyFilter)))
  const filtering = !!(needle || roleFilter || statusFilter || studyFilter)
  const counts = {
    active: (rows || []).filter(r => statusOf(r) === 'active').length,
    invited: (rows || []).filter(r => statusOf(r) === 'invited').length,
    deactivated: (rows || []).filter(r => statusOf(r) === 'deactivated').length,
  }

  return (
    <div className="space-y-6">
      {dialog}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Researchers</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Invite people to the dashboard and control their access. Study roles are also managed on each study&apos;s Team page.
          </p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800"><UserPlus size={16} /> Invite a researcher</h2>
          <p className="mt-1 text-xs text-gray-500">They get an email with a link to set their password. If they already have an account they are simply given access.</p>
          <form onSubmit={invite} className="mt-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700">Email</label>
                <div className="relative mt-1.5">
                  <Mail size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input id="invite-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@university.ac.uk"
                    className={`${inputCls} pl-8`} />
                </div>
              </div>
              <div>
                <label htmlFor="invite-role" className="block text-sm font-medium text-gray-700">Dashboard role</label>
                <select id="invite-role" value={role} onChange={e => setRole(e.target.value as 'admin' | 'researcher')}
                  className={`${inputCls} mt-1.5 sm:w-44`}>
                  <option value="researcher">Researcher</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            {role === 'admin' ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Admins have full access to every study and to researcher management. Only invite people you fully trust as admins.
              </p>
            ) : (
              <fieldset className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                <legend className="px-1 text-xs font-semibold text-gray-600">Also add to studies (optional)</legend>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="grant-study" className="block text-xs font-medium text-gray-600">Study</label>
                    <select id="grant-study" value={grantStudy} onChange={e => setGrantStudy(e.target.value)} className={`${inputCls} mt-1`}>
                      <option value="">Choose a study…</option>
                      {studies.filter(s => !grants.some(g => g.studyId === s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="grant-role" className="block text-xs font-medium text-gray-600">Study role</label>
                    <select id="grant-role" value={grantRole} onChange={e => setGrantRole(e.target.value as 'editor' | 'viewer')} className={`${inputCls} mt-1 sm:w-32`}>
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                  </div>
                  <button type="button" onClick={addGrant} disabled={!grantStudy}
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    <Plus size={14} /> Add study
                  </button>
                </div>
                {grants.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2" aria-label="Studies to add">
                    {grants.map(g => (
                      <li key={g.studyId} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 bg-white py-1 pl-2.5 pr-1 text-xs">
                        <span className="min-w-0 truncate font-medium text-gray-700">{studyName(g.studyId)}</span>
                        <RoleBadge role={g.role} />
                        <button type="button" onClick={() => setGrants(list => list.filter(x => x.studyId !== g.studyId))}
                          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label={`Do not add to ${studyName(g.studyId)}`}>
                          <X size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-gray-500">Owners can only be assigned on the study&apos;s Team page or in Admin → Studies.</p>
              </fieldset>
            )}

            <button type="submit" disabled={inviting}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 sm:w-auto">
              <Send size={14} /> {inviting ? 'Sending…' : 'Invite'}
            </button>
          </form>
        </section>

        <aside className="rounded-xl border border-gray-200 bg-white p-5 text-sm shadow-sm">
          <h2 className="flex items-center gap-2 font-semibold text-gray-800"><Info size={15} /> Roles explained</h2>
          <dl className="mt-3 space-y-3 text-xs text-gray-600">
            <div><dt><RoleBadge role="admin" /></dt><dd className="mt-1">{RESEARCHER_ROLE_HELP.admin}.</dd></div>
            <div><dt><RoleBadge role="researcher" /></dt><dd className="mt-1">{RESEARCHER_ROLE_HELP.researcher}.</dd></div>
            <div className="border-t border-gray-100 pt-3"><p className="font-semibold text-gray-700">Study roles</p></div>
            {(['owner', 'editor', 'viewer'] as const).map(r => (
              <div key={r}><dt><RoleBadge role={r} /></dt><dd className="mt-1">{STUDY_ROLE_HELP[r]}.</dd></div>
            ))}
          </dl>
        </aside>
      </div>

      <Notice notice={notice} onClose={() => setNotice(null)} />

      <section className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter researchers">
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="researcher-search" className="block text-xs font-medium text-gray-600">Search</label>
          <div className="relative mt-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input id="researcher-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Email or name"
              className={`${inputCls} pl-8`} />
          </div>
        </div>
        <div>
          <label htmlFor="filter-role" className="block text-xs font-medium text-gray-600">Filter by role</label>
          <select id="filter-role" value={roleFilter} onChange={e => setRoleFilter(e.target.value as typeof roleFilter)} className={`${inputCls} mt-1`}>
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="researcher">Researcher</option>
          </select>
        </div>
        <div>
          <label htmlFor="filter-status" className="block text-xs font-medium text-gray-600">Filter by status</label>
          <select id="filter-status" value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} className={`${inputCls} mt-1`}>
            <option value="">All statuses</option>
            <option value="active">Active ({counts.active})</option>
            <option value="invited">Invite pending ({counts.invited})</option>
            <option value="deactivated">Deactivated ({counts.deactivated})</option>
          </select>
        </div>
        <div>
          <label htmlFor="filter-study" className="block text-xs font-medium text-gray-600">Filter by study</label>
          <select id="filter-study" value={studyFilter} onChange={e => setStudyFilter(e.target.value)} className={`${inputCls} mt-1`}>
            <option value="">All studies</option>
            {studies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </section>

      {loadError ? (
        <Notice notice={{ tone: 'error', text: loadError }} />
      ) : rows === null ? (
        <LoadingBlock label="Loading researchers…" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Users size={30} />} title="No researchers yet" hint="Invite someone above." />
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-gray-700" aria-live="polite">
              {filtering ? `${visible.length} of ${rows.length} researchers` : `${rows.length} researchers`}
              <span className="font-normal text-gray-500"> · {counts.active} active · {counts.invited} invited · {counts.deactivated} deactivated</span>
            </p>
            {filtering && (
              <button onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter(''); setStudyFilter('') }}
                className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">Clear filters</button>
            )}
          </div>

          {/* Header row, md and up. Below md each row is a card. */}
          <div className="hidden grid-cols-[minmax(0,2fr)_9rem_minmax(0,1.2fr)_minmax(0,2fr)_auto] gap-4 border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 md:grid" aria-hidden="true">
            <span>Researcher</span><span>Role</span><span>Status</span><span>Studies</span><span className="text-right">Actions</span>
          </div>

          {visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">No researchers match these filters.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {visible.map(r => {
                const self = r.user_id === me?.userId
                const isBusy = busy === r.user_id
                const status = statusOf(r)
                return (
                  <li key={r.user_id} data-testid="researcher-row"
                    className={`grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-[minmax(0,2fr)_9rem_minmax(0,1.2fr)_minmax(0,2fr)_auto] md:items-center md:gap-4 md:py-3 ${r.active ? '' : 'bg-gray-50/60'}`}>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-gray-900">
                        <span className="min-w-0 break-all">{r.email ?? r.user_id}</span>
                        {self && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">You</span>}
                      </p>
                      {r.display_name && <p className="text-xs text-gray-500">{r.display_name}</p>}
                    </div>

                    <div className="flex items-center gap-2 md:block">
                      <span className="w-16 shrink-0 text-xs text-gray-500 md:hidden">Role</span>
                      <select value={r.role} disabled={isBusy || !r.active || (self && r.role === 'admin')}
                        onChange={e => changeRole(r, e.target.value as 'admin' | 'researcher')}
                        aria-label="Role"
                        aria-describedby={self && r.role === 'admin' ? `self-role-${r.user_id}` : undefined}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs disabled:opacity-60">
                        <option value="researcher">Researcher</option>
                        <option value="admin">Admin</option>
                      </select>
                      {self && r.role === 'admin' && (
                        <p id={`self-role-${r.user_id}`} className="text-[11px] text-gray-500 md:mt-1">You cannot remove your own admin role. Ask another admin.</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs md:block">
                      <span className="w-16 shrink-0 text-gray-500 md:hidden">Status</span>
                      <div>
                        {status === 'deactivated' ? <RoleBadge role="deactivated" />
                          : status === 'invited' ? <RoleBadge role="pending" />
                          : <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">Active</span>}
                        <p className="mt-1 text-gray-500">
                          {status === 'invited'
                            ? (r.invited_at ? `Invited ${formatDistanceToNow(new Date(r.invited_at), { addSuffix: true })}` : 'Has not signed in yet')
                            : r.last_sign_in_at ? `Last sign-in ${formatDistanceToNow(new Date(r.last_sign_in_at), { addSuffix: true })}` : 'Invite accepted'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2 md:block">
                      <span className="w-16 shrink-0 text-xs text-gray-500 md:hidden">Studies</span>
                      {r.role === 'admin' ? (
                        <span className="text-xs text-gray-500">All studies (admin)</span>
                      ) : r.studies.length === 0 ? (
                        <span className="text-xs text-gray-400">None</span>
                      ) : (
                        <div className="flex min-w-0 flex-wrap gap-1">
                          {r.studies.map(s => (
                            <Link key={s.study_id} href={`/studies/${s.study_id}/team`}
                              className="inline-flex max-w-full items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-600 hover:border-blue-300">
                              <span className="min-w-0 truncate">{s.name}</span>
                              <span className="text-gray-400">· {STUDY_ROLE_LABEL[s.role as StudyRole] ?? s.role}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5 md:justify-end">
                      {r.active && (
                        <button onClick={() => void resend(r)} disabled={isBusy}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                          <Send size={12} /> {r.accepted ? 'Send reset link' : 'Resend invite'}
                        </button>
                      )}
                      {r.active ? (
                        <button onClick={() => setActive(r, false)} disabled={isBusy || self} title={self ? 'You cannot deactivate yourself' : undefined}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">
                          <UserX size={12} /> Deactivate
                        </button>
                      ) : (
                        <button onClick={() => setActive(r, true)} disabled={isBusy}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                          <UserCheck size={12} /> Reactivate
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

export default function ResearchersPage() {
  return <AdminOnly><ResearchersAdmin /></AdminOnly>
}
