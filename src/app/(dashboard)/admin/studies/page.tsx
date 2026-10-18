'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Check, Crown, FlaskConical, RefreshCw, Search, Trash2, UserPlus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { AdminOnly } from '@/components/admin-only'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SearchSelect, type SearchOption } from '@/components/search-select'
import { EmptyState, LoadingBlock, Notice, errorText, type NoticeState } from '@/components/feedback'
import { isPendingApproval, notifyPendingStudiesChanged } from '@/lib/pending-studies'

type StudyRow = {
  id: string
  name: string
  status: string
  created_at: string
  approved_at: string | null
  approved_by: string | null
  created_by: string | null
}
type MemberRow = { study_id: string; user_id: string; role: 'owner' | 'editor' | 'viewer' }
type ResearcherRow = { user_id: string; email: string | null; display_name: string | null }

type StudyView = StudyRow & {
  pending: boolean
  owners: { user_id: string; email: string }[]
  memberCount: number
  participantCount: number | null
  createdByEmail: string | null
  approvedByEmail: string | null
}

type Dialog =
  | { kind: 'approve'; study: StudyView }
  | { kind: 'reject'; study: StudyView }
  | { kind: 'delete'; study: StudyView }
  | { kind: 'assign'; study: StudyView }
  | { kind: 'remove-owner'; study: StudyView; owner: { user_id: string; email: string } }

const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending approval' },
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
]

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  draft: 'bg-gray-100 text-gray-600 ring-gray-200',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  paused: 'bg-amber-50 text-amber-700 ring-amber-200',
  completed: 'bg-blue-50 text-blue-700 ring-blue-200',
}

const fmtDate = (iso: string | null) => (iso ? format(new Date(iso), 'd MMM yyyy') : '—')

export default function AdminStudiesPage() {
  return <AdminOnly><AdminStudies /></AdminOnly>
}

function AdminStudies() {
  const supabase = useMemo(() => createClient(), [])
  const [studies, setStudies] = useState<StudyView[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<NoticeState>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [directory, setDirectory] = useState<SearchOption[] | null>(null)
  const [pick, setPick] = useState<string | null>(null)

  const fetchAll = useCallback(async (): Promise<{ rows: StudyView[]; error: string | null }> => {
    const [s, m, r] = await Promise.all([
      supabase.from('studies').select('id, name, status, created_at, approved_at, approved_by, created_by').order('created_at', { ascending: false }),
      supabase.from('study_members').select('study_id, user_id, role'),
      supabase.from('researchers').select('user_id, email, display_name'),
    ])
    const error = s.error ?? m.error ?? r.error
    if (error) return { rows: [], error: errorText(error) }
    const studyRows = (s.data || []) as StudyRow[]
    const members = (m.data || []) as MemberRow[]
    const emailOf = new Map(((r.data || []) as ResearcherRow[]).map(x => [x.user_id, x.email ?? x.user_id]))

    const counts = await Promise.all(studyRows.map(st =>
      supabase.from('participants').select('id', { count: 'exact', head: true }).eq('study_id', st.id)
        .then(res => (res.error ? null : res.count ?? 0))))

    const rows = studyRows.map((st, i): StudyView => {
      const mine = members.filter(x => x.study_id === st.id)
      return {
        ...st,
        pending: isPendingApproval(st),
        owners: mine.filter(x => x.role === 'owner')
          .map(x => ({ user_id: x.user_id, email: emailOf.get(x.user_id) ?? x.user_id }))
          .sort((a, b) => a.email.localeCompare(b.email)),
        memberCount: mine.length,
        participantCount: counts[i],
        createdByEmail: st.created_by ? emailOf.get(st.created_by) ?? null : null,
        approvedByEmail: st.approved_by ? emailOf.get(st.approved_by) ?? null : null,
      }
    })
    // Pending first, then newest.
    rows.sort((a, b) => Number(b.pending) - Number(a.pending) || b.created_at.localeCompare(a.created_at))
    return { rows, error: null }
  }, [supabase])

  const load = useCallback(async () => {
    const res = await fetchAll()
    setStudies(res.rows)
    setLoadError(res.error)
  }, [fetchAll])

  useEffect(() => {
    let cancelled = false
    fetchAll().then(res => {
      if (cancelled) return
      setStudies(res.rows)
      setLoadError(res.error)
    })
    return () => { cancelled = true }
  }, [fetchAll])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (studies || []).filter(st => {
      if (statusFilter === 'pending' && !st.pending) return false
      if (statusFilter !== 'all' && statusFilter !== 'pending' && st.status !== statusFilter) return false
      if (!needle) return true
      return st.name.toLowerCase().includes(needle)
        || st.owners.some(o => o.email.toLowerCase().includes(needle))
        || (st.createdByEmail ?? '').toLowerCase().includes(needle)
    })
  }, [studies, query, statusFilter])

  const pendingCount = (studies || []).filter(s => s.pending).length

  function open(next: Dialog) {
    setReason('')
    setDialogError(null)
    setBusy(false)
    setPick(null)
    setDialog(next)
    if (next.kind === 'assign') {
      setDirectory(null)
      supabase.rpc('researcher_directory', { p_study: next.study.id }).then(({ data, error }) => {
        if (error) { setDialogError(errorText(error)); setDirectory([]); return }
        const ownerIds = new Set(next.study.owners.map(o => o.user_id))
        setDirectory(((data || []) as ResearcherRow[])
          .filter(x => !ownerIds.has(x.user_id))
          .map(x => ({ value: x.user_id, label: x.email ?? x.user_id, hint: x.display_name })))
      })
    }
  }

  function close() {
    if (!busy) setDialog(null)
  }

  /** Runs the dialog's action; a returned string is shown as the dialog error. */
  async function confirm() {
    if (!dialog) return
    const st = dialog.study
    let problem: string | null = null
    let success = ''
    setBusy(true)
    setDialogError(null)

    if (dialog.kind === 'approve') {
      const { data, error } = await supabase.from('studies').update({ status: 'active' }).eq('id', st.id).select('id')
      problem = error ? errorText(error) : !data?.length ? 'The study could not be updated. It may have been deleted.' : null
      success = `${st.name} is approved and active.`
    } else if (dialog.kind === 'reject' || dialog.kind === 'delete') {
      const text = reason.trim()
      if (dialog.kind === 'reject' && !text) {
        problem = 'Enter a reason for rejecting this study.'
      } else {
        const { error } = await supabase.rpc('delete_study', {
          p_study: st.id,
          p_reason: text ? (dialog.kind === 'reject' ? `Rejected: ${text}` : text) : null,
        })
        problem = error ? errorText(error) : null
        success = dialog.kind === 'reject' ? `${st.name} was rejected and deleted.` : `${st.name} was deleted.`
      }
    } else if (dialog.kind === 'assign') {
      const who = directory?.find(o => o.value === pick)
      if (!who) {
        problem = 'Pick a researcher to make owner.'
      } else {
        const { error } = await supabase.from('study_members')
          .upsert({ study_id: st.id, user_id: who.value, role: 'owner' }, { onConflict: 'study_id,user_id' })
        problem = error ? errorText(error) : null
        success = `${who.label} is now an owner of ${st.name}.`
      }
    } else if (dialog.kind === 'remove-owner') {
      const { data, error } = await supabase.from('study_members').delete()
        .eq('study_id', st.id).eq('user_id', dialog.owner.user_id).eq('role', 'owner').select('user_id')
      problem = error ? errorText(error) : !data?.length ? 'This owner was already removed.' : null
      success = `${dialog.owner.email} is no longer an owner of ${st.name}.`
    }

    setBusy(false)
    if (problem) { setDialogError(problem); return }
    setDialog(null)
    setNotice({ tone: 'success', text: success })
    if (dialog.kind !== 'assign' && dialog.kind !== 'remove-owner') notifyPendingStudiesChanged()
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Studies</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Approve new studies, assign owners and delete studies. {pendingCount > 0 && <strong className="font-semibold text-amber-700">{pendingCount} waiting for approval.</strong>}
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </div>

      <Notice notice={notice} onClose={() => setNotice(null)} />
      {loadError && <Notice notice={{ tone: 'error', text: `Could not load studies: ${loadError}` }} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm font-medium text-gray-700">
          Search studies
          <div className="relative mt-1.5">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Study name or owner email"
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-sm font-normal focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
        </label>
        <label className="text-sm font-medium text-gray-700">
          Status filter
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal sm:w-48">
            {STATUS_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
      </div>

      {studies === null ? (
        <LoadingBlock label="Loading studies…" />
      ) : visible.length === 0 ? (
        <EmptyState icon={<FlaskConical size={30} />} title={studies.length ? 'No studies match these filters' : 'No studies yet'} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {/* Column headings (table layout from md up; rows become cards below md). */}
          <div aria-hidden="true" className="hidden grid-cols-[minmax(0,2fr)_minmax(0,2fr)_6rem_7rem_minmax(0,1.6fr)_auto] gap-4 border-b border-gray-100 bg-gray-50 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500 md:grid">
            <span>Study</span><span>Owners</span><span>Members</span><span>Participants</span><span>Created / approved</span><span className="text-right">Actions</span>
          </div>
          <ul className="divide-y divide-gray-100" aria-label="Studies">
            {visible.map(st => <StudyItem key={st.id} study={st} onAction={open} />)}
          </ul>
        </div>
      )}

      {dialog && (
        <ConfirmDialog
          open
          tone={dialog.kind === 'approve' || dialog.kind === 'assign' ? 'default' : 'danger'}
          title={dialogTitle(dialog)}
          body={dialogBody(dialog)}
          confirmLabel={dialogConfirm(dialog)}
          requireText={dialog.kind === 'delete' ? dialog.study.name : undefined}
          busy={busy}
          error={dialogError}
          onConfirm={confirm}
          onCancel={close}
        >
          {(dialog.kind === 'reject' || dialog.kind === 'delete') && (
            <label className="block text-sm font-medium text-gray-700">
              Reason{dialog.kind === 'delete' && <span className="font-normal text-gray-400"> (optional)</span>}
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={1000}
                required={dialog.kind === 'reject'}
                placeholder={dialog.kind === 'reject' ? 'e.g. Duplicate of an existing study' : 'Kept in the audit log'}
                className="mt-1.5 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </label>
          )}
          {dialog.kind === 'assign' && (
            directory === null
              ? <p className="text-sm text-gray-500">Loading researchers…</p>
              : <SearchSelect label="Search researchers" options={directory} value={pick} onChange={setPick}
                  placeholder="Type an email or name" emptyText="No active researchers match" />
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}

function dialogTitle(d: Dialog): string {
  switch (d.kind) {
    case 'approve': return `Approve ${d.study.name}?`
    case 'reject': return `Reject ${d.study.name}?`
    case 'delete': return `Delete ${d.study.name}?`
    case 'assign': return `Assign an owner to ${d.study.name}`
    case 'remove-owner': return `Remove ${d.owner.email} as owner?`
  }
}

function dialogConfirm(d: Dialog): string {
  switch (d.kind) {
    case 'approve': return 'Approve'
    case 'reject': return 'Reject study'
    case 'delete': return 'Delete permanently'
    case 'assign': return 'Assign owner'
    case 'remove-owner': return 'Remove owner'
  }
}

function dialogBody(d: Dialog): React.ReactNode {
  const n = d.study.participantCount
  const participants = n === null ? 'its participants' : `${n} participant${n === 1 ? '' : 's'}`
  switch (d.kind) {
    case 'approve': return <p>The study becomes active and participants can join it straight away.</p>
    case 'reject': return <p>Rejecting deletes this pending study and its setup. The reason is saved in the audit log.</p>
    case 'delete': return <p>This permanently deletes the study, {participants} and all collected data. This cannot be undone.</p>
    case 'assign': return <p>Owners can pause or complete the study, manage editors and viewers, and delete participants.</p>
    case 'remove-owner': return <p>They lose access to this study. A study must keep at least one owner, so add another owner first if they are the only one.</p>
  }
}

function StatusPill({ study }: { study: StudyView }) {
  const key = study.pending ? 'pending' : study.status
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_STYLES[key] ?? STATUS_STYLES.draft}`}>
      {study.pending ? 'Pending approval' : study.status}
    </span>
  )
}

function StudyItem({ study: st, onAction }: { study: StudyView; onAction: (d: Dialog) => void }) {
  const btn = 'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors'
  return (
    <li data-testid="study-row" data-study-id={st.id}
      className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_6rem_7rem_minmax(0,1.6fr)_auto] md:items-center md:gap-4 md:px-5 md:py-3">
      {/* Study */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/studies/${st.id}`} className="truncate text-sm font-semibold text-gray-900 hover:text-blue-700">{st.name}</Link>
          <StatusPill study={st} />
        </div>
        <p className="mt-0.5 truncate text-xs text-gray-500">Created by {st.createdByEmail ?? 'seed / system'}</p>
      </div>

      {/* Owners */}
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 md:hidden">Owners</p>
        {st.owners.length === 0 ? (
          <p className="text-xs text-red-600">No owner</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label={`Owners of ${st.name}`}>
            {st.owners.map(o => (
              <li key={o.user_id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-amber-50 py-0.5 pl-1.5 pr-0.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
                <Crown size={11} aria-hidden="true" />
                <span className="truncate">{o.email}</span>
                <button type="button" onClick={() => onAction({ kind: 'remove-owner', study: st, owner: o })}
                  aria-label={`Remove owner ${o.email}`} className="rounded p-0.5 text-amber-700 hover:bg-amber-100">
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Counts */}
      <div className="flex gap-6 text-sm text-gray-700 md:contents">
        <p><span className="text-xs text-gray-400 md:hidden">Members </span>{st.memberCount}</p>
        <p><span className="text-xs text-gray-400 md:hidden">Participants </span>{st.participantCount ?? '—'}</p>
      </div>

      {/* Dates */}
      <div className="text-xs text-gray-500">
        <p>Created {fmtDate(st.created_at)}</p>
        <p>{st.approved_at ? <>Approved {fmtDate(st.approved_at)}{st.approvedByEmail ? ` by ${st.approvedByEmail}` : ''}</> : 'Not approved'}</p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 md:justify-end">
        {st.pending && (
          <>
            <button type="button" onClick={() => onAction({ kind: 'approve', study: st })} aria-label="Approve"
              title={`Approve ${st.name}`} className={`${btn} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}>
              <Check size={12} aria-hidden="true" /> Approve
            </button>
            <button type="button" onClick={() => onAction({ kind: 'reject', study: st })} aria-label="Reject"
              title={`Reject ${st.name}`} className={`${btn} border-red-200 bg-white text-red-600 hover:bg-red-50`}>
              <X size={12} aria-hidden="true" /> Reject
            </button>
          </>
        )}
        <button type="button" onClick={() => onAction({ kind: 'assign', study: st })} aria-label="Assign owner"
          title={`Assign an owner to ${st.name}`} className={`${btn} border-gray-200 bg-white text-gray-700 hover:bg-gray-50`}>
          <UserPlus size={12} aria-hidden="true" /> Assign owner
        </button>
        <button type="button" onClick={() => onAction({ kind: 'delete', study: st })} aria-label="Delete study"
          title={`Delete ${st.name}`} className={`${btn} border-red-200 bg-white text-red-600 hover:bg-red-50`}>
          <Trash2 size={12} aria-hidden="true" /> Delete
        </button>
      </div>
    </li>
  )
}
