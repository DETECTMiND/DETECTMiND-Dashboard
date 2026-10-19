'use client'

import { createClient } from '@/lib/supabase-browser'
import { useMemo, useState, Suspense, lazy } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation'
import { BarChart2, Database, Download, Table2, Users } from 'lucide-react'
import {
  asRows,
  type AppUsageRow, type BatteryRow, type CallSmsRow, type DataRow, type EsmResponseRow,
  type LightRow, type LocationRow, type NotificationRow, type ScreenStateRow,
} from '@/components/charts/types'
import {
  Button, Card, EmptyState, ErrorState, FilterPills, Notice, Pagination, SectionHeader, SegmentedControl,
  Skeleton, SkeletonRows, TableWrap, THead, Th, Td, Tr, type NoticeState,
} from '@/components/ui'
import { Avatar, ParticipantPicker, participantName, type Participant } from '@/components/participant-ui'
import { JsonCell, columnLabel, formatCellValue } from '@/components/data/cells'
import { scopedSelect, stripScope, type DataScope } from '@/components/data/scope'
import { must, mustCount, useAsync } from '@/components/data/use-async'
import { DATA_TABLES } from '@/lib/sensors'
import { downloadCsv, fetchAll, localDay, safeFileName } from '@/lib/csv'
import { studyPaths } from '@/lib/nav'

// Lazy-load chart components so they don't bloat the initial bundle
const BatteryChart       = lazy(() => import('@/components/charts/BatteryChart'))
const LightChart         = lazy(() => import('@/components/charts/LightChart'))
const ScreenStateChart   = lazy(() => import('@/components/charts/ScreenStateChart'))
const NotificationsChart = lazy(() => import('@/components/charts/NotificationsChart'))
const AppUsageChart      = lazy(() => import('@/components/charts/AppUsageChart'))
const CallsSmsChart      = lazy(() => import('@/components/charts/CallsSmsChart'))
const LocationChart      = lazy(() => import('@/components/charts/LocationChart'))
const EsmChart           = lazy(() => import('@/components/charts/EsmChart'))

const CHART_TABLES = new Set([
  'data_app_usage', 'data_notifications', 'data_battery', 'data_calls', 'data_sms',
  'data_esm_responses', 'data_location', 'data_light', 'data_screen_state',
])
const JSON_COLUMNS = new Set(['responses', 'interaction_data', 'device_info'])
const HIDDEN_COLUMNS = new Set(['id', 'participant_id', 'client_uuid', 'participants'])
const CHART_FETCH_LIMIT = 2000

type ChartRange = '7d' | '30d' | '90d' | 'all'
const CHART_RANGES: { value: ChartRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All' },
]

function chartRangeSince(range: ChartRange): string | null {
  if (range === 'all') return null
  const d = new Date()
  d.setDate(d.getDate() - (range === '7d' ? 7 : range === '30d' ? 30 : 90))
  return d.toISOString()
}

type SortDir = 'asc' | 'desc'
type ViewMode = 'table' | 'chart'

// ─── Gesture summaries ────────────────────────────────────────────────────────
// data_gestures keeps details in interaction_data JSON. For the feed-scroll
// ('scroll') and pager ('page_swipe', reels/Shorts/stories) types, surface the
// useful fields as two readable, display-only columns.
const GESTURE_DERIVED_COLS = ['_direction', '_detail'] as const
const DERIVED = new Set<string>(GESTURE_DERIVED_COLS)

function containerShort(id: unknown): string | null {
  if (typeof id !== 'string' || !id) return null
  const i = id.indexOf(':id/')
  return i >= 0 ? id.slice(i + 4) : id
}

function gestureDerived(col: string, row: Record<string, unknown>): string {
  const d = (row.interaction_data && typeof row.interaction_data === 'object'
    ? row.interaction_data : {}) as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  if (col === '_direction') return typeof d.direction === 'string' ? d.direction : '—'
  const parts: string[] = []
  if (row.interaction_type === 'page_swipe') {
    const from = n(d.index_from), to = n(d.index_to), dwell = n(d.dwell_ms)
    if (from !== null && to !== null) parts.push(`item ${from} → ${to}`)
    if (dwell !== null) parts.push(`dwell ${(dwell / 1000).toFixed(1)}s`)
  } else if (row.interaction_type === 'scroll') {
    const dist = n(d.distance_dp), net = n(d.net_dp), items = n(d.items_passed), dur = n(d.duration_ms)
    if (dist !== null) parts.push(`${Math.round(dist)} dp${net !== null && net !== dist ? ` (net ${Math.round(net)})` : ''}`)
    if (items !== null) parts.push(`${items} item${items === 1 ? '' : 's'}`)
    if (dur !== null) parts.push(`${(dur / 1000).toFixed(1)}s`)
  } else {
    return '—'
  }
  const c = containerShort(d.container_id)
  if (c) parts.push(c)
  return parts.length ? parts.join(' · ') : '—'
}

// ─── Chart dispatcher ─────────────────────────────────────────────────────────

function ChartView({ table, data, participants, showParticipant }: {
  table: string; data: DataRow[]; participants: Participant[]; showParticipant: boolean
}) {
  const props = { participants, showParticipant }
  switch (table) {
    case 'data_battery':       return <BatteryChart {...props} data={asRows<BatteryRow>(data)} />
    case 'data_light':         return <LightChart {...props} data={asRows<LightRow>(data)} />
    case 'data_screen_state':  return <ScreenStateChart {...props} data={asRows<ScreenStateRow>(data)} />
    case 'data_notifications': return <NotificationsChart {...props} data={asRows<NotificationRow>(data)} />
    case 'data_app_usage':     return <AppUsageChart {...props} data={asRows<AppUsageRow>(data)} />
    case 'data_calls':         return <CallsSmsChart {...props} data={asRows<CallSmsRow>(data)} sensorKey="data_calls" />
    case 'data_sms':           return <CallsSmsChart {...props} data={asRows<CallSmsRow>(data)} sensorKey="data_sms" />
    case 'data_location':      return <LocationChart {...props} data={asRows<LocationRow>(data)} />
    case 'data_esm_responses': return <EsmChart {...props} data={asRows<EsmResponseRow>(data)} />
    default:                   return <p className="py-12 text-center text-sm text-subtle">No chart is available for this data.</p>
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

function RawDataInner() {
  const { id: studyId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])

  const [tableChoice, setTableChoice] = useState<string | null>(null)
  const [viewChoice, setViewMode] = useState<ViewMode>('table')
  const [chartRange, setChartRange] = useState<ChartRange>('30d')
  const [sort, setSort] = useState<{ col: string | null; dir: SortDir }>({ col: null, dir: 'desc' })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<NoticeState>(null)

  // Participants + enabled sensors
  const meta = useAsync(`meta:${studyId}`, async () => {
    const [participants, configs] = await Promise.all([
      fetchAll<Participant>((from, to) => supabase.from('participants').select('id, label, device_id')
        .eq('study_id', studyId).order('enrolled_at', { ascending: false }).order('id').range(from, to)),
      supabase.from('sensor_configs').select('sensor_type').eq('study_id', studyId).eq('enabled', true),
    ])
    const enabled = new Set(must(configs).map((r: { sensor_type: string }) => r.sensor_type))
    return { participants, enabled }
  })
  const participants = useMemo(() => meta.data?.participants ?? [], [meta.data])
  const pMap = useMemo(() => Object.fromEntries(participants.map(p => [p.id, p])), [participants])
  const hasParticipants = participants.length > 0

  // ?participant= drives the filter (deep links from Participants keep working)
  const requested = searchParams.get('participant')
  const participant = requested && (!meta.data || pMap[requested]) ? requested : 'all'
  const scope: DataScope = { studyId, participant }
  const scopeKey = `${studyId}|${participant}`

  // Record counts per table (no requests at all when nobody has enrolled)
  const counts = useAsync(meta.data ? `counts:${scopeKey}` : null, async () => {
    if (!meta.data?.participants.length) return Object.fromEntries(DATA_TABLES.map(t => [t.table, 0])) as Record<string, number>
    const results = await Promise.all(DATA_TABLES.map(t =>
      scopedSelect(supabase, t.table, scope, 'id', { count: 'exact', head: true }).then(mustCount)))
    return Object.fromEntries(DATA_TABLES.map((t, i) => [t.table, results[i]])) as Record<string, number>
  })
  const countMap = counts.data ?? counts.previous

  // Tables: enabled sensors, survey responses, and anything that already has data
  const visibleTables = useMemo(() => {
    const enabled = meta.data?.enabled
    if (!enabled || enabled.size === 0) return DATA_TABLES
    return DATA_TABLES.filter(t => !t.sensor || enabled.has(t.sensor) || (countMap?.[t.table] ?? 0) > 0)
  }, [meta.data, countMap])
  const table = visibleTables.find(t => t.table === tableChoice) ?? visibleTables[0]
  const canChart = CHART_TABLES.has(table.table)
  const viewMode: ViewMode = canChart ? viewChoice : 'table'
  const sortCol = sort.col ?? table.timeCol
  const showParticipantCol = participant === 'all'

  // Current page of rows (count comes back with the same request)
  const rowsKey = hasParticipants ? `rows:${scopeKey}|${table.table}|${sortCol}|${sort.dir}|${page}|${pageSize}` : null
  const rows = useAsync(viewMode === 'table' ? rowsKey : null, async () => {
    const from = page * pageSize
    const res = await scopedSelect(supabase, table.table, scope, '*', { count: 'exact' })
      .order(sortCol, { ascending: sort.dir === 'asc', nullsFirst: false })
      .order('id', { ascending: sort.dir === 'asc' })
      .range(from, from + pageSize - 1)
    return { table: table.table, rows: stripScope(must(res) as DataRow[]), total: res.count ?? 0 }
  })

  // Chart data: the latest CHART_FETCH_LIMIT rows in the range, oldest first
  const chartKey = hasParticipants && viewMode === 'chart' ? `chart:${scopeKey}|${table.table}|${chartRange}` : null
  const chart = useAsync(chartKey, async () => {
    const since = chartRangeSince(chartRange)
    let q = scopedSelect(supabase, table.table, scope, '*')
    if (since) q = q.gte(table.timeCol, since)
    const res = await q.order(table.timeCol, { ascending: false }).order('id', { ascending: false }).limit(CHART_FETCH_LIMIT)
    const list = stripScope(must(res) as DataRow[]).reverse()
    return { rows: list, truncated: list.length >= CHART_FETCH_LIMIT }
  })

  function changeParticipant(id: string) {
    setPage(0)
    const params = new URLSearchParams(searchParams.toString())
    if (id === 'all') params.delete('participant')
    else params.set('participant', id)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function changeTable(next: string) {
    setTableChoice(next)
    setSort({ col: null, dir: 'desc' })
    setPage(0)
  }

  function toggleSort(col: string) {
    setSort(s => (s.col ?? table.timeCol) === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })
    setPage(0)
  }

  const who = participant === 'all' ? 'all' : safeFileName(pMap[participant] ? participantName(pMap[participant]) : participant)
  const fileBase = `${table.table.replace(/^data_/, '')}_${who}_${localDay(new Date())}`

  async function exportAll() {
    setExporting(true)
    setNotice(null)
    try {
      const all = await fetchAll<DataRow>((from, to) => scopedSelect(supabase, table.table, scope, '*')
        .order(sortCol, { ascending: sort.dir === 'asc', nullsFirst: false })
        .order('id', { ascending: sort.dir === 'asc' })
        .range(from, to))
      const clean = stripScope(all)
      if (clean.length === 0) setNotice({ tone: 'info', text: 'There are no rows to export.' })
      else {
        downloadCsv(clean, fileBase)
        setNotice({ tone: 'success', text: `Exported ${clean.length.toLocaleString()} rows.` })
      }
    } catch (e) {
      setNotice({ tone: 'error', text: `Export failed: ${e instanceof Error ? e.message : 'unknown error'}` })
    } finally {
      setExporting(false)
    }
  }

  // While the next page loads, keep showing the current one (same table only)
  const rowsData = rows.data ?? (rows.previous?.table === table.table ? rows.previous : undefined)
  const pageRows = rowsData?.rows ?? []
  const total = rowsData?.total ?? countMap?.[table.table] ?? 0
  const baseCols = pageRows.length > 0 ? Object.keys(pageRows[0]).filter(k => !HIDDEN_COLUMNS.has(k)) : []
  // Gestures: put the readable summary columns just before the raw JSON.
  const cols: string[] = table.table === 'data_gestures' && baseCols.includes('interaction_data')
    ? [...baseCols.filter(k => k !== 'interaction_data'), ...GESTURE_DERIVED_COLS, 'interaction_data']
    : baseCols
  const emptyHint = participant !== 'all' ? 'Nothing recorded for this participant yet.' : 'Nothing recorded for this sensor yet.'

  // ── Render ────────────────────────────────────────────────────────────────
  if (meta.error) return <ErrorState message={meta.error} onRetry={meta.retry} />

  if (meta.loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="flex gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8 w-24 rounded-full" />)}</div>
        <SkeletonRows rows={8} />
      </div>
    )
  }

  if (!hasParticipants) {
    return (
      <EmptyState icon={<Users size={28} />} title="No participants yet"
        hint="Raw data appears here once participants join from the mobile app and their phones sync." />
    )
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title={table.label}
        description={canChart && viewMode === 'chart' ? 'Charts of the most recent records in the chosen period.' : 'Every record uploaded by the phones, newest first.'}
        actions={<ParticipantPicker participants={participants} value={participant} onChange={changeParticipant} />}
      />

      <FilterPills label="Data table" value={table.table} onChange={changeTable}
        options={visibleTables.map(t => ({ value: t.table, label: t.label, count: countMap ? countMap[t.table] ?? 0 : null }))} />
      {counts.error && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          Could not load record counts: {counts.error}
          <Button variant="ghost" size="sm" onClick={counts.retry}>Try again</Button>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canChart && (
          <SegmentedControl label="View" value={viewMode} onChange={setViewMode} size="sm"
            options={[{ value: 'table', label: 'Table', icon: <Table2 size={13} /> }, { value: 'chart', label: 'Chart', icon: <BarChart2 size={13} /> }]} />
        )}
        {viewMode === 'chart' && (
          <SegmentedControl label="Chart period" value={chartRange} onChange={setChartRange} size="sm" options={CHART_RANGES} />
        )}
        {viewMode === 'chart' && chart.data && chart.data.rows.length > 0 && (
          <span className="text-xs text-subtle">
            {chart.data.truncated
              ? `Showing the latest ${CHART_FETCH_LIMIT.toLocaleString()} records in this period`
              : `${chart.data.rows.length.toLocaleString()} records`}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {viewMode === 'table' && (
            <Button variant="secondary" size="sm" disabled={pageRows.length === 0}
              onClick={() => downloadCsv(pageRows, `${fileBase}_page${page + 1}`)}>
              <Download size={13} aria-hidden="true" /> Export this page
            </Button>
          )}
          <Button size="sm" onClick={exportAll} loading={exporting} disabled={exporting || total === 0}>
            {!exporting && <Download size={13} aria-hidden="true" />}
            {exporting ? 'Exporting…' : `Export all${total ? ` (${total.toLocaleString()})` : ''}`}
          </Button>
        </div>
      </div>

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {viewMode === 'chart' ? (
        <Card>
          {chart.error ? (
            <ErrorState title="Could not load the chart" message={chart.error} onRetry={chart.retry} />
          ) : chart.loading || !chart.data ? (
            <div role="status" aria-label="Loading chart" className="space-y-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : chart.data.rows.length === 0 ? (
            <EmptyState icon={<Database size={28} />} title={`No ${table.label.toLowerCase()} data in this period`}
              hint={chartRange === 'all' ? emptyHint : 'Try a longer period.'} />
          ) : (
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <ChartView table={table.table} data={chart.data.rows} participants={participants} showParticipant={showParticipantCol} />
            </Suspense>
          )}
        </Card>
      ) : rows.error ? (
        <ErrorState message={rows.error} onRetry={rows.retry} />
      ) : !rowsData ? (
        <SkeletonRows rows={8} />
      ) : pageRows.length === 0 ? (
        <EmptyState icon={<Database size={28} />} title={`No ${table.label.toLowerCase()} data`} hint={emptyHint} />
      ) : (
        <>
          <div className={rows.loading ? 'opacity-60 transition-opacity' : ''} aria-busy={rows.loading}>
            <TableWrap maxHeight="70vh">
              <THead>
                <tr>
                  {showParticipantCol && <Th>Participant</Th>}
                  {cols.map(col => DERIVED.has(col) || JSON_COLUMNS.has(col)
                    ? <Th key={col}>{columnLabel(col)}</Th>
                    : (
                      <Th key={col} sort={sortCol === col ? sort.dir : null} onSort={() => toggleSort(col)}>
                        {columnLabel(col)}
                      </Th>
                    ))}
                </tr>
              </THead>
              <tbody>
                {pageRows.map((row, i) => {
                  const pid = String(row.participant_id ?? '')
                  const p = pMap[pid]
                  const name = p ? participantName(p) : pid.slice(0, 8)
                  return (
                    <Tr key={String(row.id ?? i)}>
                      {showParticipantCol && (
                        <Td className="whitespace-nowrap">
                          <Link href={`${studyPaths(studyId).participants}?participant=${pid}`} className="flex items-center gap-2 font-medium text-fg hover:text-accent">
                            <Avatar id={pid} name={name} size="sm" />
                            <span className="max-w-32 truncate">{name}</span>
                          </Link>
                        </Td>
                      )}
                      {cols.map(k => {
                        if (JSON_COLUMNS.has(k)) return <Td key={k}><JsonCell value={row[k]} label={columnLabel(k)} /></Td>
                        const display = DERIVED.has(k) ? gestureDerived(k, row) : formatCellValue(k, row[k])
                        const empty = display === '—'
                        return (
                          <Td key={k} title={empty ? undefined : display}
                            className={`whitespace-nowrap ${k === '_detail' ? 'max-w-80' : 'max-w-56'} truncate tabular-nums ${empty ? 'text-subtle' : ''}`}>
                            {display}
                          </Td>
                        )
                      })}
                    </Tr>
                  )
                })}
              </tbody>
            </TableWrap>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage}
            onPageSize={size => { setPageSize(size); setPage(0) }} />
        </>
      )}
    </div>
  )
}

export default function RawDataPage() {
  return (
    <Suspense>
      <RawDataInner />
    </Suspense>
  )
}
