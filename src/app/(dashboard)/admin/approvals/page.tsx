'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { Check, Inbox, RefreshCw, Settings, X } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { AdminOnly } from '@/components/admin-only'
import {
  Badge, Button, ButtonLink, Card, ConfirmDialog, DescriptionList, EmptyState, ErrorState, Field, Notice, PageHeader,
  Skeleton, StatusPill, Textarea, errorText, useConfirm, type NoticeState,
} from '@/components/ui'
import { notifyPendingStudiesChanged } from '@/lib/pending-studies'
import { sensorLabel } from '@/lib/sensors'
import { studyPaths } from '@/lib/nav'

type PendingStudy = {
  id: string
  name: string
  description: string | null
  status: string
  approved_at: string | null
  created_at: string
  created_by: string | null
  creator: { email: string | null; name: string | null } | null
  sensors: string[]
  scheduleCount: number
}

type Loaded = { studies: PendingStudy[]; activeStudies: number | null; error: string | null }
type People = { total: number; invited: number } | null

type Row<T> = { data: T[] | null; error: { message: string } | null }
const none = <T,>(): Promise<Row<T>> => Promise.resolve({ data: [], error: null })

function ApprovalsAdmin() {
  const supabase = useMemo(() => createClient(), [])
  const { ask, dialog } = useConfirm()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [people, setPeople] = useState<People>(null)
  const [notice, setNotice] = useState<NoticeState>(null)
  const [rejecting, setRejecting] = useState<PendingStudy | null>(null)
  const [reason, setReason] = useState('')
  const [rejectError, setRejectError] = useState<string | null>(null)
  const [rejectBusy, setRejectBusy] = useState(false)

  const fetchAll = useCallback(async (): Promise<Loaded> => {
    const [s, r, active] = await Promise.all([
      supabase.from('studies').select('id, name, description, status, approved_at, created_at, created_by')
        .eq('status', 'draft').is('approved_at', null).order('created_at', { ascending: true }),
      supabase.from('researchers').select('user_id, email, display_name'),
      supabase.from('studies').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    ])
    if (s.error) return { studies: [], activeStudies: null, error: errorText(s.error) }
    const rows = (s.data || []) as Omit<PendingStudy, 'creator' | 'sensors' | 'scheduleCount'>[]
    const ids = rows.map(x => x.id)
    const [sensors, schedules] = await Promise.all([
      ids.length
        ? supabase.from('sensor_configs').select('study_id, sensor_type').in('study_id', ids).eq('enabled', true) as unknown as Promise<Row<{ study_id: string; sensor_type: string }>>
        : none<{ study_id: string; sensor_type: string }>(),
      ids.length
        ? supabase.from('esm_schedules').select('study_id').in('study_id', ids) as unknown as Promise<Row<{ study_id: string }>>
        : none<{ study_id: string }>(),
    ])
    const people = new Map(((r.data || []) as { user_id: string; email: string | null; display_name: string | null }[])
      .map(p => [p.user_id, { email: p.email, name: p.display_name }]))
    return {
      error: sensors.error?.message ?? schedules.error?.message ?? null,
      activeStudies: active.error ? null : active.count ?? 0,
      studies: rows.map(st => ({
        ...st,
        creator: st.created_by ? people.get(st.created_by) ?? null : null,
        sensors: (sensors.data || []).filter(x => x.study_id === st.id).map(x => sensorLabel(x.sensor_type)).sort(),
        scheduleCount: (schedules.data || []).filter(x => x.study_id === st.id).length,
      })),
    }
  }, [supabase])

  const fetchPeople = useCallback(async (): Promise<People> => {
    try {
      const res = await fetch('/api/admin/researchers')
      if (!res.ok) return null
      const body = await res.json() as { researchers?: { active: boolean; accepted: boolean }[] }
      const list = body.researchers ?? []
      return { total: list.filter(x => x.active && x.accepted).length, invited: list.filter(x => x.active && !x.accepted).length }
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchAll().then(res => { if (!cancelled) setLoaded(res) })
    fetchPeople().then(res => { if (!cancelled) setPeople(res) })
    return () => { cancelled = true }
  }, [fetchAll, fetchPeople])

  async function reload() {
    setLoaded(await fetchAll())
  }

  function approve(st: PendingStudy) {
    ask({
      title: `Approve ${st.name}?`,
      confirmLabel: 'Approve',
      body: <p>The study becomes active straight away and participants can join it.</p>,
      run: async () => {
        const { data, error } = await supabase.from('studies').update({ status: 'active' }).eq('id', st.id).select('id')
        if (error) return errorText(error)
        if (!data?.length) return 'The study could not be updated. It may have been deleted.'
        setNotice({ tone: 'success', text: `${st.name} is approved and active.` })
        notifyPendingStudiesChanged()
        await reload()
        return null
      },
    })
  }

  function openReject(st: PendingStudy) {
    setReason('')
    setRejectError(null)
    setRejectBusy(false)
    setRejecting(st)
  }

  async function confirmReject() {
    if (!rejecting) return
    const text = reason.trim()
    if (!text) { setRejectError('Enter a reason for rejecting this study.'); return }
    setRejectBusy(true)
    setRejectError(null)
    const { error } = await supabase.rpc('delete_study', { p_study: rejecting.id, p_reason: `Rejected: ${text}` })
    setRejectBusy(false)
    if (error) { setRejectError(errorText(error)); return }
    setNotice({ tone: 'success', text: `${rejecting.name} was rejected and deleted.` })
    setRejecting(null)
    notifyPendingStudiesChanged()
    await reload()
  }

  const studies = loaded?.studies ?? null
  const fmtCount = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString())

  return (
    <div>
      {dialog}
      <PageHeader
        title="Approvals"
        description="New studies wait here for approval before participants can join."
        actions={<Button variant="secondary" onClick={() => void reload()}><RefreshCw size={14} aria-hidden="true" /> Refresh</Button>}
      />

      <dl className="mb-5 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="At a glance">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-subtle">Active studies</dt>
          <dd className="font-semibold tabular-nums text-fg">{loaded ? fmtCount(loaded.activeStudies) : '…'}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-subtle">People</dt>
          <dd className="font-semibold tabular-nums text-fg">{people ? fmtCount(people.total) : '…'}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-subtle">Invited</dt>
          <dd className="font-semibold tabular-nums text-fg">{people ? fmtCount(people.invited) : '…'}</dd>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/admin/studies" className="font-medium text-accent hover:underline">All studies</Link>
          <Link href="/admin/people" className="font-medium text-accent hover:underline">People</Link>
        </div>
      </dl>

      <div className="space-y-4">
        <Notice notice={notice} onClose={() => setNotice(null)} />
        {loaded?.error && studies && studies.length > 0 && (
          <Notice notice={{ tone: 'error', text: `Some study details could not be loaded: ${loaded.error}` }} />
        )}

        {studies === null ? (
          <div role="status" aria-label="Loading pending studies" className="space-y-4">
            {[0, 1].map(i => (
              <Card key={i}>
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="mt-3 h-4 w-3/4" />
                <Skeleton className="mt-5 h-12 w-full" />
              </Card>
            ))}
          </div>
        ) : loaded?.error && studies.length === 0 ? (
          <ErrorState title="Could not load pending studies" message={loaded.error} onRetry={() => void reload()} />
        ) : studies.length === 0 ? (
          <EmptyState icon={<Inbox size={30} aria-hidden="true" />} title="Nothing is waiting for approval"
            hint="When a researcher creates a study it appears here for you to approve or reject." />
        ) : (
          <ul className="space-y-4" aria-label="Studies waiting for approval">
            {studies.map(st => (
              <li key={st.id}>
                <Card as="article" data-testid="approval-card" data-study-id={st.id} aria-labelledby={`approval-${st.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 id={`approval-${st.id}`} className="break-words text-base font-semibold text-fg">{st.name}</h2>
                        <StatusPill study={st} />
                      </div>
                      <p className="mt-1 break-words text-sm text-muted">{st.description || <span className="text-subtle">No description.</span>}</p>
                    </div>
                  </div>

                  <DescriptionList className="mt-4" items={[
                    {
                      label: 'Created by',
                      value: st.creator
                        ? <>{st.creator.name ? <>{st.creator.name} <span className="text-subtle">· {st.creator.email}</span></> : st.creator.email ?? 'Unknown'}</>
                        : <span className="text-subtle">Unknown</span>,
                    },
                    {
                      label: 'Created',
                      value: <span title={st.created_at}>{format(new Date(st.created_at), 'd MMM yyyy')} <span className="text-subtle">({formatDistanceToNow(new Date(st.created_at), { addSuffix: true })})</span></span>,
                    },
                    {
                      label: 'Sensors',
                      value: st.sensors.length === 0
                        ? <span className="text-subtle">None turned on</span>
                        : <span className="flex flex-wrap gap-1">{st.sensors.map(s => <Badge key={s}>{s}</Badge>)}</span>,
                    },
                    {
                      label: 'Survey schedules',
                      value: st.scheduleCount === 0 ? <span className="text-subtle">None</span> : st.scheduleCount,
                    },
                  ]} />

                  <div className="mt-5 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <ButtonLink href={studyPaths(st.id).settings} variant="ghost" size="sm" aria-label={`Review the setup of ${st.name}`}>
                      <Settings size={14} aria-hidden="true" /> Review setup
                    </ButtonLink>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row">
                      <Button variant="secondary" onClick={() => openReject(st)} className="text-danger">
                        <X size={14} aria-hidden="true" /> Reject
                      </Button>
                      <Button onClick={() => approve(st)}>
                        <Check size={14} aria-hidden="true" /> Approve
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={rejecting !== null}
        tone="danger"
        title={rejecting ? `Reject ${rejecting.name}?` : ''}
        body={<p>Rejecting deletes this study and its setup. The reason is kept in the activity log.</p>}
        confirmLabel="Reject study"
        busy={rejectBusy}
        error={rejectError && reason.trim() ? rejectError : null}
        onConfirm={confirmReject}
        onCancel={() => { if (!rejectBusy) setRejecting(null) }}
      >
        <Field label="Reason" required error={rejectError && !reason.trim() ? rejectError : null}>
          {(id, describedBy) => (
            <Textarea id={id} aria-describedby={describedBy} value={reason} onChange={e => setReason(e.target.value)}
              rows={3} maxLength={1000} aria-required="true" data-autofocus="" placeholder="For example: duplicate of an existing study" />
          )}
        </Field>
      </ConfirmDialog>
    </div>
  )
}

export default function ApprovalsPage() {
  return <AdminOnly><ApprovalsAdmin /></AdminOnly>
}

