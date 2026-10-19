'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { KeyRound, RefreshCw, Search, Send, UserCheck, UserPlus, UserX, Users } from 'lucide-react'
import { AdminOnly } from '@/components/admin-only'
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorState, FilterPills, Input, Notice, PageHeader, Select,
  SkeletonRows, TextField, useConfirm, type NoticeState,
} from '@/components/ui'
import { RoleBadge } from '@/components/role-badge'
import { RoleHelp } from '@/components/role-help'
import { STUDY_ROLE_LABEL, useMe, type StudyRole } from '@/lib/access'
import { studyPaths } from '@/lib/nav'

type AccountType = 'admin' | 'researcher'
type Person = {
  user_id: string
  email: string | null
  display_name: string | null
  role: AccountType
  active: boolean
  added_at: string | null
  invited_at: string | null
  last_sign_in_at: string | null
  accepted: boolean
  studies: { study_id: string; name: string; role: string }[]
}
type Status = 'active' | 'invited' | 'deactivated'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${res.status})`)
  return body as T
}

const messageOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

function statusOf(p: Person): Status {
  if (!p.active) return 'deactivated'
  return p.accepted ? 'active' : 'invited'
}

const STATUS_FILTERS: { value: '' | Status; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
  { value: 'deactivated', label: 'Deactivated' },
]

const COLS = 'md:grid-cols-[minmax(0,2fr)_9.5rem_minmax(0,1.3fr)_minmax(0,1.8fr)_auto]'

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true })

function PeopleAdmin() {
  const me = useMe()
  const { ask, dialog } = useConfirm()
  const [rows, setRows] = useState<Person[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<NoticeState>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | AccountType>('')
  const [statusFilter, setStatusFilter] = useState<'' | Status>('')

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteNotice, setInviteNotice] = useState<NoticeState>(null)

  const fetchPeople = useCallback(() => api<{ researchers: Person[] }>('/api/admin/researchers'), [])

  const load = useCallback(async () => {
    try {
      const data = await fetchPeople()
      setRows(data.researchers)
      setLoadError(null)
    } catch (e) {
      setLoadError(messageOf(e, 'Could not load people'))
    }
  }, [fetchPeople])

  useEffect(() => {
    let cancelled = false
    fetchPeople()
      .then(data => { if (!cancelled) setRows(data.researchers) })
      .catch(e => { if (!cancelled) setLoadError(messageOf(e, 'Could not load people')) })
    return () => { cancelled = true }
  }, [fetchPeople])

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteNotice(null)
    try {
      const res = await api<{ message: string }>('/api/admin/researchers', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), role: 'researcher', display_name: name.trim() || undefined }),
      })
      setInviteNotice({ tone: 'success', text: res.message })
      setEmail('')
      setName('')
      await load()
    } catch (err) {
      setInviteNotice({ tone: 'error', text: messageOf(err, 'The invite could not be sent') })
    } finally {
      setInviting(false)
    }
  }

  async function patch(p: Person, body: Record<string, unknown>, success: string): Promise<string | null> {
    try {
      const res = await api<{ warning?: string | null }>(`/api/admin/researchers/${p.user_id}`, { method: 'PATCH', body: JSON.stringify(body) })
      setNotice(res.warning ? { tone: 'error', text: res.warning } : { tone: 'success', text: success })
      await load()
      return null
    } catch (err) {
      return messageOf(err, 'The change failed')
    }
  }

  function changeType(p: Person, next: AccountType) {
    if (next === p.role) return
    const who = p.email ?? 'this person'
    if (next === 'admin') {
      ask({
        title: `Make ${who} an admin?`,
        tone: 'danger',
        confirmLabel: 'Make admin',
        body: <>
          <p><strong className="text-fg">Admins control the whole dashboard.</strong> They can:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>see and change every study and all participant data;</li>
            <li>approve and delete studies, and add or remove owners;</li>
            <li>invite people, change account types and deactivate anyone, including you;</li>
            <li>read the activity log.</li>
          </ul>
          <p>Only make someone an admin if you fully trust them.</p>
        </>,
        run: () => patch(p, { role: next }, `${who} is now an admin.`),
      })
    } else {
      ask({
        title: `Make ${who} a researcher?`,
        confirmLabel: 'Make researcher',
        body: <p>They keep only the studies where they are an owner, editor or viewer, and can no longer approve studies, manage people or read the activity log.</p>,
        run: () => patch(p, { role: next }, `${who} is now a researcher.`),
      })
    }
  }

  function setActive(p: Person, active: boolean) {
    const who = p.email ?? 'this person'
    ask(active ? {
      title: `Reactivate ${who}?`,
      confirmLabel: 'Reactivate',
      body: <p>They can sign in again and get back the study access they had before.</p>,
      run: () => patch(p, { active: true }, `${who} is active again.`),
    } : {
      title: `Deactivate ${who}?`,
      tone: 'danger',
      confirmLabel: 'Deactivate',
      body: <p>They are signed out and lose access to every study straight away. Their study roles are kept, so you can reactivate them later.</p>,
      run: () => patch(p, { active: false }, `${who} is deactivated.`),
    })
  }

  async function sendEmail(p: Person, action: 'invite' | 'reset') {
    setBusy(`${p.user_id}:${action}`)
    setNotice(null)
    try {
      const res = await api<{ message?: string }>(`/api/admin/researchers/${p.user_id}/resend`, { method: 'POST', body: JSON.stringify({ action }) })
      setNotice({ tone: 'success', text: res.message ?? `Email sent to ${p.email}.` })
    } catch (err) {
      setNotice({ tone: 'error', text: messageOf(err, 'The email could not be sent') })
    } finally {
      setBusy(null)
    }
  }

  const needle = search.trim().toLowerCase()
  const visible = (rows || []).filter(p =>
    (!needle || (p.email ?? '').toLowerCase().includes(needle) || (p.display_name ?? '').toLowerCase().includes(needle))
    && (!typeFilter || p.role === typeFilter)
    && (!statusFilter || statusOf(p) === statusFilter))
  const filtering = !!(needle || typeFilter || statusFilter)
  const countOf = (s: '' | Status) => (rows ? rows.filter(p => !s || statusOf(p) === s).length : null)

  return (
    <div>
      {dialog}
      <PageHeader
        title="People"
        description="Dashboard accounts. Access to a study is managed on that study's Team tab."
        actions={<Button variant="secondary" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" /> Refresh</Button>}
      />

      <div className="space-y-5">
        <Card>
          <CardHeader icon={<UserPlus size={16} />} title="Invite someone"
            description="They join as a researcher and get an email to set a password. Add them to studies from each study's Team tab." />
          <form onSubmit={invite} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <TextField label="Email" type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="name@university.ac.uk" autoComplete="off" />
              <TextField label="Name" hint="Optional" value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="off" />
            </div>
            <Notice notice={inviteNotice} onClose={() => setInviteNotice(null)} />
            <Button type="submit" loading={inviting}>
              <Send size={14} aria-hidden="true" /> {inviting ? 'Sending…' : 'Send invite'}
            </Button>
          </form>
        </Card>

        <RoleHelp />

        <section aria-labelledby="people-heading">
          <h2 id="people-heading" className="mb-3 text-lg font-semibold text-fg">
            Everyone {rows && <span className="text-sm font-normal text-subtle">({filtering ? `${visible.length} of ${rows.length}` : rows.length})</span>}
          </h2>

          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative w-full lg:w-72">
              <label htmlFor="people-search" className="sr-only">Search people</label>
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden="true" />
              <Input id="people-search" type="search" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by email or name" className="pl-8" />
            </div>
            <div className="w-full lg:w-44">
              <label htmlFor="people-type" className="sr-only">Account type</label>
              <Select id="people-type" value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}>
                <option value="">All account types</option>
                <option value="admin">Admins</option>
                <option value="researcher">Researchers</option>
              </Select>
            </div>
            <FilterPills label="Filter by status" value={statusFilter} onChange={setStatusFilter}
              options={STATUS_FILTERS.map(f => ({ value: f.value, label: f.label, count: countOf(f.value) }))} />
            {filtering && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setTypeFilter(''); setStatusFilter('') }}>Clear filters</Button>
            )}
          </div>

          <div className="mb-4"><Notice notice={notice} onClose={() => setNotice(null)} /></div>

          {loadError ? (
            <ErrorState title="Could not load people" message={loadError} onRetry={() => void load()} />
          ) : rows === null ? (
            <SkeletonRows rows={5} />
          ) : rows.length === 0 ? (
            <EmptyState icon={<Users size={30} aria-hidden="true" />} title="No one has been invited yet" hint="Use the form above to invite someone." />
          ) : visible.length === 0 ? (
            <EmptyState icon={<Users size={30} aria-hidden="true" />} title="No one matches these filters" />
          ) : (
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <div aria-hidden="true" className={`hidden gap-4 border-b border-line bg-sunken px-4 py-2.5 text-xs font-semibold text-subtle md:grid ${COLS}`}>
                <span>Person</span><span>Account type</span><span>Status</span><span>Studies</span><span className="text-right">Actions</span>
              </div>
              <ul className="divide-y divide-line" aria-label="People">
                {visible.map(p => (
                  <PersonRow key={p.user_id} person={p} self={p.user_id === me?.userId} busy={busy}
                    onType={next => changeType(p, next)} onActive={a => setActive(p, a)} onEmail={a => void sendEmail(p, a)} />
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function PersonRow({ person: p, self, busy, onType, onActive, onEmail }: {
  person: Person
  self: boolean
  busy: string | null
  onType: (next: AccountType) => void
  onActive: (active: boolean) => void
  onEmail: (action: 'invite' | 'reset') => void
}) {
  const status = statusOf(p)
  const who = p.email ?? p.user_id
  const selfHintId = `self-${p.user_id}`
  const typeLocked = !p.active || (self && p.role === 'admin')
  return (
    <li data-testid="researcher-row" data-user-id={p.user_id}
      className={`grid grid-cols-1 gap-3 px-4 py-4 md:items-center md:gap-4 md:py-3 ${COLS} ${p.active ? '' : 'bg-sunken/50'}`}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-fg">
          <span className="min-w-0 break-all">{who}</span>
          {self && <Badge tone="blue">You</Badge>}
        </p>
        {p.display_name && <p className="text-xs text-subtle">{p.display_name}</p>}
        {self && <p id={selfHintId} className="sr-only">You cannot change your own account type or deactivate yourself. Ask another admin.</p>}
      </div>

      <div className="flex items-center gap-2 md:block">
        <span className="w-24 shrink-0 text-xs text-subtle md:hidden">Account type</span>
        <Select value={p.role} disabled={typeLocked} onChange={e => onType(e.target.value as AccountType)}
          aria-label={`Account type for ${who}`} aria-describedby={self ? selfHintId : undefined} title={self ? "You cannot change your own account type" : undefined} className="h-8 text-xs md:w-full">
          <option value="researcher">Researcher</option>
          <option value="admin">Admin</option>
        </Select>
      </div>

      <div className="flex items-center gap-2 md:block">
        <span className="w-24 shrink-0 text-xs text-subtle md:hidden">Status</span>
        <div>
          <RoleBadge role={status === 'invited' ? 'pending' : status} />
          <p className="mt-1 text-xs text-subtle">
            {status === 'invited'
              ? (p.invited_at ? `Invited ${ago(p.invited_at)}` : 'Not signed in yet')
              : p.last_sign_in_at ? `Last sign-in ${ago(p.last_sign_in_at)}` : 'No sign-in recorded'}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 md:block">
        <span className="w-24 shrink-0 text-xs text-subtle md:hidden">Studies</span>
        {p.role === 'admin' ? (
          <span className="text-xs text-subtle">Every study (admin)</span>
        ) : p.studies.length === 0 ? (
          <span className="text-xs text-subtle">None yet</span>
        ) : (
          <ul className="flex min-w-0 flex-wrap gap-1" aria-label={`Studies of ${who}`}>
            {p.studies.map(s => (
              <li key={s.study_id} className="max-w-full">
                <Link href={studyPaths(s.study_id).team}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-muted hover:border-accent hover:text-accent">
                  <span className="min-w-0 truncate">{s.name}</span>
                  <span className="shrink-0 text-subtle">· {STUDY_ROLE_LABEL[s.role as StudyRole] ?? s.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 md:justify-end">
        {status === 'invited' && (
          <Button variant="secondary" size="sm" loading={busy === `${p.user_id}:invite`} disabled={busy !== null} onClick={() => onEmail('invite')}
            aria-label={`Resend invite to ${who}`}>
            <Send size={12} aria-hidden="true" /> Resend invite
          </Button>
        )}
        {status === 'active' && (
          <Button variant="secondary" size="sm" loading={busy === `${p.user_id}:reset`} disabled={busy !== null} onClick={() => onEmail('reset')}
            aria-label={`Send password reset to ${who}`}>
            <KeyRound size={12} aria-hidden="true" /> Send password reset
          </Button>
        )}
        {p.active ? (
          <Button variant="danger-ghost" size="sm" onClick={() => onActive(false)} disabled={self}
            aria-label={`Deactivate ${who}`} aria-describedby={self ? selfHintId : undefined}>
            <UserX size={12} aria-hidden="true" /> Deactivate
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => onActive(true)} aria-label={`Reactivate ${who}`}>
            <UserCheck size={12} aria-hidden="true" /> Reactivate
          </Button>
        )}
      </div>
    </li>
  )
}

export default function PeoplePage() {
  return <AdminOnly><PeopleAdmin /></AdminOnly>
}
