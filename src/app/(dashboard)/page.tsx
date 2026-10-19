'use client'

import { createClient } from '@/lib/supabase-browser'
import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { formatDistanceToNow, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import {
  AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Database, FlaskConical, Hourglass,
  MessageSquare, ShieldAlert, Users, Wifi, WifiOff,
} from 'lucide-react'
import {
  Badge, ButtonLink, Card, CardHeader, EmptyState, ErrorState, PageHeader, SegmentedControl, Skeleton,
  StatusPill, TableWrap, THead, Th, Td, Tr,
} from '@/components/ui'
import {
  Avatar, hasPermissionIssue, isSyncOverdue, participantName, permissionSummary, syncHealth,
} from '@/components/participant-ui'
import { scopedSelect } from '@/components/data/scope'
import { must, mustCount, useAsync } from '@/components/data/use-async'
import { intensity } from '@/components/charts/theme'
import { DATA_TABLES } from '@/lib/sensors'
import { fetchAll, localDay } from '@/lib/csv'
import { studyPaths } from '@/lib/nav'
import { SYNC_STATUS, studyStatusInfo, type SyncStatusKey } from '@/lib/status'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Study {
  id: string
  name: string
  description: string | null
  status: string
  approved_at: string | null
  sync_interval_minutes: number | null
}

interface ParticipantRow {
  id: string
  label: string | null
  device_id: string
  status: string
  enrolled_at: string
  last_sync_at: string | null
  permissions: Record<string, boolean> | null
}

interface SyncRow {
  synced_at: string
  status: string
  records_synced: number | null
  participant_id: string
}

interface ScheduleRate {
  id: string
  name: string
  total: number
  responded: number
  expired: number
  pending: number
}

type TimeFilter = 'today' | 'week' | 'month' | 'all'
const TIME_FILTERS: { value: TimeFilter; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
]

const HEATMAP_DAYS: Record<TimeFilter, number> = { today: 1, week: 7, month: 30, all: 14 }
const HEATMAP_PARTICIPANTS = 12
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function rangeStart(filter: TimeFilter): string | null {
  const now = new Date()
  if (filter === 'today') return startOfDay(now).toISOString()
  if (filter === 'week') return startOfWeek(now, { weekStartsOn: 1 }).toISOString()
  if (filter === 'month') return startOfMonth(now).toISOString()
  return null
}

function daysAgoStart(days: number): Date {
  const d = startOfDay(new Date())
  d.setDate(d.getDate() - (days - 1))
  return d
}

function readPinned(): string | null {
  try { return localStorage.getItem('pinnedStudyId') } catch { return null }
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, children, tone = 'default' }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; children?: React.ReactNode; tone?: 'default' | 'danger'
}) {
  return (
    <Card className={`flex flex-col justify-between ${tone === 'danger' ? 'border-danger/40' : ''}`} data-icon={icon ? '' : undefined}>
      <h2 className="text-[13px] font-medium text-subtle">{label}</h2>
      <div>
        <p className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${tone === 'danger' ? 'text-danger' : 'text-fg'}`}>{value}</p>
        {children && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">{children}</div>}
      </div>
    </Card>
  )
}

function AttentionItem({ icon, tone, title, detail, href, action }: {
  icon: React.ReactNode; tone: 'red' | 'amber' | 'blue'; title: string; detail?: string; href: string; action: string
}) {
  const toneCls = tone === 'red' ? 'bg-danger-soft text-danger' : tone === 'amber' ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent'
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${toneCls}`} aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {detail && <p className="text-xs text-subtle">{detail}</p>}
      </div>
      <ButtonLink href={href} variant="secondary" size="sm">{action}</ButtonLink>
    </li>
  )
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading overview" className="space-y-6">
      <div className="space-y-2"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-80 max-w-full" /></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
      <Skeleton className="h-40 rounded-xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Skeleton className="h-80 rounded-xl lg:col-span-3" />
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function OverviewContent() {
  const supabase = useMemo(() => createClient(), [])
  const searchParams = useSearchParams()
  const studyParam = searchParams.get('study')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')

  // Which studies the signed-in researcher can see
  const studiesQ = useAsync('studies', async () => {
    const res = await supabase.from('studies')
      .select('id, name, description, status, approved_at, sync_interval_minutes')
      .order('created_at', { ascending: false })
    return { studies: must(res) as Study[], pinned: readPinned() }
  })
  const studies = studiesQ.data?.studies
  const study = studies
    ? [studyParam, studiesQ.data?.pinned, studies[0]?.id].map(id => studies.find(s => s.id === id)).find(Boolean) ?? null
    : null
  const requestedMissing = !!studies && !!studyParam && !studies.some(s => s.id === studyParam)

  // Everything for the selected study and period, in parallel
  const [renderedAt] = useState(() => Date.now())
  const dataQ = useAsync(study ? `overview:${study.id}|${timeFilter}` : null, async () => {
    const id = study!.id
    const scope = { studyId: id, participant: 'all' }
    const since = rangeStart(timeFilter)
    const heatDays = HEATMAP_DAYS[timeFilter]
    const windowStart = daysAgoStart(heatDays).toISOString()

    const participantsP = fetchAll<ParticipantRow>((from, to) => supabase.from('participants')
      .select('id, label, device_id, status, enrolled_at, last_sync_at, permissions')
      .eq('study_id', id).order('enrolled_at', { ascending: false }).order('id').range(from, to))

    const countsP = Promise.all(DATA_TABLES.map(t => {
      let q = scopedSelect(supabase, t.table, scope, 'id', { count: 'exact', head: true })
      if (since) q = q.gte(t.timeCol, since)
      return q.then(mustCount)
    }))

    let recentQ = scopedSelect(supabase, 'sync_log', scope, 'synced_at, status, records_synced, participant_id')
    if (since) recentQ = recentQ.gte('synced_at', since)
    const recentP = recentQ.order('synced_at', { ascending: false }).limit(25).then(r => must(r) as unknown as SyncRow[])

    // Sync rows for the activity grid and each participant's latest status
    const windowP = fetchAll<SyncRow>((from, to) => scopedSelect(supabase, 'sync_log', scope, 'synced_at, status, records_synced, participant_id')
      .gte('synced_at', windowStart).order('synced_at', { ascending: false }).order('id', { ascending: false })
      .range(from, to) as unknown as PromiseLike<{ data: SyncRow[] | null; error: { message: string } | null }>, { limit: 10_000 })

    const ratesP = supabase.from('esm_schedules').select('id, name').eq('study_id', id).order('created_at').then(async res => {
      const schedules = must(res) as { id: string; name: string }[]
      return Promise.all(schedules.map(async s => {
        const base = () => {
          let q = scopedSelect(supabase, 'data_esm_responses', scope, 'id', { count: 'exact', head: true }).eq('schedule_id', s.id)
          if (since) q = q.gte('triggered_at', since)
          return q
        }
        const [total, responded, expired, pending] = await Promise.all([
          base().then(mustCount),
          base().not('responded_at', 'is', null).eq('expired', false).then(mustCount),
          base().eq('expired', true).then(mustCount),
          base().is('responded_at', null).eq('expired', false).then(mustCount),
        ])
        return { id: s.id, name: s.name, total, responded, expired, pending } satisfies ScheduleRate
      }))
    })

    const responseTimesP = fetchAll<{ responded_at: string }>((from, to) => {
      let q = scopedSelect(supabase, 'data_esm_responses', scope, 'id, responded_at')
        .not('responded_at', 'is', null).eq('expired', false)
      if (since) q = q.gte('triggered_at', since)
      return q.order('id').range(from, to) as unknown as PromiseLike<{ data: { responded_at: string }[] | null; error: { message: string } | null }>
    }, { limit: 10_000 })

    const [participants, counts, recent, syncWindow, rates, responseTimes] =
      await Promise.all([participantsP, countsP, recentP, windowP, ratesP, responseTimesP])
    return {
      participants,
      counts: DATA_TABLES.map((t, i) => ({ table: t.table, label: t.label, count: counts[i] })).sort((a, b) => b.count - a.count),
      recent,
      syncWindow,
      heatDays,
      rates,
      responseTimes: responseTimes.map(r => r.responded_at),
    }
  })

  // ── Empty and error states ────────────────────────────────────────────────
  if (studiesQ.error) {
    return (
      <>
        <PageHeader title="Overview" />
        <ErrorState title="Could not load your studies" message={studiesQ.error} onRetry={studiesQ.retry} />
      </>
    )
  }
  if (studiesQ.loading) return <OverviewSkeleton />
  if (!studies || studies.length === 0) {
    return (
      <>
        <PageHeader title="Overview" description="Collection health for your studies at a glance." />
        <EmptyState icon={<FlaskConical size={28} />} title="No studies yet"
          hint="Create a study to choose sensors and surveys. An admin approves it before participants can join.">
          <ButtonLink href="/studies/new">Create a study</ButtonLink>
        </EmptyState>
      </>
    )
  }
  if (!study || requestedMissing) {
    return (
      <>
        <PageHeader title="Overview" />
        <EmptyState icon={<FlaskConical size={28} />} title="Study not found"
          hint="It may have been deleted, or you are not a member of it. Pick another study.">
          <ButtonLink href="/studies" variant="secondary">All studies</ButtonLink>
          <ButtonLink href="/studies/new">Create a study</ButtonLink>
        </EmptyState>
      </>
    )
  }

  const paths = studyPaths(study.id)
  const statusInfo = studyStatusInfo(study)
  const header = (
    <PageHeader
      eyebrow="Overview"
      title={<span className="flex flex-wrap items-center gap-2">{study.name}<StatusPill study={study} /></span>}
      description={study.description || statusInfo.description}
      actions={<SegmentedControl label="Period" value={timeFilter} onChange={setTimeFilter} size="sm" options={TIME_FILTERS} />}
    />
  )

  if (dataQ.error) {
    return (
      <>
        {header}
        <ErrorState title="Could not load the overview" message={dataQ.error} onRetry={dataQ.retry} />
      </>
    )
  }

  const d = dataQ.data ?? dataQ.previous
  if (!d) return <>{header}<OverviewSkeleton /></>
  const refreshing = dataQ.loading

  // ── Derived ───────────────────────────────────────────────────────────────
  const interval = study.sync_interval_minutes ?? 30
  const pMap = Object.fromEntries(d.participants.map(p => [p.id, p]))
  const active = d.participants.filter(p => p.status === 'active')
  const withdrawnCount = d.participants.length - active.length

  const latestByParticipant: Record<string, SyncRow> = {}
  for (const s of d.syncWindow) if (!latestByParticipant[s.participant_id]) latestByParticipant[s.participant_id] = s
  const latestActive = active.map(p => latestByParticipant[p.id]).filter(Boolean)
  const syncCounts = {
    success: latestActive.filter(s => s.status === 'success').length,
    partial: latestActive.filter(s => s.status === 'partial').length,
    error: latestActive.filter(s => s.status === 'error').length,
  }
  const successRate = latestActive.length ? Math.round((syncCounts.success / latestActive.length) * 100) : null

  const health = active.map(p => ({ p, h: syncHealth(p, interval, renderedAt) }))
  const overdue = health.filter(x => isSyncOverdue(x.h))
  const silent = health.filter(x => x.h.key === 'silent')
  const permIssues = active.filter(p => hasPermissionIssue(p.permissions))
  const syncErrors = active.filter(p => latestByParticipant[p.id]?.status === 'error')
  const attentionPeople = health
    .map(({ p, h }) => {
      const issues: string[] = []
      if (isSyncOverdue(h)) issues.push(h.label)
      const perm = permissionSummary(p.permissions)
      if (perm) issues.push(perm)
      if (latestByParticipant[p.id]?.status === 'error') issues.push('Last sync failed')
      return { p, issues, silent: h.key === 'silent' }
    })
    .filter(x => x.issues.length > 0)
    .sort((a, b) => Number(b.silent) - Number(a.silent) || b.issues.length - a.issues.length)

  const totalRecords = d.counts.reduce((s, c) => s + c.count, 0)
  const sensorsWithData = d.counts.filter(c => c.count > 0).length
  const maxCount = Math.max(...d.counts.map(c => c.count), 1)

  const surveyTotals = d.rates.reduce((acc, r) => ({ total: acc.total + r.total, responded: acc.responded + r.responded }), { total: 0, responded: 0 })
  const surveyRate = surveyTotals.total ? Math.round((surveyTotals.responded / surveyTotals.total) * 100) : null
  const ratesWithData = d.rates.filter(r => r.total > 0)

  // Participant × day activity grid (local days)
  const heatDays: string[] = []
  for (let i = d.heatDays - 1; i >= 0; i--) {
    const day = new Date(renderedAt); day.setDate(day.getDate() - i)
    heatDays.push(localDay(day))
  }
  const syncedOn = new Map<string, SyncStatusKey>()
  for (const s of d.syncWindow) {
    const key = `${s.participant_id}|${localDay(s.synced_at)}`
    const prev = syncedOn.get(key)
    if (!prev || (prev !== 'success' && s.status === 'success')) syncedOn.set(key, s.status as SyncStatusKey)
  }
  const heatParticipants = [...active]
    .sort((a, b) => (b.last_sync_at ?? '').localeCompare(a.last_sync_at ?? ''))
    .slice(0, HEATMAP_PARTICIPANTS)

  // Survey answer times: weekday × hour
  const answerGrid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  for (const ts of d.responseTimes) {
    const dt = new Date(ts)
    answerGrid[dt.getDay()][dt.getHours()]++
  }
  const answerMax = Math.max(...answerGrid.flat(), 1)

  const pending = statusInfo.key === 'pending'
  const noOneYet = d.participants.length === 0
  const attentionCount = (pending ? 1 : 0) + overdue.length + permIssues.length + syncErrors.length

  return (
    <div className="space-y-6">
      {header}

      <div aria-busy={refreshing} className={`space-y-6 transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<Users size={15} />} label="Participants" value={d.participants.length.toLocaleString()}>
            <Link href={`${paths.participants}?filter=active`} className="inline-flex items-center gap-1.5 font-medium text-success hover:underline">
              <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />{active.length} active
            </Link>
            <Link href={`${paths.participants}?filter=withdrawn`} className="font-medium text-subtle hover:text-fg hover:underline">
              {withdrawnCount} withdrawn
            </Link>
          </StatCard>

          <StatCard icon={<Database size={15} />} label="Records collected" value={fmt(totalRecords)}>
            <span className="text-subtle">{sensorsWithData} data type{sensorsWithData === 1 ? '' : 's'} with data</span>
          </StatCard>

          <StatCard icon={<Wifi size={15} />} label="Latest sync succeeded" value={successRate !== null ? `${successRate}%` : '—'}>
            {latestActive.length > 0 ? (
              <span className="text-subtle">
                {syncCounts.success} ok · {syncCounts.partial} partial · {syncCounts.error} failed, of {latestActive.length} active
              </span>
            ) : <span className="text-subtle">No syncs in the last {d.heatDays} day{d.heatDays === 1 ? '' : 's'}</span>}
          </StatCard>

          <StatCard icon={<MessageSquare size={15} />} label="Survey response rate" value={surveyRate !== null ? `${surveyRate}%` : '—'}>
            <Link href={paths.surveys} className="text-subtle hover:text-fg hover:underline">
              {surveyTotals.total ? `${surveyTotals.responded.toLocaleString()} of ${surveyTotals.total.toLocaleString()} answered` : 'No surveys sent in this period'}
            </Link>
          </StatCard>
        </div>

        {/* Needs attention */}
        <Card padded={false} aria-labelledby="attention-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 id="attention-heading" className="text-base font-semibold text-fg">Needs attention</h2>
              <p className="mt-0.5 text-xs text-subtle">
                Sync health is judged against this study&apos;s {Math.max(interval, 15)} minute sync interval.
              </p>
            </div>
            <ButtonLink href={`${paths.participants}?filter=${attentionCount ? 'issues' : 'all'}`} variant="ghost" size="sm">
              All participants <ArrowRight size={13} aria-hidden="true" />
            </ButtonLink>
          </div>
          {attentionCount === 0 && !noOneYet ? (
            <div className="flex items-center gap-3 px-5 py-5 text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-soft text-success" aria-hidden="true"><CheckCircle2 size={16} /></span>
              <div>
                <p className="font-semibold text-fg">Everything looks healthy</p>
                <p className="text-xs text-subtle">All active participants are syncing on time with their permissions on.</p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {pending && (
                <AttentionItem icon={<Hourglass size={15} />} tone="blue" title="Waiting for admin approval"
                  detail="Participants cannot join until an admin approves the study." href={paths.settings} action="Study settings" />
              )}
              {noOneYet && !pending && (
                <AttentionItem icon={<Users size={15} />} tone="blue" title="No one has joined yet"
                  detail="Share the study with participants so they can enrol from the app." href={paths.settings} action="Study settings" />
              )}
              {silent.length > 0 && (
                <AttentionItem icon={<WifiOff size={15} />} tone="red"
                  title={`${silent.length} participant${silent.length === 1 ? ' has' : 's have'} gone silent`}
                  detail="No upload for over a day (or 12 sync intervals). The app may have been uninstalled."
                  href={`${paths.participants}?filter=silent`} action="Review" />
              )}
              {overdue.length > silent.length && (
                <AttentionItem icon={<AlertTriangle size={15} />} tone="amber"
                  title={`${overdue.length - silent.length} participant${overdue.length - silent.length === 1 ? ' is' : 's are'} syncing late`}
                  detail="Missed at least two expected syncs."
                  href={`${paths.participants}?filter=stale`} action="Review" />
              )}
              {permIssues.length > 0 && (
                <AttentionItem icon={<ShieldAlert size={15} />} tone="amber"
                  title={`${permIssues.length} participant${permIssues.length === 1 ? ' has' : 's have'} permissions off`}
                  detail="Some sensors cannot collect until the participant turns these back on."
                  href={`${paths.participants}?filter=perm_missing`} action="Review" />
              )}
              {syncErrors.length > 0 && (
                <AttentionItem icon={<AlertTriangle size={15} />} tone="red"
                  title={`${syncErrors.length} participant${syncErrors.length === 1 ? '' : 's'} with a failed last sync`}
                  href={`${paths.participants}?filter=issues`} action="Review" />
              )}
              {attentionPeople.slice(0, 5).map(({ p, issues }) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Avatar id={p.id} name={participantName(p)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{participantName(p)}</p>
                    <p className="text-xs text-subtle">{issues.join(' · ')}</p>
                  </div>
                  <ButtonLink href={`${paths.participants}?participant=${p.id}`} variant="ghost" size="sm"
                    aria-label={`Open ${participantName(p)}`}>Open</ButtonLink>
                </li>
              ))}
              {attentionPeople.length > 5 && (
                <li className="px-5 py-3 text-center text-xs">
                  <Link href={`${paths.participants}?filter=issues`} className="font-medium text-accent hover:underline">
                    {attentionPeople.length - 5} more participant{attentionPeople.length - 5 === 1 ? '' : 's'} need attention
                  </Link>
                </li>
              )}
            </ul>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Recent syncs */}
          <div className="min-w-0 space-y-3 lg:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-fg">Recent sync activity</h2>
              <span className="text-xs text-subtle">Latest {d.recent.length || 25}</span>
            </div>
            {d.recent.length === 0 ? (
              <EmptyState icon={<Wifi size={24} />} title="No syncs in this period" hint="Syncs appear here when participants' phones upload data." />
            ) : (
              <TableWrap>
                <THead>
                  <tr>
                    <Th>Participant</Th>
                    <Th align="right" className="hidden sm:table-cell">Records</Th>
                    <Th align="right">When</Th>
                    <Th align="right">Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {d.recent.map((s, i) => {
                    const st = SYNC_STATUS[s.status as SyncStatusKey] ?? SYNC_STATUS.error
                    const p = pMap[s.participant_id]
                    const name = p ? participantName(p) : 'Unknown'
                    return (
                      <Tr key={`${s.participant_id}-${s.synced_at}-${i}`}>
                        <Td>
                          <Link href={`${paths.participants}?participant=${s.participant_id}`} className="flex min-w-0 items-center gap-2 font-medium text-fg hover:text-accent">
                            <Avatar id={s.participant_id} name={name} size="sm" />
                            <span className="max-w-40 truncate">{name}</span>
                          </Link>
                        </Td>
                        <Td align="right" className="hidden tabular-nums text-muted sm:table-cell">{s.records_synced?.toLocaleString() ?? '—'}</Td>
                        <Td align="right" className="whitespace-nowrap text-muted" title={new Date(s.synced_at).toLocaleString()}>
                          {formatDistanceToNow(new Date(s.synced_at), { addSuffix: true })}
                        </Td>
                        <Td align="right"><Badge tone={st.tone}>{st.label}</Badge></Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </TableWrap>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
            {/* Records by sensor */}
            <Card>
              <CardHeader title="Records by data type" actions={<span className="text-xs text-subtle">{fmt(totalRecords)} total</span>} className="mb-3" />
              {totalRecords === 0 ? (
                <p className="py-4 text-center text-sm text-subtle">No data collected in this period.</p>
              ) : (
                <ul className="space-y-2.5">
                  {d.counts.filter(c => c.count > 0).map(c => (
                    <li key={c.table}>
                      <Link href={paths.data} className="group block">
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-medium text-muted group-hover:text-fg">{c.label}</span>
                          <span className="tabular-nums text-subtle">{fmt(c.count)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${(c.count / maxCount) * 100}%` }} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Survey response rate */}
            <Card>
              <CardHeader title="Survey response rate" className="mb-3"
                actions={<ButtonLink href={paths.surveys} variant="ghost" size="sm">Responses</ButtonLink>} />
              {ratesWithData.length === 0 ? (
                <p className="py-4 text-center text-sm text-subtle">
                  {d.rates.length === 0 ? <>No surveys set up. <Link href={paths.surveySetup} className="font-medium text-accent hover:underline">Set one up</Link>.</> : 'No surveys sent in this period.'}
                </p>
              ) : (
                <>
                  <ul className="space-y-4">
                    {ratesWithData.map(s => {
                      const rate = Math.round((s.responded / s.total) * 100)
                      return (
                        <li key={s.id}>
                          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                            <span className="min-w-0 truncate font-medium text-fg">{s.name}</span>
                            <span className="shrink-0 tabular-nums"><strong className="text-fg">{rate}%</strong> <span className="text-subtle">{s.responded}/{s.total}</span></span>
                          </div>
                          <div className="flex h-2 overflow-hidden rounded-full bg-sunken" role="img"
                            aria-label={`${s.responded} answered, ${s.expired} expired, ${s.pending} pending`}>
                            <div className="h-full bg-success" style={{ width: `${(s.responded / s.total) * 100}%` }} />
                            <div className="h-full bg-danger/70" style={{ width: `${(s.expired / s.total) * 100}%` }} />
                            <div className="h-full bg-line-strong" style={{ width: `${(s.pending / s.total) * 100}%` }} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-subtle">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />Answered</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-danger/70" aria-hidden="true" />Expired</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-line-strong" aria-hidden="true" />Pending</span>
                  </div>
                </>
              )}
            </Card>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Participant activity */}
          <Card>
            <CardHeader title="Participant activity" description={`Days with at least one sync, last ${d.heatDays} day${d.heatDays === 1 ? '' : 's'}`} className="mb-3" />
            {heatParticipants.length === 0 ? (
              <p className="py-4 text-center text-sm text-subtle">No active participants.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[280px]">
                  <div className="mb-1 ml-24 flex gap-0.5" aria-hidden="true">
                    {heatDays.map((day, i) => (
                      <span key={day} className="flex-1 text-center text-[9px] text-subtle">
                        {d.heatDays <= 14 || i % 5 === 0 ? new Date(`${day}T12:00:00`).toLocaleDateString(undefined, d.heatDays <= 7 ? { weekday: 'narrow' } : { day: 'numeric' }) : ''}
                      </span>
                    ))}
                  </div>
                  <ul className="space-y-1">
                    {heatParticipants.map(p => (
                      <li key={p.id} className="flex items-center gap-0.5">
                        <Link href={`${paths.participants}?participant=${p.id}`} className="w-24 shrink-0 truncate pr-2 text-right text-[11px] font-medium text-muted hover:text-accent">
                          {p.label || p.device_id.slice(-8)}
                        </Link>
                        {heatDays.map(day => {
                          const status = syncedOn.get(`${p.id}|${day}`)
                          const bg = !status ? 'var(--surface-sunken)' : status === 'success' ? 'var(--success)' : status === 'partial' ? 'var(--warning)' : 'var(--danger)'
                          return <span key={day} title={`${participantName(p)}, ${day}: ${status ? SYNC_STATUS[status]?.label ?? status : 'no sync'}`}
                            className="h-5 flex-1 rounded-sm" style={{ background: bg }} />
                        })}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap justify-end gap-3 text-[11px] text-subtle">
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-success" aria-hidden="true" />Synced</span>
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-warning" aria-hidden="true" />Partial</span>
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-danger" aria-hidden="true" />Failed</span>
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-sunken ring-1 ring-line" aria-hidden="true" />No sync</span>
                  </div>
                </div>
              </div>
            )}
            {active.length > HEATMAP_PARTICIPANTS && (
              <p className="mt-2 text-xs text-subtle">Showing the {HEATMAP_PARTICIPANTS} most recently synced of {active.length} active participants.</p>
            )}
          </Card>

          {/* Survey answer times */}
          <Card>
            <CardHeader title="When participants answer surveys" description="Answers by weekday and hour (your local time)" className="mb-3"
              icon={<ClipboardList size={15} />} />
            {d.responseTimes.length === 0 ? (
              <p className="py-4 text-center text-sm text-subtle">No answers in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[320px]">
                  <div className="mb-1 ml-9 flex" aria-hidden="true">
                    {Array.from({ length: 24 }, (_, h) => (
                      <span key={h} className="flex-1 text-center text-[9px] text-subtle">{h % 6 === 0 ? `${String(h).padStart(2, '0')}` : ''}</span>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {WEEKDAYS.map((day, dow) => (
                      <div key={day} className="flex items-center gap-0.5">
                        <span className="w-9 shrink-0 pr-2 text-right text-[10px] text-subtle">{day}</span>
                        {answerGrid[dow].map((count, hour) => (
                          <span key={hour} title={`${day} ${String(hour).padStart(2, '0')}:00, ${count} answer${count === 1 ? '' : 's'}`}
                            className="h-5 flex-1 rounded-sm"
                            style={{ background: count ? intensity('var(--accent)', 0.15 + 0.85 * (count / answerMax)) : 'var(--surface-sunken)' }} />
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-subtle" aria-hidden="true">
                    Fewer
                    {[0, 0.25, 0.5, 0.75, 1].map(x => (
                      <span key={x} className="h-3 w-3 rounded-sm" style={{ background: x ? intensity('var(--accent)', 0.15 + 0.85 * x) : 'var(--surface-sunken)' }} />
                    ))}
                    More
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function OverviewPage() {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewContent />
    </Suspense>
  )
}
