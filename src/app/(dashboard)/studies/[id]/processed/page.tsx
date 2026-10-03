'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, LayoutGrid, Users, AlertTriangle, Download, Table2, BarChart2,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

// ─── Types ──────────────────────────────────────────────────────────────────
interface Participant {
  id: string
  label: string | null
  device_id: string
}

interface HourlyRow {
  participant_id: string
  usage_date: string
  hour_of_day: number
  screen_on_seconds: number
}

interface DailyRow {
  participant_id: string
  usage_date: string
  screen_on_minutes: number
  screen_on_hours: number
  session_count: number
  avg_session_minutes: number
  unlock_count: number
  capped_sessions: number
}

type DatasetKey = 'hourly' | 'daily'
type ViewMode = 'table' | 'chart'
type OverallMode = 'avg' | 'sum'

const DATASETS: { key: DatasetKey; label: string; view: string }[] = [
  { key: 'hourly', label: 'Hourly Usage', view: 'hourly_usage' },
  { key: 'daily',  label: 'Daily Usage',  view: 'daily_usage'  },
]

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4']

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pName(p: Participant) { return p.label || p.device_id }

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

// ─── Page ──────────────────────────────────────────────────────────────────
export default function ProcessedDataPage() {
  const params = useParams()
  const studyId = params.id as string
  const supabase = createClient()

  const [studyName, setStudyName] = useState('')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [selected, setSelected] = useState<string>('all')  // 'all' = overall
  const [dataset, setDataset] = useState<DatasetKey>('hourly')
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [overallMode, setOverallMode] = useState<OverallMode>('avg')

  const [hourly, setHourly] = useState<HourlyRow[]>([])
  const [daily, setDaily] = useState<DailyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isOverall = selected === 'all'

  // Load participants + study name once.
  useEffect(() => {
    async function loadMeta() {
      const [{ data: study }, { data: pList }] = await Promise.all([
        supabase.from('studies').select('name').eq('id', studyId).single(),
        supabase.from('participants').select('id, label, device_id').eq('study_id', studyId),
      ])
      if (study) setStudyName(study.name)
      setParticipants((pList as Participant[]) || [])
    }
    loadMeta()
  }, [studyId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load usage data (all participants; filter client-side for flexibility).
  useEffect(() => {
    async function load() {
      if (participants.length === 0) { setLoading(false); return }
      setLoading(true); setError(null)
      const pIds = participants.map(p => p.id)
      const [hRes, dRes] = await Promise.all([
        supabase.from('hourly_usage').select('*').in('participant_id', pIds),
        supabase.from('daily_usage').select('*').in('participant_id', pIds).order('usage_date'),
      ])
      if (hRes.error || dRes.error) {
        setError((hRes.error || dRes.error)!.message); setLoading(false); return
      }
      setHourly((hRes.data as HourlyRow[]) || [])
      setDaily((dRes.data as DailyRow[]) || [])
      setLoading(false)
    }
    load()
  }, [participants]) // eslint-disable-line react-hooks/exhaustive-deps

  const pMap = useMemo(
    () => Object.fromEntries(participants.map(p => [p.id, pName(p)])),
    [participants],
  )

  // ── HOURLY: build the display rows (single participant OR overall) ──────────
  // Per-participant: rows = date, cols = hour, value = minutes.
  // Overall: rows = hour-of-day, value = avg/sum minutes across participant-days.
  const hourlyScoped = useMemo(
    () => isOverall ? hourly : hourly.filter(r => r.participant_id === selected),
    [hourly, selected, isOverall],
  )

  // Per-participant date × hour grid
  const hourlyGrid = useMemo(() => {
    const g: Record<string, Record<number, number>> = {}
    for (const r of hourlyScoped) {
      if (!g[r.usage_date]) g[r.usage_date] = {}
      g[r.usage_date][r.hour_of_day] = (g[r.usage_date][r.hour_of_day] || 0) + r.screen_on_seconds / 60
    }
    return g
  }, [hourlyScoped])
  const hourlyDates = useMemo(() => Object.keys(hourlyGrid).sort(), [hourlyGrid])

  // Overall: minutes per hour-of-day (avg per participant-day, or sum)
  const overallByHour = useMemo(() => {
    const sum: Record<number, number> = {}
    // denominator for avg = number of distinct participant-days
    const pdays = new Set<string>()
    for (const r of hourlyScoped) {
      sum[r.hour_of_day] = (sum[r.hour_of_day] || 0) + r.screen_on_seconds / 60
      pdays.add(`${r.participant_id}|${r.usage_date}`)
    }
    const denom = overallMode === 'avg' ? Math.max(pdays.size, 1) : 1
    return HOURS.map(h => ({
      hour: `${String(h).padStart(2, '0')}:00`,
      hour_of_day: h,
      minutes: Math.round((sum[h] || 0) / denom),
    }))
  }, [hourlyScoped, overallMode])

  // Average by hour-of-day for a single participant (for the chart)
  const singleAvgByHour = useMemo(() => {
    const sum: Record<number, number> = {}
    const denom = hourlyDates.length || 1
    for (const r of hourlyScoped) sum[r.hour_of_day] = (sum[r.hour_of_day] || 0) + r.screen_on_seconds / 60
    return HOURS.map(h => ({
      hour: `${String(h).padStart(2, '0')}:00`,
      minutes: Math.round((sum[h] || 0) / denom),
    }))
  }, [hourlyScoped, hourlyDates])

  // ── DAILY: scoped rows ──────────────────────────────────────────────────────
  const dailyScoped = useMemo(
    () => isOverall ? daily : daily.filter(r => r.participant_id === selected),
    [daily, selected, isOverall],
  )

  // Daily table rows (flat, exportable)
  const dailyTableRows = useMemo(() => {
    if (!isOverall) {
      return [...dailyScoped]
        .sort((a, b) => a.usage_date.localeCompare(b.usage_date))
        .map(r => ({
          date: r.usage_date,
          screen_time: fmtHM(r.screen_on_minutes),
          minutes: Math.round(r.screen_on_minutes),
          sessions: r.session_count,
          avg_session_min: r.avg_session_minutes,
          unlocks: r.unlock_count,
          capped: r.capped_sessions,
        }))
    }
    // overall: aggregate per date across participants
    const byDate: Record<string, { minutes: number; unlocks: number; sessions: number; pdays: number }> = {}
    for (const r of dailyScoped) {
      const d = byDate[r.usage_date] || (byDate[r.usage_date] = { minutes: 0, unlocks: 0, sessions: 0, pdays: 0 })
      d.minutes += r.screen_on_minutes; d.unlocks += r.unlock_count; d.sessions += r.session_count; d.pdays += 1
    }
    return Object.keys(byDate).sort().map(date => {
      const d = byDate[date]
      const div = overallMode === 'avg' ? Math.max(d.pdays, 1) : 1
      return {
        date,
        participants: d.pdays,
        screen_time: fmtHM(d.minutes / div),
        minutes: Math.round(d.minutes / div),
        sessions: Math.round(d.sessions / div),
        unlocks: Math.round(d.unlocks / div),
      }
    })
  }, [dailyScoped, isOverall, overallMode])

  // Daily chart rows (date × participant minutes), used when a dataset is daily
  const dailyChart = useMemo(() => {
    const dates = Array.from(new Set(dailyScoped.map(r => r.usage_date))).sort()
    if (!isOverall) {
      return dates.map(date => {
        const m = dailyScoped.find(r => r.usage_date === date)
        return { date, minutes: m ? Math.round(m.screen_on_minutes) : 0 }
      })
    }
    return dailyTableRows.map(r => ({ date: r.date, minutes: (r as { minutes: number }).minutes }))
  }, [dailyScoped, dailyTableRows, isOverall])

  // ── Hourly table export rows (flat) ─────────────────────────────────────────
  const hourlyExportRows = useMemo(() => {
    if (isOverall) {
      return overallByHour.map(r => ({
        hour: r.hour, minutes: r.minutes, mode: overallMode,
      }))
    }
    const rows: Record<string, unknown>[] = []
    for (const date of hourlyDates) {
      for (const h of HOURS) {
        const m = Math.round(hourlyGrid[date][h] || 0)
        if (m > 0) rows.push({ date, hour: `${String(h).padStart(2, '0')}:00`, minutes: m })
      }
    }
    return rows
  }, [isOverall, overallByHour, overallMode, hourlyDates, hourlyGrid])

  // ── Export current view ─────────────────────────────────────────────────────
  function exportCurrent() {
    const who = isOverall ? 'overall' : (pMap[selected] || selected).replace(/\s+/g, '_')
    if (dataset === 'hourly') {
      downloadCSV(buildCSV(hourlyExportRows), `hourly_usage_${who}.csv`)
    } else {
      downloadCSV(buildCSV(dailyTableRows as Record<string, unknown>[]), `daily_usage_${who}.csv`)
    }
  }

  const hasData = dataset === 'hourly'
    ? (isOverall ? overallByHour.some(r => r.minutes > 0) : hourlyDates.length > 0)
    : dailyTableRows.length > 0

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <Link
        href={`/studies/${studyId}`}
        className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors mb-4"
      >
        <ArrowLeft size={14} /> {studyName || 'Study'}
      </Link>

      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <LayoutGrid size={22} className="text-blue-500" />
            <h1 className="text-xl font-semibold text-gray-800">Processed Data</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">Derived datasets computed from raw sensor events.</p>
        </div>

        {/* Participant selector (with All Participants = overall) */}
        {participants.length > 0 && (
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 min-w-56"
          >
            <option value="all">All Participants (overall)</option>
            {participants.map(p => <option key={p.id} value={p.id}>{pName(p)}</option>)}
          </select>
        )}
      </div>

      {/* Dataset pills */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {DATASETS.map(d => (
          <button
            key={d.key}
            onClick={() => setDataset(d.key)}
            className={`px-3.5 py-2 rounded-xl text-sm font-medium transition-colors ${
              dataset === d.key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Toolbar: view toggle + overall mode + export */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-gray-200 overflow-hidden">
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <Table2 size={14} /> Table
            </button>
            <button
              onClick={() => setViewMode('chart')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${viewMode === 'chart' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <BarChart2 size={14} /> Chart
            </button>
          </div>

          {isOverall && (
            <div className="inline-flex rounded-xl border border-gray-200 overflow-hidden">
              <button
                onClick={() => setOverallMode('avg')}
                className={`px-3 py-2 text-sm font-medium ${overallMode === 'avg' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Average
              </button>
              <button
                onClick={() => setOverallMode('sum')}
                className={`px-3 py-2 text-sm font-medium ${overallMode === 'sum' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Sum
              </button>
            </div>
          )}
        </div>

        <button
          onClick={exportCurrent}
          disabled={!hasData}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* States */}
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <div className="flex items-center gap-2 font-medium mb-1"><AlertTriangle size={15} /> Usage views not available</div>
          <p className="text-amber-700">Run <code>migration_2026_10_usage_summary_views.sql</code> in the Supabase SQL editor. ({error})</p>
        </div>
      )}
      {!error && participants.length === 0 && <p className="text-gray-500 text-sm">No participants enrolled yet.</p>}
      {loading && !error && participants.length > 0 && (
        <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      )}
      {!error && !loading && participants.length > 0 && !hasData && (
        <p className="text-gray-500 text-sm">No data for this selection yet.</p>
      )}

      {/* ── HOURLY ────────────────────────────────────────────────────────── */}
      {!error && !loading && hasData && dataset === 'hourly' && (
        isOverall ? (
          viewMode === 'chart' ? (
            <ChartCard title={`Minutes per hour of day — ${overallMode === 'avg' ? 'average per participant-day' : 'total'}`}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={overallByHour} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v} min`, overallMode === 'avg' ? 'Avg' : 'Total']} />
                  <Bar dataKey="minutes" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          ) : (
            <SimpleTable
              headers={['Hour', overallMode === 'avg' ? 'Avg minutes / participant-day' : 'Total minutes']}
              rows={overallByHour.map(r => [r.hour, String(r.minutes)])}
            />
          )
        ) : (
          viewMode === 'chart' ? (
            <ChartCard title="Average minutes per hour of day">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={singleAvgByHour} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v} min`, 'Avg']} />
                  <Bar dataKey="minutes" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          ) : (
            <HeatmapTable grid={hourlyGrid} dates={hourlyDates} />
          )
        )
      )}

      {/* ── DAILY ─────────────────────────────────────────────────────────── */}
      {!error && !loading && hasData && dataset === 'daily' && (
        viewMode === 'chart' ? (
          <ChartCard title={isOverall ? `Daily screen time — ${overallMode === 'avg' ? 'average per participant' : 'total'}` : 'Daily screen time (minutes)'}>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={dailyChart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${v} min`, 'Screen time']} />
                <Bar dataKey="minutes" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        ) : (
          <SimpleTable
            headers={isOverall
              ? ['Date', 'Participants', 'Screen time', 'Minutes', 'Sessions', 'Unlocks']
              : ['Date', 'Screen time', 'Minutes', 'Sessions', 'Avg session', 'Unlocks', 'Capped']}
            rows={dailyTableRows.map(r => isOverall
              ? [r.date, String((r as { participants: number }).participants), (r as { screen_time: string }).screen_time, String((r as { minutes: number }).minutes), String((r as { sessions: number }).sessions), String((r as { unlocks: number }).unlocks)]
              : [r.date, (r as { screen_time: string }).screen_time, String((r as { minutes: number }).minutes), String((r as { sessions: number }).sessions), `${(r as { avg_session_min: number }).avg_session_min}m`, String((r as { unlocks: number }).unlocks), String((r as { capped: number }).capped)])}
          />
        )
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">{title}</h2>
      {children}
    </div>
  )
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              {headers.map(h => <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0">
                {r.map((c, j) => <td key={j} className="px-4 py-2 text-gray-700 whitespace-nowrap">{c}</td>)}
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
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700">Minutes used per hour</h2>
        <span className="text-xs text-gray-400">rows = date · columns = hour (local)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white px-2 py-2 text-left font-medium text-gray-400 z-10">Date</th>
              {HOURS.map(h => <th key={h} className="px-1.5 py-2 text-center font-medium text-gray-400 w-9">{String(h).padStart(2, '0')}</th>)}
              <th className="px-2 py-2 text-right font-medium text-gray-400">Total</th>
            </tr>
          </thead>
          <tbody>
            {dates.map(date => {
              const dayTotal = HOURS.reduce((s, h) => s + (grid[date][h] || 0), 0)
              return (
                <tr key={date}>
                  <td className="sticky left-0 bg-white px-2 py-1 text-gray-600 whitespace-nowrap z-10">
                    {new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </td>
                  {HOURS.map(h => {
                    const m = Math.round(grid[date][h] || 0)
                    return (
                      <td key={h} className="px-0.5 py-0.5 text-center" title={`${date} ${String(h).padStart(2, '0')}:00 — ${m} min`}>
                        <div className="rounded w-8 h-7 flex items-center justify-center mx-auto" style={{ background: cellColor(m), color: cellText(m) }}>
                          {m > 0 ? m : ''}
                        </div>
                      </td>
                    )
                  })}
                  <td className="px-2 py-1 text-right text-gray-700 font-medium whitespace-nowrap">{fmtHM(dayTotal)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
