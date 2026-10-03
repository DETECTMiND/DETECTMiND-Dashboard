'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Download, Table2, BarChart2, LayoutGrid,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Participant, ParticipantPicker, participantName, avatarColor, avatarInitial,
} from '@/components/participant-ui'

// ─── Dataset registry ─────────────────────────────────────────────────────────
// Each processed dataset: which view to read, and how to shape it.
type DatasetKey =
  | 'hourly' | 'daily' | 'steps' | 'pickups' | 'first_last' | 'notifications' | 'battery' | 'gesture_pauses' | 'permission_outages'

interface DatasetDef {
  key: DatasetKey
  label: string
  view: string
  hasChart: boolean
}

const DATASETS: DatasetDef[] = [
  { key: 'hourly',        label: 'Hourly Usage',   view: 'hourly_usage',          hasChart: true  },
  { key: 'daily',         label: 'Daily Usage',    view: 'daily_usage',           hasChart: true  },
  { key: 'steps',         label: 'Steps',          view: 'daily_steps',           hasChart: true  },
  { key: 'pickups',       label: 'Pickups',        view: 'daily_pickups',         hasChart: true  },
  { key: 'first_last',    label: 'First / Last Use', view: 'daily_first_last_use', hasChart: false },
  { key: 'notifications', label: 'Notifications',  view: 'daily_notifications',    hasChart: true  },
  { key: 'battery',       label: 'Battery',        view: 'daily_battery_summary',  hasChart: true  },
  { key: 'gesture_pauses', label: 'Gesture Pauses', view: 'gesture_pause_sessions', hasChart: false },
  { key: 'permission_outages', label: 'Permission Outages', view: 'permission_outages', hasChart: false },
]

type ViewMode = 'table' | 'chart'
type OverallMode = 'avg' | 'sum'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtHM(totalMinutes: number): string {
  const m = Math.round(totalMinutes)
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h === 0) return `${rem}m`
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}
function cellColor(minutes: number): string {
  if (minutes <= 0) return 'transparent'
  const t = Math.min(minutes / 60, 1)
  return `hsl(217, 85%, ${92 - t * 55}%)`
}
function cellText(minutes: number): string { return minutes >= 30 ? '#fff' : '#1e293b' }

function buildCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(',')),
  ].join('\n')
}
function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// Generic row from any view
type Row = Record<string, any>

// ─── Page ──────────────────────────────────────────────────────────────────
export default function ProcessedDataPage() {
  const params = useParams()
  const studyId = params.id as string
  const supabase = createClient()

  const [studyName, setStudyName] = useState('')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [selected, setSelected] = useState<string>('all')
  const [dataset, setDataset] = useState<DatasetKey>('hourly')
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [overallMode, setOverallMode] = useState<OverallMode>('avg')

  const [rowsByView, setRowsByView] = useState<Record<string, Row[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const def = DATASETS.find(d => d.key === dataset)!
  const isOverall = selected === 'all'
  const canChart = def.hasChart

  const pMap = useMemo(() => Object.fromEntries(participants.map(p => [p.id, p])), [participants])

  // Load participants + study name once.
  useEffect(() => {
    async function loadMeta() {
      const [{ data: study }, { data: pList }] = await Promise.all([
        supabase.from('studies').select('name').eq('id', studyId).single(),
        supabase.from('participants').select('id, label, device_id').eq('study_id', studyId),
      ])
      if (study) setStudyName(study.name)
      setParticipants((pList as Participant[]) || [])
      if (!pList || pList.length === 0) setLoading(false)
    }
    loadMeta()
  }, [studyId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load the current dataset's view (cached per view).
  useEffect(() => {
    async function load() {
      if (participants.length === 0) return
      if (rowsByView[def.view]) return // cached
      setLoading(true); setError(null)
      const pIds = participants.map(p => p.id)
      const res = await supabase.from(def.view).select('*').in('participant_id', pIds)
      if (res.error) { setError(res.error.message); setLoading(false); return }
      setRowsByView(prev => ({ ...prev, [def.view]: (res.data as Row[]) || [] }))
      setLoading(false)
    }
    load()
  }, [def.view, participants]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep view mode valid when switching datasets.
  useEffect(() => { if (!canChart) setViewMode('table') }, [canChart])

  const rawRows = rowsByView[def.view] || []
  const scoped = useMemo(
    () => isOverall ? rawRows : rawRows.filter(r => r.participant_id === selected),
    [rawRows, selected, isOverall],
  )

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
    const pdays = new Set<string>()
    for (const r of scoped) {
      sum[r.hour_of_day] = (sum[r.hour_of_day] || 0) + r.screen_on_seconds / 60
      pdays.add(`${r.participant_id}|${r.usage_date}`)
    }
    const denom = overallMode === 'avg' ? Math.max(pdays.size, 1) : 1
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

    // Build per-date aggregation for overall, or straight rows for single.
    if (dataset === 'daily') {
      if (!isOverall) {
        const rows = [...scoped].sort((a, b) => a.usage_date.localeCompare(b.usage_date)).map(r => ({
          date: r.usage_date, screen_time: fmtHM(r.screen_on_minutes), minutes: Math.round(r.screen_on_minutes),
          sessions: r.session_count, avg_session_min: r.avg_session_minutes, unlocks: r.unlock_count, capped: r.capped_sessions,
        }))
        return {
          headers: ['Date', 'Screen time', 'Minutes', 'Sessions', 'Avg session', 'Unlocks', 'Capped'],
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
      const by: Record<string, { steps: number; pdays: number }> = {}
      for (const r of scoped) {
        const d = by[r.usage_date] || (by[r.usage_date] = { steps: 0, pdays: 0 })
        d.steps += r.steps; d.pdays++
      }
      const rows = Object.keys(by).sort().map(date => {
        const d = by[date]; const k = isOverall ? div(d.pdays) : 1
        return { date, steps: Math.round(d.steps / k), ...(isOverall ? { participants: d.pdays } : {}) }
      })
      return {
        headers: isOverall ? ['Date', 'Participants', 'Steps'] : ['Date', 'Steps'],
        rows: rows.map(r => isOverall ? [r.date, String((r as any).participants), r.steps.toLocaleString()] : [r.date, r.steps.toLocaleString()]),
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
        rows: rows.map(r => isOverall ? [r.date, String((r as any).participants), String(r.pickups)] : [r.date, String(r.pickups)]),
        csv: rows, chart: rows.map(r => ({ date: r.date, value: r.pickups })), chartLabel: 'Pickups', unit: '',
      }
    }

    if (dataset === 'notifications') {
      const by: Record<string, { notifications: number; opened: number; pdays: number }> = {}
      for (const r of scoped) {
        const d = by[r.usage_date] || (by[r.usage_date] = { notifications: 0, opened: 0, pdays: 0 })
        d.notifications += r.notifications; d.opened += (r.opened || 0); d.pdays++
      }
      const rows = Object.keys(by).sort().map(date => {
        const d = by[date]; const k = isOverall ? div(d.pdays) : 1
        return { date, notifications: Math.round(d.notifications / k), opened: Math.round(d.opened / k), ...(isOverall ? { participants: d.pdays } : {}) }
      })
      return {
        headers: isOverall ? ['Date', 'Participants', 'Notifications', 'Opened'] : ['Date', 'Notifications', 'Opened'],
        rows: rows.map(r => isOverall ? [r.date, String((r as any).participants), String(r.notifications), String(r.opened)] : [r.date, String(r.notifications), String(r.opened)]),
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
        headers: ['Date', 'Avg level %', 'Min %', 'Max %', 'Time charging %'],
        rows: rows.map(r => [r.date, String(r.avg_level), String(r.min_level), String(r.max_level), String(r.pct_charging)]),
        csv: rows, chart: rows.map(r => ({ date: r.date, value: r.avg_level })), chartLabel: 'Avg battery %', unit: '%',
      }
    }

    if (dataset === 'permission_outages') {
      const fmtTs = (iso: string | null) => {
        if (!iso) return '—'
        try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) } catch { return iso }
      }
      const rows = [...scoped]
        .sort((a, b) => (b.revoked_at || '').localeCompare(a.revoked_at || ''))
        .map(r => ({
          participant: participantName(pMap[r.participant_id] || { id: r.participant_id, label: null, device_id: r.participant_id }),
          permission: r.permission,
          revoked_at: fmtTs(r.revoked_at),
          restored_at: fmtTs(r.restored_at),
          outage: r.outage_minutes == null ? 'still off' : `${r.outage_minutes}m`,
        }))
      return {
        headers: isOverall ? ['Participant', 'Permission', 'Turned off', 'Turned back on', 'Duration'] : ['Permission', 'Turned off', 'Turned back on', 'Duration'],
        rows: rows.map(r => isOverall ? [r.participant, r.permission, r.revoked_at, r.restored_at, r.outage] : [r.permission, r.revoked_at, r.restored_at, r.outage]),
        csv: rows, chart: [], chartLabel: '', unit: '',
      }
    }

    if (dataset === 'gesture_pauses') {
      const fmtTs = (iso: string | null) => {
        if (!iso) return '—'
        try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) } catch { return iso }
      }
      const rows = [...scoped]
        .sort((a, b) => (b.paused_at || '').localeCompare(a.paused_at || ''))
        .map(r => ({
          participant: participantName(pMap[r.participant_id] || { id: r.participant_id, label: null, device_id: r.participant_id }),
          paused_at: fmtTs(r.paused_at),
          resumed_at: fmtTs(r.resumed_at),
          gap_minutes: r.gap_minutes == null ? 'open' : `${r.gap_minutes}m`,
        }))
      return {
        headers: isOverall ? ['Participant', 'Paused', 'Resumed', 'Gap'] : ['Paused', 'Resumed', 'Gap'],
        rows: rows.map(r => isOverall ? [r.participant, r.paused_at, r.resumed_at, r.gap_minutes] : [r.paused_at, r.resumed_at, r.gap_minutes]),
        csv: rows, chart: [], chartLabel: '', unit: '',
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

  function exportCsv() {
    const who = isOverall ? 'overall' : (participantName(pMap[selected]) || selected).replace(/\s+/g, '_')
    if (dataset === 'hourly') {
      const rows = isOverall
        ? hourlyOverall.map(r => ({ hour: r.hour, minutes: r.minutes, mode: overallMode }))
        : hourlyDates.flatMap(date => HOURS.map(h => ({ date, hour: `${String(h).padStart(2, '0')}:00`, minutes: Math.round(hourlyGrid[date][h] || 0) })).filter(r => r.minutes > 0))
      downloadCSV(buildCSV(rows), `${def.view}_${who}.csv`)
    } else if (generic) {
      downloadCSV(buildCSV(generic.csv as Record<string, unknown>[]), `${def.view}_${who}.csv`)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <Link href={`/studies/${studyId}`} className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors mb-4">
          <ArrowLeft size={15} /> Back to Study
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Processed Data</h1>
            <p className="text-gray-500 text-sm mt-0.5">Derived datasets computed from raw sensor events</p>
          </div>
          {participants.length > 0 && (
            <ParticipantPicker participants={participants} value={selected} onChange={setSelected} />
          )}
        </div>
      </div>

      {/* Dataset pills */}
      <div className="flex flex-wrap gap-1.5">
        {DATASETS.map(d => {
          const active = dataset === d.key
          return (
            <button
              key={d.key}
              onClick={() => { setDataset(d.key); if (!d.hasChart) setViewMode('table') }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                active ? 'bg-blue-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              {d.label}
            </button>
          )
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center rounded-lg border border-gray-200 bg-white overflow-hidden">
          <button
            onClick={() => setViewMode('table')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <Table2 size={12} /> Table
          </button>
          <button
            onClick={() => canChart && setViewMode('chart')}
            disabled={!canChart}
            title={!canChart ? 'No chart for this dataset' : undefined}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all ${
              viewMode === 'chart' ? 'bg-blue-600 text-white' : canChart ? 'text-gray-600 hover:bg-gray-50' : 'text-gray-300 cursor-not-allowed'
            }`}
          >
            <BarChart2 size={12} /> Chart
          </button>
        </div>

        {isOverall && (
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {(['avg', 'sum'] as OverallMode[]).map(m => (
              <button
                key={m}
                onClick={() => setOverallMode(m)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${overallMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {m === 'avg' ? 'Average' : 'Sum'}
              </button>
            ))}
          </div>
        )}

        {hasData && (
          <span className="text-xs text-gray-400 tabular-nums">
            {dataset === 'hourly' && !isOverall ? `${hourlyDates.length} days` : `${generic?.rows.length ?? 24} rows`}
          </span>
        )}

        <div className="ml-auto">
          <button
            onClick={exportCsv}
            disabled={!hasData}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 bg-white rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      {/* States */}
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium mb-1">Processed views not available</p>
          <p className="text-amber-700">Run the usage &amp; processed-dataset migrations in the Supabase SQL editor. ({error})</p>
        </div>
      )}
      {!error && participants.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-16 text-center">
          <p className="text-gray-600 font-medium">No participants enrolled yet</p>
        </div>
      )}
      {loading && !error && participants.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-16 text-center">
          <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      )}
      {!error && !loading && participants.length > 0 && !hasData && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-16 text-center">
          <LayoutGrid size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-600 font-medium">No {def.label} data</p>
          <p className="text-gray-400 text-sm mt-1">No records for this selection yet</p>
        </div>
      )}

      {/* ── HOURLY ── */}
      {!error && !loading && hasData && dataset === 'hourly' && (
        viewMode === 'chart' ? (
          <ChartCard>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={isOverall ? hourlyOverall : hourlySingleAvg} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${v} min`, isOverall ? (overallMode === 'avg' ? 'Avg' : 'Total') : 'Avg']} />
                <Bar dataKey="minutes" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        ) : (
          isOverall
            ? <PlainTable
                headers={['Hour', overallMode === 'avg' ? 'Avg minutes / participant-day' : 'Total minutes']}
                rows={hourlyOverall.map(r => [r.hour, String(r.minutes)])}
              />
            : <HeatmapTable grid={hourlyGrid} dates={hourlyDates} />
        )
      )}

      {/* ── GENERIC (daily/pickups/notifications/battery/first_last) ── */}
      {!error && !loading && hasData && dataset !== 'hourly' && generic && (
        viewMode === 'chart' && canChart && generic.chart.length > 0 ? (
          <ChartCard>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={generic.chart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${v}${generic.unit ? ' ' + generic.unit : ''}`, generic.chartLabel]} />
                <Bar dataKey="value" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        ) : (
          <PlainTable headers={generic.headers} rows={generic.rows} />
        )
      )}
    </div>
  )
}

// ─── Sub-components (Sensor-Data styling) ─────────────────────────────────────
function ChartCard({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">{children}</div>
}

function PlainTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-gray-200 bg-gray-50">
              {headers.map(h => (
                <th key={h} className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap uppercase tracking-wide text-[11px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                {r.map((c, j) => <td key={j} className="px-4 py-2.5 text-gray-700 whitespace-nowrap tabular-nums">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function HeatmapTable({ grid, dates }: { grid: Record<string, Record<number, number>>; dates: string[] }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Minutes used per hour</h2>
        <span className="text-[11px] text-gray-400">rows = date · columns = hour (local)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="sticky left-0 bg-gray-50 px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide text-[11px] z-10">Date</th>
              {HOURS.map(h => <th key={h} className="px-1 py-2.5 text-center font-semibold text-gray-400 text-[10px] w-9">{String(h).padStart(2, '0')}</th>)}
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide text-[11px]">Total</th>
            </tr>
          </thead>
          <tbody>
            {dates.map(date => {
              const dayTotal = HOURS.reduce((s, h) => s + (grid[date][h] || 0), 0)
              return (
                <tr key={date} className="hover:bg-blue-50/20">
                  <td className="sticky left-0 bg-white px-3 py-1 text-gray-600 whitespace-nowrap z-10">
                    {new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </td>
                  {HOURS.map(h => {
                    const m = Math.round(grid[date][h] || 0)
                    return (
                      <td key={h} className="px-0.5 py-0.5 text-center" title={`${date} ${String(h).padStart(2, '0')}:00 — ${m} min`}>
                        <div className="rounded w-8 h-7 flex items-center justify-center mx-auto text-[10px]" style={{ background: cellColor(m), color: cellText(m) }}>
                          {m > 0 ? m : ''}
                        </div>
                      </td>
                    )
                  })}
                  <td className="px-3 py-1 text-right text-gray-700 font-medium whitespace-nowrap tabular-nums">{fmtHM(dayTotal)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
