'use client'

import { createClient } from '@/lib/supabase-browser'
import { Suspense, useMemo, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BarChart2, Download, LayoutGrid, Table2, Users } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Button, Card, EmptyState, ErrorState, FilterPills, Pagination, SectionHeader, SegmentedControl,
  Skeleton, SkeletonRows, TableWrap, THead, Th, Td, Tr,
} from '@/components/ui'
import { Participant, ParticipantPicker, participantName } from '@/components/participant-ui'
import { useAsync } from '@/components/data/use-async'
import { C, axisLine, axisTick, gridProps, intensity, tooltipProps } from '@/components/charts/theme'
import { chunks, downloadCsv, fetchAll, localDay, safeFileName } from '@/lib/csv'
import { permissionLabel } from '@/lib/sensors'

// ─── Dataset registry ─────────────────────────────────────────────────────────
// Each processed dataset: which database view to read, a stable order for
// paging through it, and whether it has a chart.
type DatasetKey =
  | 'hourly' | 'daily' | 'hourly_app' | 'daily_app' | 'steps' | 'pickups' | 'first_last' | 'notifications' | 'battery' | 'permission_outages' | 'scroll'

interface DatasetDef {
  key: DatasetKey
  label: string
  view: string
  order: string[]
  hasChart: boolean
}

const DATASETS: DatasetDef[] = [
  { key: 'hourly',             label: 'Hourly screen time',    view: 'hourly_usage',          order: ['usage_hour'],                   hasChart: true  },
  { key: 'daily',              label: 'Daily screen time',     view: 'daily_usage',           order: ['usage_date'],                   hasChart: true  },
  { key: 'hourly_app',         label: 'Hourly app usage',      view: 'hourly_app_usage',      order: ['usage_hour', 'package_name'],   hasChart: true  },
  { key: 'daily_app',          label: 'Daily app usage',       view: 'daily_app_usage_total', order: ['usage_date'],                   hasChart: true  },
  { key: 'steps',              label: 'Steps',                 view: 'daily_steps',           order: ['usage_date'],                   hasChart: true  },
  { key: 'pickups',            label: 'Pickups',               view: 'daily_pickups',         order: ['usage_date', 'hour_of_day'],    hasChart: true  },
  { key: 'first_last',         label: 'First and last use',    view: 'daily_first_last_use',  order: ['usage_date'],                   hasChart: false },
  { key: 'notifications',      label: 'Notifications',         view: 'daily_notifications',   order: ['usage_date'],                   hasChart: true  },
  { key: 'battery',            label: 'Battery',               view: 'daily_battery_summary', order: ['usage_date'],                   hasChart: true  },
  { key: 'permission_outages', label: 'Permission outages',    view: 'permission_outages',    order: ['permission', 'revoked_at'],     hasChart: false },
  { key: 'scroll',             label: 'Scrolling and reels',   view: 'daily_scroll_activity', order: ['usage_date', 'app_name'],       hasChart: true  },
]

type ViewMode = 'table' | 'chart'
type OverallMode = 'avg' | 'sum'

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const TABLE_PAGE = 50

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtHM(totalMinutes: number): string {
  const m = Math.round(totalMinutes)
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h === 0) return `${rem}m`
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}

/** 'YYYY-MM-DD' from the database shown as a local calendar date (no UTC shift). */
function fmtDay(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtTs(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Raw rows from the database views have per-view shapes; treated dynamically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

// ─── Page ──────────────────────────────────────────────────────────────────
function ProcessedDataInner() {
  const { id: studyId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])

  const [dataset, setDataset] = useState<DatasetKey>('hourly')
  const [chosenViewMode, setViewMode] = useState<ViewMode>('table')
  const [overallMode, setOverallMode] = useState<OverallMode>('avg')
  const [pageState, setPageState] = useState({ key: '', page: 0 })

  const meta = useAsync(`participants:${studyId}`, () =>
    fetchAll<Participant>((from, to) => supabase.from('participants').select('id, label, device_id')
      .eq('study_id', studyId).order('enrolled_at', { ascending: false }).order('id').range(from, to)))
  const participants = useMemo(() => meta.data ?? [], [meta.data])
  const pMap = useMemo(() => Object.fromEntries(participants.map(p => [p.id, p])), [participants])

  const requested = searchParams.get('participant')
  const selected = requested && (!meta.data || pMap[requested]) ? requested : 'all'
  const def = DATASETS.find(d => d.key === dataset)!
  const isOverall = selected === 'all'
  const canChart = def.hasChart
  // Datasets without a chart always show the table.
  const viewMode: ViewMode = canChart ? chosenViewMode : 'table'

  // Load the dataset for this selection, paging past the 1000-row limit.
  // Study-wide: participant ids in chunks (views have no study column).
  const loadKey = meta.data && participants.length > 0 ? `${def.view}|${selected}` : null
  const load = useAsync(loadKey, async () => {
    const page = (ids: string[] | string) => fetchAll<Row>((from, to) => {
      let q = supabase.from(def.view).select('*')
      q = typeof ids === 'string' ? q.eq('participant_id', ids) : q.in('participant_id', ids)
      q = q.order('participant_id')
      for (const col of def.order) q = q.order(col)
      return q.range(from, to)
    })
    if (selected !== 'all') return page(selected)
    const parts = await Promise.all(chunks(participants.map(p => p.id), 100).map(page))
    return parts.flat()
  })
  const scoped = useMemo(() => load.data ?? [], [load.data])
  const loading = meta.loading || load.loading

  function changeParticipant(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (id === 'all') params.delete('participant')
    else params.set('participant', id)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // ── HOURLY: date × hour grid (single) / minutes-per-hour (overall) ──────────
  const hourlyGrid = useMemo(() => {
    const g: Record<string, Record<number, number>> = {}
    if (dataset !== 'hourly') return g
    for (const r of scoped) {
      if (!g[r.usage_date]) g[r.usage_date] = {}
      g[r.usage_date][r.hour_of_day] = (g[r.usage_date][r.hour_of_day] || 0) + r.screen_on_seconds / 60
    }
    return g
  }, [scoped, dataset])
  const hourlyDates = useMemo(() => Object.keys(hourlyGrid).sort(), [hourlyGrid])

  const hourlyOverall = useMemo(() => {
    const sum: Record<number, number> = {}
    const seen = new Set<string>()
    for (const r of scoped) {
      sum[r.hour_of_day] = (sum[r.hour_of_day] || 0) + r.screen_on_seconds / 60
      seen.add(r.participant_id)
    }
    const denom = overallMode === 'avg' ? Math.max(seen.size, 1) : 1
    return HOURS.map(h => ({ hour: `${String(h).padStart(2, '0')}:00`, minutes: Math.round((sum[h] || 0) / denom) }))
  }, [scoped, overallMode])

  const hourlySingleAvg = useMemo(() => {
    const sum: Record<number, number> = {}
    const denom = hourlyDates.length || 1
    for (const r of scoped) sum[r.hour_of_day] = (sum[r.hour_of_day] || 0) + r.screen_on_seconds / 60
    return HOURS.map(h => ({ hour: `${String(h).padStart(2, '0')}:00`, minutes: Math.round((sum[h] || 0) / denom) }))
  }, [scoped, hourlyDates])

  // ── Generic daily aggregation for the simple datasets ───────────────────────
  // Returns { table: rows[], chart: {date,value}[], chartLabel }
  const generic = useMemo(() => {
    if (dataset === 'hourly') return null

    const div = (pdays: number) => overallMode === 'avg' ? Math.max(pdays, 1) : 1

    // Hourly app usage: per-app by hour
    if (dataset === 'hourly_app') {
      const rows = [...scoped]
        .sort((a, b) => (b.usage_hour || '').localeCompare(a.usage_hour || ''))
        .map(r => ({
          time: r.usage_hour ? new Date(r.usage_hour).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '',
          app: r.app_name || r.package_name || 'Unknown',
          time_used: fmtHM(r.foreground_minutes), minutes: Math.round(r.foreground_minutes), opens: r.open_count,
        }))
      return {
        headers: ['Hour', 'App', 'Time used', 'Minutes', 'Opens'],
        rows: rows.map(r => [r.time, r.app, r.time_used, String(r.minutes), String(r.opens)]),
        csv: rows, chart: rows.slice(0, 10).map(r => ({ date: r.time, value: r.minutes })), chartLabel: 'Minutes', unit: 'min',
      }
    }

    // Daily app usage total: total app time per day
    if (dataset === 'daily_app') {
      if (!isOverall) {
        const rows = [...scoped].sort((a, b) => a.usage_date.localeCompare(b.usage_date)).map(r => ({
          date: r.usage_date, total_time: fmtHM(r.total_foreground_minutes), minutes: Math.round(r.total_foreground_minutes),
          hours: r.total_foreground_hours, apps: r.unique_apps, opens: r.total_opens,
        }))
        return {
          headers: ['Date', 'Total time', 'Minutes', 'Hours', 'Unique apps', 'Opens'],
          rows: rows.map(r => [r.date, r.total_time, String(r.minutes), String(r.hours), String(r.apps), String(r.opens)]),
          csv: rows, chart: rows.map(r => ({ date: r.date, value: r.minutes })), chartLabel: 'Minutes', unit: 'min',
        }
      }
      const by: Record<string, { minutes: number; hours: number; apps: number; opens: number; pdays: number }> = {}
      for (const r of scoped) {
        const d = by[r.usage_date] || (by[r.usage_date] = { minutes: 0, hours: 0, apps: 0, opens: 0, pdays: 0 })
        d.minutes += r.total_foreground_minutes; d.hours += r.total_foreground_hours; d.apps += r.unique_apps; d.opens += r.total_opens; d.pdays++
      }
      const rows = Object.keys(by).sort().map(date => {
        const d = by[date]; const k = div(d.pdays)
        return { date, participants: d.pdays, total_time: fmtHM(d.minutes / k), minutes: Math.round(d.minutes / k), hours: +(d.hours / k).toFixed(2), apps: Math.round(d.apps / k), opens: Math.round(d.opens / k) }
      })
      return {
        headers: ['Date', 'Participants', 'Total time', 'Minutes', 'Hours', 'Unique apps', 'Opens'],
        rows: rows.map(r => [r.date, String(r.participants), r.total_time, String(r.minutes), String(r.hours), String(r.apps), String(r.opens)]),
        csv: rows, chart: rows.map(r => ({ date: r.date, value: r.minutes })), chartLabel: 'Minutes', unit: 'min',
      }
    }

    // Build per-date aggregation for overall, or straight rows for single.
    if (dataset === 'daily') {
      if (!isOverall) {
        const rows = [...scoped].sort((a, b) => a.usage_date.localeCompare(b.usage_date)).map(r => ({
          date: r.usage_date, screen_time: fmtHM(r.screen_on_minutes), minutes: Math.round(r.screen_on_minutes),
          sessions: r.session_count, avg_session_min: r.avg_session_minutes, unlocks: r.unlock_count, capped: r.capped_sessions,
        }))
        return {
          headers: ['Date', 'Screen time', 'Minutes', 'Sessions', 'Average session', 'Unlocks', 'Capped sessions'],
          rows: rows.map(r => [r.date, r.screen_time, String(r.minutes), String(r.sessions), `${r.avg_session_min}m`, String(r.unlocks), String(r.capped)]),
          csv: rows, chart: rows.map(r => ({ date: r.date, value: r.minutes })), chartLabel: 'Minutes', unit: 'min',
        }
      }
      const by: Record<string, { minutes: number; unlocks: number; sessions: number; pdays: number }> = {}
      for (const r of scoped) {
        const d = by[r.usage_date] || (by[r.usage_date] = { minutes: 0, unlocks: 0, sessions: 0, pdays: 0 })
        d.minutes += r.screen_on_minutes; d.unlocks += r.unlock_count; d.sessions += r.session_count; d.pdays++
      }
      const rows = Object.keys(by).sort().map(date => {
        const d = by[date]; const k = div(d.pdays)
        return { date, participants: d.pdays, screen_time: fmtHM(d.minutes / k), minutes: Math.round(d.minutes / k), sessions: Math.round(d.sessions / k), unlocks: Math.round(d.unlocks / k) }
      })
      return {
        headers: ['Date', 'Participants', 'Screen time', 'Minutes', 'Sessions', 'Unlocks'],
        rows: rows.map(r => [r.date, String(r.participants), r.screen_time, String(r.minutes), String(r.sessions), String(r.unlocks)]),
        csv: rows, chart: rows.map(r => ({ date: r.date, value: r.minutes })), chartLabel: 'Minutes', unit: 'min',
      }
    }

    if (dataset === 'steps') {
      const by: Record<string, { steps: number; pdays: Set<string> }> = {}
      for (const r of scoped) {
        const d = by[r.usage_date] || (by[r.usage_date] = { steps: 0, pdays: new Set() })
        d.steps += r.steps; d.pdays.add(r.participant_id)
      }
      const rows = Object.keys(by).sort().map(date => {
        const d = by[date]; const k = isOverall ? div(d.pdays.size) : 1
        return { date, steps: Math.round(d.steps / k), ...(isOverall ? { participants: d.pdays.size } : {}) }
      })
      return {
        headers: isOverall ? ['Date', 'Participants', 'Steps'] : ['Date', 'Steps'],
        rows: rows.map(r => isOverall ? [r.date, String((r as { participants?: number }).participants ?? 0), r.steps.toLocaleString()] : [r.date, r.steps.toLocaleString()]),
        csv: rows, chart: rows.map(r => ({ date: r.date, value: r.steps })), chartLabel: 'Steps', unit: '',
      }
    }

    if (dataset === 'pickups') {
      // view grain is participant × date × hour; roll up to date
      const by: Record<string, { pickups: number; pdays: Set<string> }> = {}
      for (const r of scoped) {
        const d = by[r.usage_date] || (by[r.usage_date] = { pickups: 0, pdays: new Set() })
        d.pickups += r.pickups; d.pdays.add(r.participant_id)
      }
      const rows = Object.keys(by).sort().map(date => {
        const d = by[date]; const k = isOverall ? div(d.pdays.size) : 1
        return { date, pickups: Math.round(d.pickups / k), ...(isOverall ? { participants: d.pdays.size } : {}) }
      })
      return {
        headers: isOverall ? ['Date', 'Participants', 'Pickups'] : ['Date', 'Pickups'],
        rows: rows.map(r => isOverall ? [r.date, String((r as { participants?: number }).participants ?? 0), String(r.pickups)] : [r.date, String(r.pickups)]),
        csv: rows, chart: rows.map(r => ({ date: r.date, value: r.pickups })), chartLabel: 'Pickups', unit: '',
      }
    }

    if (dataset === 'notifications') {
      const by: Record<string, { notifications: number; opened: number; pdays: Set<string> }> = {}
      for (const r of scoped) {
        const d = by[r.usage_date] || (by[r.usage_date] = { notifications: 0, opened: 0, pdays: new Set() })
        d.notifications += r.notifications; d.opened += (r.opened || 0); d.pdays.add(r.participant_id)
      }
      const rows = Object.keys(by).sort().map(date => {
        const d = by[date]; const k = isOverall ? div(d.pdays.size) : 1
        return { date, notifications: Math.round(d.notifications / k), opened: Math.round(d.opened / k), ...(isOverall ? { participants: d.pdays.size } : {}) }
      })
      return {
        headers: isOverall ? ['Date', 'Participants', 'Notifications', 'Opened'] : ['Date', 'Notifications', 'Opened'],
        rows: rows.map(r => isOverall ? [r.date, String((r as { participants?: number }).participants ?? 0), String(r.notifications), String(r.opened)] : [r.date, String(r.notifications), String(r.opened)]),
        csv: rows, chart: rows.map(r => ({ date: r.date, value: r.notifications })), chartLabel: 'Notifications', unit: '',
      }
    }

    if (dataset === 'battery') {
      const by: Record<string, { avg: number; min: number; max: number; charging: number; n: number }> = {}
      for (const r of scoped) {
        const d = by[r.usage_date] || (by[r.usage_date] = { avg: 0, min: 100, max: 0, charging: 0, n: 0 })
        d.avg += r.avg_level; d.min = Math.min(d.min, r.min_level); d.max = Math.max(d.max, r.max_level)
        d.charging += (r.pct_time_charging || 0); d.n++
      }
      const rows = Object.keys(by).sort().map(date => {
        const d = by[date]
        return { date, avg_level: Math.round(d.avg / d.n), min_level: d.min, max_level: d.max, pct_charging: Math.round(d.charging / d.n) }
      })
      return {
        headers: ['Date', 'Average level (%)', 'Lowest (%)', 'Highest (%)', 'Time charging (%)'],
        rows: rows.map(r => [r.date, String(r.avg_level), String(r.min_level), String(r.max_level), String(r.pct_charging)]),
        csv: rows, chart: rows.map(r => ({ date: r.date, value: r.avg_level })), chartLabel: 'Average battery level', unit: '%',
      }
    }

    if (dataset === 'permission_outages') {
      const rows = [...scoped]
        .sort((a, b) => (b.revoked_at || '').localeCompare(a.revoked_at || ''))
        .map(r => ({
          participant: participantName(pMap[r.participant_id] || { id: r.participant_id, label: null, device_id: r.participant_id }),
          permission: permissionLabel(r.permission),
          permission_key: r.permission,
          revoked_at: fmtTs(r.revoked_at),
          restored_at: fmtTs(r.restored_at),
          outage: r.outage_minutes == null ? 'Still off' : fmtHM(Number(r.outage_minutes)),
        }))
      return {
        headers: isOverall ? ['Participant', 'Permission', 'Turned off', 'Turned back on', 'Duration'] : ['Permission', 'Turned off', 'Turned back on', 'Duration'],
        rows: rows.map(r => isOverall ? [r.participant, r.permission, r.revoked_at, r.restored_at, r.outage] : [r.permission, r.revoked_at, r.restored_at, r.outage]),
        csv: rows, chart: [], chartLabel: '', unit: '',
      }
    }

    if (dataset === 'scroll') {
      // View grain is participant x date x app; one table row per grain.
      const num = (v: unknown) => (v == null ? null : Number(v))
      const fmtSec = (v: unknown) => (v == null ? '—' : `${Number(v).toFixed(1)}s`)
      const rows = [...scoped]
        .sort((a, b) => String(b.usage_date).localeCompare(String(a.usage_date))
          || String(a.app_name ?? '').localeCompare(String(b.app_name ?? '')))
        .map(r => ({
          date: r.usage_date as string,
          participant: participantName(pMap[r.participant_id] || { id: r.participant_id, label: null, device_id: r.participant_id }),
          app: (r.app_name as string | null) || '—',
          reel_swipes: Number(r.reel_swipes) || 0,
          median_dwell_seconds: num(r.median_dwell_seconds),
          avg_dwell_seconds: num(r.avg_dwell_seconds),
          feed_scroll_bursts: Number(r.feed_scroll_bursts) || 0,
          feed_distance_dp: Number(r.feed_distance_dp) || 0,
          feed_items_passed: Number(r.feed_items_passed) || 0,
          feed_scroll_seconds: Number(r.feed_scroll_seconds) || 0,
        }))
      // Chart: reel swipes per day (overall: average per participant active that day).
      const byDate: Record<string, { swipes: number; pids: Set<string> }> = {}
      for (const r of scoped) {
        const d = byDate[r.usage_date] || (byDate[r.usage_date] = { swipes: 0, pids: new Set() })
        d.swipes += Number(r.reel_swipes) || 0; d.pids.add(r.participant_id)
      }
      const chart = Object.keys(byDate).sort().map(date => {
        const d = byDate[date]; const k = isOverall ? div(d.pids.size) : 1
        return { date, value: Math.round(d.swipes / k) }
      })
      const cells = (r: typeof rows[number]) => [
        r.app, r.reel_swipes.toLocaleString(), fmtSec(r.median_dwell_seconds), fmtSec(r.avg_dwell_seconds),
        r.feed_scroll_bursts.toLocaleString(), r.feed_distance_dp.toLocaleString(), r.feed_items_passed.toLocaleString(),
        `${r.feed_scroll_seconds.toFixed(1)}s`,
      ]
      const tail = ['App', 'Reel swipes', 'Median dwell', 'Avg dwell', 'Feed scroll bursts', 'Feed distance (dp)', 'Items passed', 'Feed scroll time']
      return {
        headers: isOverall ? ['Date', 'Participant', ...tail] : ['Date', ...tail],
        rows: rows.map(r => isOverall ? [r.date, r.participant, ...cells(r)] : [r.date, ...cells(r)]),
        csv: rows, chart, chartLabel: isOverall && overallMode === 'avg' ? 'Reel swipes (avg per participant)' : 'Reel swipes', unit: '',
      }
    }

    if (dataset === 'first_last') {
      const rows = [...scoped].sort((a, b) => (a.usage_date + a.participant_id).localeCompare(b.usage_date + b.participant_id))
        .map(r => ({ date: r.usage_date, participant: participantName(pMap[r.participant_id] || { id: r.participant_id, label: null, device_id: r.participant_id }), first: r.first_use_local || '—', last: r.last_use_local || '—' }))
      return {
        headers: isOverall ? ['Date', 'Participant', 'First use', 'Last use'] : ['Date', 'First use', 'Last use'],
        rows: rows.map(r => isOverall ? [r.date, r.participant, r.first, r.last] : [r.date, r.first, r.last]),
        csv: rows, chart: [], chartLabel: '', unit: '',
      }
    }

    return null
  }, [dataset, scoped, isOverall, overallMode, pMap])

  // ── hasData + export ────────────────────────────────────────────────────────
  const hasData = dataset === 'hourly'
    ? (isOverall ? hourlyOverall.some(r => r.minutes > 0) : hourlyDates.length > 0)
    : (generic?.rows.length ?? 0) > 0

  const tableKey = `${def.view}|${selected}|${overallMode}`
  const page = pageState.key === tableKey ? pageState.page : 0
  const setPage = (p: number) => setPageState({ key: tableKey, page: p })

  function exportCsv() {
    const who = isOverall ? 'all' : safeFileName(pMap[selected] ? participantName(pMap[selected]) : selected)
    const name = `${def.view}_${who}_${localDay(new Date())}`
    if (dataset === 'hourly') {
      const rows = isOverall
        ? hourlyOverall.map(r => ({ hour: r.hour, minutes: r.minutes, mode: overallMode === 'avg' ? 'average per participant' : 'total' }))
        : hourlyDates.flatMap(date => HOURS.map(h => ({ date, hour: `${String(h).padStart(2, '0')}:00`, minutes: Math.round(hourlyGrid[date][h] || 0) })).filter(r => r.minutes > 0))
      downloadCsv(rows, name)
    } else if (generic) {
      downloadCsv(generic.csv as Record<string, unknown>[], name)
    }
  }

  const rowCountLabel = dataset === 'hourly' && !isOverall
    ? `${hourlyDates.length.toLocaleString()} days`
    : `${(generic?.rows.length ?? 24).toLocaleString()} rows`

  // ─── Render ─────────────────────────────────────────────────────────────────
  if (meta.error) return <ErrorState message={meta.error} onRetry={meta.retry} />
  if (meta.loading) return <SkeletonRows rows={8} />
  if (participants.length === 0) {
    return (
      <EmptyState icon={<Users size={28} />} title="No participants yet"
        hint="Summaries appear once participants join and their phones sync." />
    )
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title={def.label}
        description="Daily summaries per participant, computed from the raw data."
        actions={<ParticipantPicker participants={participants} value={selected} onChange={changeParticipant} />}
      />

      <FilterPills label="Summary" value={dataset} onChange={setDataset}
        options={DATASETS.map(d => ({ value: d.key, label: d.label }))} />

      <div className="flex flex-wrap items-center gap-2">
        {canChart && (
          <SegmentedControl label="View" value={viewMode} onChange={setViewMode} size="sm"
            options={[{ value: 'table', label: 'Table', icon: <Table2 size={13} /> }, { value: 'chart', label: 'Chart', icon: <BarChart2 size={13} /> }]} />
        )}
        {isOverall && (
          <SegmentedControl label="Combine participants" value={overallMode} onChange={setOverallMode} size="sm"
            options={[{ value: 'avg', label: 'Average' }, { value: 'sum', label: 'Total' }]} />
        )}
        {hasData && !loading && <span className="text-xs text-subtle tabular-nums">{rowCountLabel}</span>}
        <div className="ml-auto">
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!hasData || loading}>
            <Download size={13} aria-hidden="true" /> Export CSV
          </Button>
        </div>
      </div>

      {load.error ? (
        <ErrorState title="This summary isn't available"
          message={`The ${def.label.toLowerCase()} summary could not be loaded. Try again, and contact an admin if it keeps happening.`}
          onRetry={load.retry} />
      ) : loading ? (
        <div role="status" aria-label={`Loading ${def.label.toLowerCase()}`} className="space-y-3">
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : !hasData ? (
        <EmptyState icon={<LayoutGrid size={28} />} title={`No ${def.label.toLowerCase()} yet`} hint="Nothing has been recorded for this selection." />
      ) : dataset === 'hourly' ? (
        viewMode === 'chart' ? (
          <SimpleBarChart data={isOverall ? hourlyOverall : hourlySingleAvg} xKey="hour" valueKey="minutes"
            label={isOverall ? (overallMode === 'avg' ? 'Average minutes' : 'Total minutes') : 'Average minutes'} unit="min" />
        ) : isOverall ? (
          <PlainTable headers={['Hour', overallMode === 'avg' ? 'Average minutes per participant-day' : 'Total minutes']}
            rows={hourlyOverall.map(r => [r.hour, String(r.minutes)])} page={page} onPage={setPage} />
        ) : (
          <HeatmapTable grid={hourlyGrid} dates={hourlyDates} />
        )
      ) : generic && (
        viewMode === 'chart' && canChart && generic.chart.length > 0 ? (
          <SimpleBarChart data={generic.chart} xKey="date" valueKey="value" label={generic.chartLabel} unit={generic.unit} />
        ) : (
          <PlainTable headers={generic.headers} rows={generic.rows} page={page} onPage={setPage} />
        )
      )}
    </div>
  )
}

export default function ProcessedDataPage() {
  return (
    <Suspense>
      <ProcessedDataInner />
    </Suspense>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function SimpleBarChart({ data, xKey, valueKey, label, unit }: {
  data: Record<string, unknown>[]; xKey: string; valueKey: string; label: string; unit: string
}) {
  return (
    <Card>
      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis dataKey={xKey} tick={axisTick} axisLine={axisLine} tickLine={false} minTickGap={12} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={48} />
          <Tooltip {...tooltipProps} formatter={v => [`${v}${unit ? ` ${unit}` : ''}`, label]} />
          <Bar dataKey={valueKey} name={label} fill={C.blue} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

function PlainTable({ headers, rows, page, onPage }: { headers: string[]; rows: string[][]; page: number; onPage: (p: number) => void }) {
  const paged = rows.length > TABLE_PAGE
  const visible = paged ? rows.slice(page * TABLE_PAGE, (page + 1) * TABLE_PAGE) : rows
  return (
    <div className="space-y-3">
      <TableWrap maxHeight="70vh">
        <THead>
          <tr>{headers.map(h => <Th key={h}>{h}</Th>)}</tr>
        </THead>
        <tbody>
          {visible.map((r, i) => (
            <Tr key={i}>
              {r.map((c, j) => <Td key={j} className="whitespace-nowrap tabular-nums">{c}</Td>)}
            </Tr>
          ))}
        </tbody>
      </TableWrap>
      {paged && <Pagination page={page} pageSize={TABLE_PAGE} total={rows.length} onPage={onPage} />}
    </div>
  )
}

function HeatmapTable({ grid, dates }: { grid: Record<string, Record<number, number>>; dates: string[] }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="text-sm font-semibold text-fg">Minutes of screen time per hour</h3>
        <span className="text-xs text-subtle">Rows are days, columns are hours (local time)</span>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="border-collapse text-xs">
          <thead className="sticky top-0 z-20 bg-sunken">
            <tr>
              <th scope="col" className="sticky left-0 z-20 bg-sunken px-3 py-2.5 text-left font-semibold text-subtle">Date</th>
              {HOURS.map(h => <th key={h} scope="col" className="w-9 px-1 py-2.5 text-center text-[10px] font-semibold text-subtle">{String(h).padStart(2, '0')}</th>)}
              <th scope="col" className="px-3 py-2.5 text-right font-semibold text-subtle">Total</th>
            </tr>
          </thead>
          <tbody>
            {dates.map(date => {
              const dayTotal = HOURS.reduce((s, h) => s + (grid[date][h] || 0), 0)
              return (
                <tr key={date}>
                  <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1 text-left font-normal text-muted">{fmtDay(date)}</th>
                  {HOURS.map(h => {
                    const m = Math.round(grid[date][h] || 0)
                    const t = Math.min(m / 60, 1)
                    return (
                      <td key={h} className="px-0.5 py-0.5 text-center" title={`${fmtDay(date)} ${String(h).padStart(2, '0')}:00, ${m} min`}>
                        <div className={`mx-auto flex h-7 w-8 items-center justify-center rounded text-[10px] ${t >= 0.5 ? 'text-white' : 'text-fg'}`}
                          style={{ background: m > 0 ? intensity(C.blue, 0.15 + 0.85 * t) : 'var(--surface-sunken)' }}>
                          {m > 0 ? m : ''}
                        </div>
                      </td>
                    )
                  })}
                  <td className="whitespace-nowrap px-3 py-1 text-right font-medium tabular-nums text-fg">{fmtHM(dayTotal)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
