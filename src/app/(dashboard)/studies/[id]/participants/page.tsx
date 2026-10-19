'use client'

import { createClient } from '@/lib/supabase-browser'
import { Suspense, useMemo, useRef, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Activity, ChartColumn, Check, Download, MessageSquare, Pencil, RotateCcw, Search, ShieldCheck,
  Smartphone, Trash2, UserMinus, X,
} from 'lucide-react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Badge, Button, ButtonLink, ConfirmDialog, DescriptionList, EmptyState, ErrorState, FilterPills, Modal, Notice,
  PageHeader, Pagination, ReadOnlyBanner, SegmentedControl, SkeletonRows, TableWrap, THead, Th, Td, Tr,
  useDialogFocus, type NoticeState,
  ActionMenu,
} from '@/components/ui'
import { MergeSuggestions } from '@/components/participant-merge'
import { PermissionHistoryModal } from '@/components/permission-history-modal'
import { PinLockouts } from '@/components/pin-lockouts'
import { MergeAudit } from '@/components/merge-audit'
import { DeleteParticipantModal } from '@/components/delete-participant-modal'
import {
  hasPermissionIssue, isSyncOverdue, missingPermissions, participantName, permissionSummary, syncHealth,
  type SyncHealth,
} from '@/components/participant-ui'
import { scopedSelect } from '@/components/data/scope'
import { must, useAsync } from '@/components/data/use-async'
import { C, axisLine, axisTick, gridProps, intensity, legendStyle, tooltipProps } from '@/components/charts/theme'
import { errorText } from '@/components/feedback'
import { useStudyAccess } from '@/lib/access'
import { downloadCsv, fetchAll, localDay } from '@/lib/csv'
import { studyPaths } from '@/lib/nav'
import { permissionLabel } from '@/lib/sensors'
import { SYNC_STATUS, type SyncStatusKey } from '@/lib/status'

interface Participant {
  id: string
  device_id: string
  label: string | null
  status: string
  enrolled_at: string
  last_sync_at: string | null
  permissions: Record<string, boolean> | null
  device_info: Record<string, string | number | boolean> | null
  merged_into?: string | null
  merged_at?: string | null
  merge_adopted_at?: string | null
  consent_version?: string | null
  consent_at?: string | null
}

interface SyncRow {
  synced_at: string
  status: string
  records_synced: number | null
  participant_id: string
  error_message?: string | null
}

type FilterKey = 'all' | 'issues' | 'active' | 'withdrawn' | 'stale' | 'silent' | 'perm_missing'

const FILTERS: { value: FilterKey; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'issues', label: 'Needs attention' },
  { value: 'active', label: 'Active' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'stale', label: 'Sync overdue' },
  { value: 'silent', label: 'Silent' },
  { value: 'perm_missing', label: 'Permissions off' },
]
const FILTER_KEYS = new Set<string>(FILTERS.map(f => f.value))
const PAGE_SIZE = 25

function deviceSummary(p: Participant): string {
  const di = p.device_info || {}
  return [
    di.model ? String(di.model) : 'Unknown device',
    di.android_version ? `Android ${di.android_version}` : null,
    di.app_version ? `app ${di.app_version}` : null,
  ].filter(Boolean).join(' · ')
}

function relative(iso: string | null) {
  return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : 'Never'
}

const iconBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-fg'

// ── Sync history ──────────────────────────────────────────────────────────────

function syncCellColor(rows: SyncRow[], maxPerDay: number): string {
  if (!rows.length) return 'var(--surface-sunken)'
  const ratio = Math.min(rows.length / Math.max(maxPerDay, 1), 1)
  if (rows.some(r => r.status === 'error')) return intensity('var(--danger)', 0.35 + ratio * 0.65)
  if (rows.some(r => r.status === 'partial')) return intensity('var(--warning)', 0.35 + ratio * 0.65)
  return intensity('var(--success)', 0.25 + ratio * 0.75)
}

function SyncHistoryModal({ participant, onClose }: { participant: Participant; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), [])
  const [range, setRange] = useState<'30d' | '90d' | 'all'>('90d')

  const q = useAsync(`sync:${participant.id}|${range}`, () => fetchAll<SyncRow>((from, to) => {
    let query = supabase.from('sync_log').select('synced_at, status, records_synced, participant_id, error_message')
      .eq('participant_id', participant.id)
    if (range !== 'all') {
      const since = new Date()
      since.setDate(since.getDate() - (range === '30d' ? 30 : 90))
      query = query.gte('synced_at', since.toISOString())
    }
    return query.order('synced_at', { ascending: true }).order('id').range(from, to)
  }, { limit: 20_000 }))
  const rows = q.data ?? q.previous ?? null

  const { calendarWeeks, trendData, stats, maxPerDay } = useMemo(() => {
    if (!rows || !rows.length) return { calendarWeeks: [], trendData: [], stats: null, maxPerDay: 1 }
    const byDate = new Map<string, SyncRow[]>()
    for (const r of rows) {
      const d = localDay(r.synced_at)
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d)!.push(r)
    }
    const maxPerDay = Math.max(...Array.from(byDate.values()).map(v => v.length), 1)

    // Calendar of local days: pad the start to Monday, fill to today
    const first = new Date(rows[0].synced_at)
    first.setHours(0, 0, 0, 0)
    const start = new Date(first)
    while ((start.getDay() + 6) % 7 !== 0) start.setDate(start.getDate() - 1)
    const end = new Date()
    const weeks: { date: string; rows: SyncRow[]; inRange: boolean }[][] = [[]]
    for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
      const w = weeks[weeks.length - 1]
      const key = localDay(cur)
      w.push({ date: key, rows: byDate.get(key) || [], inRange: cur >= first })
      if (w.length === 7) weeks.push([])
    }

    const trendData = Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, rs]) => ({
        date,
        records: rs.reduce((s, r) => s + (r.records_synced || 0), 0),
        syncs: rs.length,
        errors: rs.filter(r => r.status === 'error').length,
      }))

    const totalSyncs = rows.length
    const successCount = rows.filter(r => r.status === 'success').length
    const errorCount = rows.filter(r => r.status === 'error').length
    const partialCount = rows.filter(r => r.status === 'partial').length
    const totalRecords = rows.reduce((s, r) => s + (r.records_synced || 0), 0)
    return {
      calendarWeeks: weeks.filter(w => w.length),
      trendData,
      maxPerDay,
      stats: {
        totalSyncs, successCount, errorCount, partialCount, totalRecords,
        successRate: Math.round((successCount / totalSyncs) * 100), activeDays: byDate.size,
      },
    }
  }, [rows])

  const recentRows = useMemo(() => (rows ? [...rows].reverse().slice(0, 20) : []), [rows])
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <Modal open onClose={onClose} size="xl" title="Sync history" description={participantName(participant)}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl label="Period" value={range} onChange={setRange} size="sm"
            options={[{ value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: 'all', label: 'All time' }]} />
          <Button variant="ghost" size="sm" onClick={q.retry} loading={q.loading}>Refresh</Button>
        </div>

        {q.error ? (
          <ErrorState message={q.error} onRetry={q.retry} />
        ) : rows === null ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Activity size={28} />} title="No syncs in this period" hint="Try a longer period." />
        ) : (
          <div className={`space-y-6 ${q.loading ? 'opacity-60' : ''}`} aria-busy={q.loading}>
            {stats && (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Syncs', value: stats.totalSyncs.toLocaleString(), sub: `${stats.activeDays} days with a sync` },
                  { label: 'Succeeded', value: `${stats.successRate}%`, sub: `${stats.successCount.toLocaleString()} syncs` },
                  { label: 'Records uploaded', value: stats.totalRecords.toLocaleString(), sub: `about ${Math.round(stats.totalRecords / Math.max(stats.activeDays, 1)).toLocaleString()} a day` },
                  { label: 'Failed', value: stats.errorCount.toLocaleString(), sub: `${stats.partialCount} partial`, danger: stats.errorCount > 0 },
                ].map(s => (
                  <div key={s.label} className={`rounded-xl p-3.5 ${s.danger ? 'bg-danger-soft' : 'bg-sunken'}`}>
                    <dt className="text-xs font-medium text-subtle">{s.label}</dt>
                    <dd className={`text-2xl font-bold tabular-nums ${s.danger ? 'text-danger' : 'text-fg'}`}>{s.value}</dd>
                    <dd className="text-[11px] text-subtle">{s.sub}</dd>
                  </div>
                ))}
              </dl>
            )}

            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-fg">Sync calendar</h3>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-subtle">
                  {[['var(--surface-sunken)', 'No sync'], [intensity('var(--success)', 0.8), 'Succeeded'], [intensity('var(--warning)', 0.8), 'Partial'], [intensity('var(--danger)', 0.8), 'Failed']].map(([c, l]) => (
                    <span key={l} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm ring-1 ring-line" style={{ background: c }} aria-hidden="true" />{l}</span>
                  ))}
                  <span>Darker means more syncs</span>
                </div>
              </div>
              <div className="overflow-x-auto pb-1">
                <div className="flex min-w-fit gap-1">
                  <div className="mr-1 mt-5 flex flex-col gap-1" aria-hidden="true">
                    {DOW.map(d => <div key={d} className="flex h-[14px] w-6 items-center text-[9px] text-subtle">{d}</div>)}
                  </div>
                  {calendarWeeks.map((week, wi) => {
                    const firstDay = new Date(`${week[0].date}T12:00:00`)
                    return (
                      <div key={wi} className="flex flex-col gap-1">
                        <div className="flex h-4 items-end pb-0.5 text-[9px] text-subtle">{firstDay.getDate() <= 7 ? format(firstDay, 'MMM') : ''}</div>
                        {week.map(({ date, rows: dayRows, inRange }) => {
                          const total = dayRows.reduce((s, r) => s + (r.records_synced || 0), 0)
                          const tip = dayRows.length
                            ? `${date}: ${dayRows.length} syncs, ${total.toLocaleString()} records, ${dayRows.filter(r => r.status === 'error').length} failed`
                            : `${date}: no sync`
                          return <div key={date} title={tip} className="h-[14px] w-[14px] rounded-[3px]"
                            style={{ background: inRange ? syncCellColor(dayRows, maxPerDay) : 'transparent' }} />
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-fg">Daily sync activity</h3>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={trendData} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid {...gridProps} vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={axisLine} interval="preserveStartEnd" minTickGap={24}
                    tickFormatter={d => { try { return format(parseISO(d), 'MMM d') } catch { return d } }} />
                  <YAxis yAxisId="records" tick={axisTick} tickLine={false} axisLine={false} width={44} />
                  <YAxis yAxisId="syncs" orientation="right" tick={axisTick} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                  <Tooltip {...tooltipProps}
                    formatter={(v, name) => [Number(v).toLocaleString(), name === 'records' ? 'Records' : name === 'syncs' ? 'Syncs' : 'Failed']}
                    labelFormatter={d => { try { return format(parseISO(d as string), 'MMM d, yyyy') } catch { return String(d) } }} />
                  <Legend wrapperStyle={legendStyle} formatter={v => (v === 'records' ? 'Records' : v === 'syncs' ? 'Syncs' : 'Failed')} />
                  <Bar yAxisId="records" dataKey="records" name="records" fill={C.violet} opacity={0.75} radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={20} />
                  {trendData.some(d => d.errors > 0) && (
                    <Bar yAxisId="syncs" dataKey="errors" name="errors" fill={C.red} radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={12} />
                  )}
                  <Line yAxisId="syncs" type="monotone" dataKey="syncs" name="syncs" stroke={C.green} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold text-fg">Latest syncs</h3>
              <TableWrap>
                <THead><tr><Th>Time</Th><Th>Result</Th><Th align="right">Records</Th></tr></THead>
                <tbody>
                  {recentRows.map((r, i) => {
                    const st = SYNC_STATUS[r.status as SyncStatusKey]
                    return (
                      <Tr key={i}>
                        <Td className="whitespace-nowrap tabular-nums">{format(parseISO(r.synced_at), 'MMM d, yyyy HH:mm:ss')}</Td>
                        <Td>
                          <Badge tone={st?.tone ?? 'neutral'} title={r.error_message || undefined}>{st?.label ?? r.status}</Badge>
                          {r.error_message && <p className="mt-1 max-w-md break-words text-xs text-subtle">{r.error_message}</p>}
                        </Td>
                        <Td align="right" className="tabular-nums">{(r.records_synced || 0).toLocaleString()}</Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </TableWrap>
              {rows.length > 20 && <p className="mt-2 text-center text-xs text-subtle">Showing the 20 most recent of {rows.length.toLocaleString()}</p>}
            </section>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function ParticipantDrawer({
  p, health, latest, interval, studyId, canEdit, canManage, suspended,
  onClose, onStatus, onDelete, onSyncHistory, onPermissionHistory,
}: {
  p: Participant
  health: SyncHealth
  latest: SyncRow | undefined
  interval: number
  studyId: string
  canEdit: boolean
  canManage: boolean
  /** A dialog is open on top: release focus to it */
  suspended: boolean
  onClose: () => void
  onStatus: (next: 'active' | 'withdrawn') => void
  onDelete: () => void
  onSyncHistory: () => void
  onPermissionHistory: () => void
}) {
  const panelRef = useRef<HTMLElement>(null)
  useDialogFocus(panelRef, onClose, !suspended)
  const paths = studyPaths(studyId)
  const name = participantName(p)
  const perms = Object.entries(p.permissions || {})
  const di = p.device_info || {}
  const latestSt = latest ? SYNC_STATUS[latest.status as SyncStatusKey] : undefined

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-[var(--overlay)]" aria-hidden="true" onClick={onClose} />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="participant-detail-title"
        className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl">
        <div className="flex items-start gap-3 border-b border-line p-5">
          <div className="min-w-0 flex-1">
            <h2 id="participant-detail-title" className="truncate text-lg font-bold text-fg">{name}</h2>
            <p className="break-all font-mono text-xs text-subtle">{p.device_id}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={p.status === 'active' ? 'green' : 'neutral'}>{p.status === 'active' ? 'Active' : 'Withdrawn'}</Badge>
              {p.status === 'active' && <Badge tone={health.tone} title={health.description}>{health.label}</Badge>}
            </div>
          </div>
          <button type="button" onClick={onClose} className={iconBtn} aria-label="Close participant details"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <DescriptionList items={[
            { label: 'Last sync', value: <span title={p.last_sync_at ? format(new Date(p.last_sync_at), 'PPpp') : undefined}>{relative(p.last_sync_at)}</span> },
            { label: 'Last sync result', value: latestSt ? <><Badge tone={latestSt.tone}>{latestSt.label}</Badge>{latest?.error_message && <span className="mt-1 block text-xs text-subtle">{latest.error_message}</span>}</> : '—' },
            { label: 'Sync health', value: p.status === 'active' ? health.description : 'Withdrawn: the phone does not collect or upload.' },
            { label: 'Expected sync', value: `Every ${Math.max(interval, 15)} min` },
            { label: 'Joined', value: format(new Date(p.enrolled_at), 'PP p') },
            { label: 'Consent', value: p.consent_version ? <>Version <span className="font-mono">{p.consent_version}</span>{p.consent_at && <> · {format(new Date(p.consent_at), 'PP')}</>}</> : 'Not recorded by this app version' },
            { label: 'Device', value: deviceSummary(p) },
            ...(di.pending_records ? [{ label: 'Waiting to upload', value: `${Number(di.pending_records).toLocaleString()} records` }] : []),
            ...(p.merged_into ? [{ label: 'Merge', value: p.merge_adopted_at ? 'Merged; the phone has switched over' : 'Merged; waiting for the phone to switch over' }] : []),
          ]} />

          <section>
            <h3 className="text-sm font-semibold text-fg">Permissions</h3>
            {perms.length === 0 ? (
              <p className="mt-1 text-sm text-subtle">The phone has not reported its permissions yet.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {perms.map(([k, v]) => (
                  <li key={k}><Badge tone={v ? 'green' : 'red'}>{permissionLabel(k)}{v ? '' : ' (off)'}</Badge></li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid grid-cols-2 gap-2">
            <ButtonLink href={`${paths.data}?participant=${p.id}`} variant="secondary" size="sm"><ChartColumn size={14} aria-hidden="true" /> Raw data</ButtonLink>
            <ButtonLink href={`${paths.surveys}?participant=${p.id}`} variant="secondary" size="sm"><MessageSquare size={14} aria-hidden="true" /> Survey answers</ButtonLink>
            <Button variant="secondary" size="sm" onClick={onSyncHistory}><Activity size={14} aria-hidden="true" /> Sync history</Button>
            <Button variant="secondary" size="sm" onClick={onPermissionHistory}><ShieldCheck size={14} aria-hidden="true" /> Permission history</Button>
          </section>

          {(canEdit || canManage) && (
            <section className="space-y-2 border-t border-line pt-5">
              {canEdit && (p.status === 'active' ? (
                <Button variant="secondary" onClick={() => onStatus('withdrawn')} className="w-full">
                  <UserMinus size={14} aria-hidden="true" /> Withdraw participant…
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => onStatus('active')} className="w-full">
                  <RotateCcw size={14} aria-hidden="true" /> Reactivate participant…
                </Button>
              ))}
              {canManage && (
                <Button variant="danger-ghost" onClick={onDelete} className="w-full">
                  <Trash2 size={14} aria-hidden="true" /> Delete participant…
                </Button>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function ParticipantsContent() {
  const { id: studyId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])
  const access = useStudyAccess(studyId)
  const paths = studyPaths(studyId)

  const [notice, setNotice] = useState<NoticeState>(null)
  const [search, setSearch] = useState('')
  const [pageState, setPageState] = useState({ key: '', page: 0 })
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  const [savingLabel, setSavingLabel] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Participant | null>(null)
  const [syncTarget, setSyncTarget] = useState<Participant | null>(null)
  const [permTarget, setPermTarget] = useState<Participant | null>(null)
  const [statusTarget, setStatusTarget] = useState<{ p: Participant; next: 'active' | 'withdrawn' } | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  const q = useAsync(`participants:${studyId}`, async () => {
    const [participants, studyRes, logs] = await Promise.all([
      fetchAll<Participant>((from, to) => supabase.from('participants').select('*')
        .eq('study_id', studyId).order('enrolled_at', { ascending: false }).order('id').range(from, to)),
      supabase.from('studies').select('sync_interval_minutes').eq('id', studyId).maybeSingle(),
      scopedSelect(supabase, 'sync_log', { studyId, participant: 'all' }, 'synced_at, status, records_synced, participant_id, error_message')
        .order('synced_at', { ascending: false }).limit(3000),
    ])
    const latest: Record<string, SyncRow> = {}
    for (const log of must(logs) as unknown as SyncRow[]) if (!latest[log.participant_id]) latest[log.participant_id] = log
    const interval = Number(must(studyRes)?.sync_interval_minutes)
    return { participants, latest, interval: Number.isFinite(interval) && interval > 0 ? interval : 30, loadedAt: Date.now() }
  })
  const d = q.data ?? q.previous
  const participants = useMemo(() => d?.participants ?? [], [d])
  const interval = d?.interval ?? 30

  // URL state: ?filter= (from the overview) and ?participant= (opens the drawer)
  const rawFilter = searchParams.get('filter')
  const filter: FilterKey = rawFilter && FILTER_KEYS.has(rawFilter) ? rawFilter as FilterKey : 'all'
  const openId = searchParams.get('participant')

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === null) params.delete(key)
    else params.set(key, value)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const rows = useMemo(() => participants.map(p => {
    const health = syncHealth(p, interval, d?.loadedAt ?? 0)
    return {
      p,
      health,
      latest: d?.latest[p.id],
      permIssue: p.status === 'active' && hasPermissionIssue(p.permissions),
      permText: permissionSummary(p.permissions),
    }
  }), [participants, interval, d])

  const needsAttention = (r: typeof rows[number]) =>
    r.p.status === 'active' && (isSyncOverdue(r.health) || r.permIssue || r.latest?.status === 'error')
  const matches: Record<FilterKey, (r: typeof rows[number]) => boolean> = {
    all: () => true,
    issues: needsAttention,
    active: r => r.p.status === 'active',
    withdrawn: r => r.p.status === 'withdrawn',
    stale: r => isSyncOverdue(r.health),
    silent: r => r.health.key === 'silent',
    perm_missing: r => r.permIssue,
  }
  const counts = Object.fromEntries(FILTERS.map(f => [f.value, rows.filter(matches[f.value]).length])) as Record<FilterKey, number>
  const term = search.trim().toLowerCase()
  const filtered = rows.filter(r => matches[filter](r) &&
    (!term || participantName(r.p).toLowerCase().includes(term) || r.p.device_id.toLowerCase().includes(term)))

  const pageKey = `${filter}|${term}`
  const page = pageState.key === pageKey ? Math.min(pageState.page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1)) : 0
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const open = openId ? rows.find(r => r.p.id === openId) : undefined
  const anyModal = !!(deleteTarget || syncTarget || permTarget || statusTarget)

  // PostgREST reports an RLS-filtered UPDATE as success with zero rows, so ask
  // for the updated ids back to tell "saved" from "not allowed".
  async function updateParticipant(id: string, patch: Partial<Participant>): Promise<string | null> {
    const { data, error } = await supabase.from('participants').update(patch).eq('id', id).select('id')
    if (error) return errorText(error)
    if (!data?.length) return 'You do not have permission to edit participants in this study.'
    return null
  }

  async function saveLabel() {
    if (!editing) return
    setSavingLabel(true)
    const problem = await updateParticipant(editing.id, { label: editing.value.trim() || null })
    setSavingLabel(false)
    if (problem) { setNotice({ tone: 'error', text: `Could not save the label: ${problem}` }); return }
    setEditing(null)
    q.retry()
  }

  async function confirmStatus() {
    if (!statusTarget) return
    setStatusBusy(true); setStatusError(null)
    const problem = await updateParticipant(statusTarget.p.id, { status: statusTarget.next })
    setStatusBusy(false)
    if (problem) { setStatusError(problem); return }
    setNotice({ tone: 'success', text: `${participantName(statusTarget.p)} ${statusTarget.next === 'withdrawn' ? 'was withdrawn' : 'is active again'}.` })
    setStatusTarget(null)
    q.retry()
  }

  function exportList() {
    downloadCsv(rows.map(({ p, health, latest }) => ({
      participant_id: p.id,
      device_id: p.device_id,
      label: p.label ?? '',
      status: p.status,
      enrolled_at: p.enrolled_at,
      last_sync_at: p.last_sync_at ?? '',
      sync_health: health.label,
      last_sync_result: latest?.status ?? '',
      permissions_off: (missingPermissions(p.permissions) ?? ['not reported']).map(k => k === 'not reported' ? k : permissionLabel(k)).join('; '),
      device: deviceSummary(p),
      consent_version: p.consent_version ?? '',
    })), `participants_${localDay(new Date())}`)
  }

  // ── Pieces shared by the table and the cards ─────────────────────────────
  // Plain render helpers (not components), so the label input keeps focus while typing
  function nameCell(p: Participant) {
    const name = participantName(p)
    if (editing?.id === p.id) {
      return (
        <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); void saveLabel() }}>
          <input value={editing.value} autoFocus aria-label={`Label for ${p.device_id}`} placeholder="Label"
            onChange={e => setEditing({ id: p.id, value: e.target.value })}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(null) } }}
            className="h-8 min-w-0 flex-1 rounded-md border border-accent bg-surface px-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent/25" />
          <button type="submit" disabled={savingLabel} className={`${iconBtn} text-accent`} aria-label="Save label"><Check size={15} /></button>
          <button type="button" onClick={() => setEditing(null)} className={iconBtn} aria-label="Cancel renaming"><X size={15} /></button>
        </form>
      )
    }
    return (
      <div className="flex min-w-0 items-center gap-1">
        <button type="button" onClick={() => setParam('participant', p.id)} aria-label={`Open details for ${name}`}
          className="flex min-w-0 items-center gap-2.5 rounded-lg text-left hover:text-accent">
          <span className="min-w-0">
            <span className="block truncate font-semibold text-fg">{name}</span>
            {p.label && <span className="block truncate font-mono text-[11px] text-subtle">{p.device_id}</span>}
          </span>
        </button>
        {access.canEdit && (
          <button type="button" onClick={() => setEditing({ id: p.id, value: p.label || '' })} className={`${iconBtn} shrink-0`} aria-label={`Rename ${name}`}>
            <Pencil size={13} />
          </button>
        )}
      </div>
    )
  }

  function rowActions(p: Participant) {
    const name = participantName(p)
    return (
      <div className="flex justify-end">
        <ActionMenu label={`Actions for ${name}`} items={[
          { label: 'Raw data', icon: <ChartColumn />, href: `${paths.data}?participant=${p.id}` },
          { label: 'Survey answers', icon: <MessageSquare />, href: `${paths.surveys}?participant=${p.id}` },
          { label: 'Sync history', icon: <Activity />, onSelect: () => setSyncTarget(p) },
          { label: 'Permission history', icon: <ShieldCheck />, onSelect: () => setPermTarget(p) },
          access.canManage && { label: 'Delete participant…', icon: <Trash2 />, danger: true, onSelect: () => setDeleteTarget(p) },
        ]} />
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const header = (
    <PageHeader title="Participants"
      description={d ? `${participants.length.toLocaleString()} enrolled · ${counts.active.toLocaleString()} active · syncs expected every ${Math.max(interval, 15)} min` : 'People enrolled in this study from the mobile app.'}
      actions={d && participants.length > 0 ? (
        <Button variant="secondary" size="sm" onClick={exportList}><Download size={13} aria-hidden="true" /> Export list</Button>
      ) : undefined} />
  )

  if (q.error && !d) return <>{header}<ErrorState title="Could not load participants" message={q.error} onRetry={q.retry} /></>
  if (!d) return <>{header}<SkeletonRows rows={6} /></>

  return (
    <div className="space-y-5">
      {header}

      {!access.loading && !access.canEdit && <ReadOnlyBanner />}
      <Notice notice={notice} onClose={() => setNotice(null)} />
      {q.error && <Notice notice={{ tone: 'error', text: `Could not refresh the list: ${q.error}` }} />}

      {participants.length > 0 && access.canEdit && <MergeSuggestions participants={participants} onMerged={q.retry} />}
      <PinLockouts studyId={studyId} canEdit={access.canEdit} />
      <MergeAudit studyId={studyId} names={Object.fromEntries(participants.map(p => [p.id, participantName(p)]))} />

      {participants.length === 0 ? (
        <EmptyState icon={<Smartphone size={28} />} title="No participants yet"
          hint="Participants appear here when they join from the mobile app." />
      ) : (
        <>
          <div className="space-y-3">
            <div className="relative max-w-sm">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden="true" />
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search participants"
                placeholder="Search name or device ID…"
                className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-3 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25" />
            </div>
            <FilterPills label="Show participants" value={filter} onChange={v => setParam('filter', v === 'all' ? null : v)}
              options={FILTERS.map(f => ({ value: f.value, label: f.label, count: counts[f.value] }))} />
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={<Search size={24} />} title="No matches" hint="Try a different search or filter.">
              <Button variant="secondary" size="sm" onClick={() => { setSearch(''); setParam('filter', null) }}>Show everyone</Button>
            </EmptyState>
          ) : (
            <div className={q.loading ? 'opacity-70 transition-opacity' : ''} aria-busy={q.loading}>
              {/* Table from md up (first in the DOM) */}
              <div className="hidden md:block">
                <TableWrap>
                  <THead>
                    <tr>
                      <Th>Participant</Th>
                      <Th className="hidden xl:table-cell">Device</Th>
                      <Th>Status</Th>
                      <Th>Last sync</Th>
                      <Th>Sync health</Th>
                      <Th>Permissions</Th>
                      <Th align="right"><span className="sr-only">Actions</span></Th>
                    </tr>
                  </THead>
                  <tbody>
                    {visible.map(({ p, health, latest, permText }) => (
                      <Tr key={p.id} className={p.status === 'withdrawn' ? 'opacity-75' : ''}>
                        <Td className="max-w-64">{nameCell(p)}</Td>
                        <Td className="hidden max-w-56 truncate text-muted xl:table-cell" title={deviceSummary(p)}>{deviceSummary(p)}</Td>
                        <Td><Badge tone={p.status === 'active' ? 'green' : 'neutral'}>{p.status === 'active' ? 'Active' : 'Withdrawn'}</Badge></Td>
                        <Td className="whitespace-nowrap text-muted" title={p.last_sync_at ? format(new Date(p.last_sync_at), 'PPpp') : undefined}>{relative(p.last_sync_at)}</Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            {p.status === 'active' && <Badge tone={health.tone} title={health.description}>{health.label}</Badge>}
                            {latest && latest.status !== 'success' && (
                              <Badge tone={SYNC_STATUS[latest.status as SyncStatusKey]?.tone ?? 'red'} title={latest.error_message || undefined}>
                                Last sync {SYNC_STATUS[latest.status as SyncStatusKey]?.label.toLowerCase() ?? latest.status}
                              </Badge>
                            )}
                            {p.status === 'withdrawn' && <span className="text-subtle">—</span>}
                          </div>
                        </Td>
                        <Td>
                          {p.status !== 'active' ? <span className="text-subtle">—</span>
                            : permText ? <Badge tone="red" title={(missingPermissions(p.permissions) ?? []).map(permissionLabel).join(', ') || undefined}>{permText}</Badge>
                              : <Badge tone="green">All on</Badge>}
                        </Td>
                        <Td align="right">{rowActions(p)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>

              {/* Cards on phones */}
              <ul className="space-y-2 md:hidden">
                {visible.map(({ p, health, latest, permText }) => (
                  <li key={p.id} className={`rounded-lg border border-line bg-surface p-4 ${p.status === 'withdrawn' ? 'opacity-75' : ''}`}>
                    {nameCell(p)}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone={p.status === 'active' ? 'green' : 'neutral'}>{p.status === 'active' ? 'Active' : 'Withdrawn'}</Badge>
                      {p.status === 'active' && <Badge tone={health.tone}>{health.label}</Badge>}
                      {latest && latest.status !== 'success' && <Badge tone="red">Last sync {latest.status}</Badge>}
                      {p.status === 'active' && permText && <Badge tone="red">{permText}</Badge>}
                    </div>
                    <p className="mt-2 text-xs text-subtle">{deviceSummary(p)} · synced {relative(p.last_sync_at).toLowerCase()}</p>
                    <div className="mt-2 border-t border-line pt-2">{rowActions(p)}</div>
                  </li>
                ))}
              </ul>

              {filtered.length > PAGE_SIZE && (
                <Pagination className="mt-3" page={page} pageSize={PAGE_SIZE} total={filtered.length}
                  onPage={next => setPageState({ key: pageKey, page: next })} />
              )}
            </div>
          )}
        </>
      )}

      {open && (
        <ParticipantDrawer p={open.p} health={open.health} latest={open.latest} interval={interval} studyId={studyId}
          canEdit={access.canEdit} canManage={access.canManage} suspended={anyModal}
          onClose={() => setParam('participant', null)}
          onStatus={next => { setStatusError(null); setStatusTarget({ p: open.p, next }) }}
          onDelete={() => setDeleteTarget(open.p)}
          onSyncHistory={() => setSyncTarget(open.p)}
          onPermissionHistory={() => setPermTarget(open.p)} />
      )}

      {syncTarget && <SyncHistoryModal participant={syncTarget} onClose={() => setSyncTarget(null)} />}
      {permTarget && <PermissionHistoryModal participant={permTarget} onClose={() => setPermTarget(null)} />}
      {deleteTarget && (
        <DeleteParticipantModal
          participant={{ id: deleteTarget.id, name: participantName(deleteTarget), deviceId: deleteTarget.device_id }}
          mergedChildren={participants.filter(x => x.merged_into === deleteTarget.id).map(participantName)}
          onClose={() => setDeleteTarget(null)}
          onDeleted={summary => {
            setNotice({ tone: 'success', text: summary })
            if (openId === deleteTarget.id) setParam('participant', null)
            q.retry()
          }}
        />
      )}
      <ConfirmDialog
        open={!!statusTarget}
        title={statusTarget?.next === 'withdrawn' ? `Withdraw ${statusTarget ? participantName(statusTarget.p) : ''}?` : `Reactivate ${statusTarget ? participantName(statusTarget.p) : ''}?`}
        body={statusTarget?.next === 'withdrawn'
          ? 'The phone stops collecting and uploading. Data already received is kept.'
          : 'The phone starts collecting and uploading again at its next sync.'}
        confirmLabel={statusTarget?.next === 'withdrawn' ? 'Withdraw' : 'Reactivate'}
        tone={statusTarget?.next === 'withdrawn' ? 'danger' : 'default'}
        busy={statusBusy}
        error={statusError}
        onConfirm={confirmStatus}
        onCancel={() => { if (!statusBusy) setStatusTarget(null) }}
      />
    </div>
  )
}

export default function ParticipantsPage() {
  return (
    <Suspense>
      <ParticipantsContent />
    </Suspense>
  )
}
