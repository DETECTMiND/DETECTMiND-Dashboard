'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Clock, Smartphone, Unlock, AlertTriangle, LayoutGrid } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

interface Participant {
  id: string
  label: string | null
  device_id: string
}

interface DailyUsageRow {
  participant_id: string
  usage_date: string
  screen_on_minutes: number
  session_count: number
  avg_session_minutes: number
  unlock_count: number
  capped_sessions: number
}

interface HourlyUsageRow {
  participant_id: string
  usage_date: string
  hour_of_day: number
  screen_on_seconds: number
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function pName(p: Participant) {
  return p.label || p.device_id
}

function fmtHM(totalMinutes: number): string {
  const m = Math.round(totalMinutes)
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h === 0) return `${rem}m`
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}

// Heatmap cell colour by minutes (0–60). Light→dark blue.
function cellColor(minutes: number): string {
  if (minutes <= 0) return 'transparent'
  const t = Math.min(minutes / 60, 1) // 0..1 over an hour
  const light = 92 - t * 55           // 92% → 37% lightness
  return `hsl(217, 85%, ${light}%)`
}

function cellText(minutes: number): string {
  return minutes >= 30 ? '#fff' : '#1e293b'
}

export default function ProcessedDataPage() {
  const params = useParams()
  const studyId = params.id as string
  const supabase = createClient()

  const [studyName, setStudyName] = useState('')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [selected, setSelected] = useState<string>('')
  const [daily, setDaily] = useState<DailyUsageRow[]>([])
  const [hourly, setHourly] = useState<HourlyUsageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load participants + study name once.
  useEffect(() => {
    async function loadMeta() {
      const [{ data: study }, { data: pList }] = await Promise.all([
        supabase.from('studies').select('name').eq('id', studyId).single(),
        supabase.from('participants').select('id, label, device_id').eq('study_id', studyId),
      ])
      if (study) setStudyName(study.name)
      const parts = (pList as Participant[]) || []
      setParticipants(parts)
      setSelected(parts[0]?.id ?? '')
      if (parts.length === 0) setLoading(false)
    }
    loadMeta()
  }, [studyId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load usage for the selected participant.
  useEffect(() => {
    if (!selected) return
    async function load() {
      setLoading(true)
      setError(null)
      const [dailyRes, hourlyRes] = await Promise.all([
        supabase.from('daily_usage').select('*').eq('participant_id', selected).order('usage_date'),
        supabase.from('hourly_usage').select('*').eq('participant_id', selected),
      ])
      if (dailyRes.error || hourlyRes.error) {
        setError((dailyRes.error || hourlyRes.error)!.message)
        setLoading(false)
        return
      }
      setDaily((dailyRes.data as DailyUsageRow[]) || [])
      setHourly((hourlyRes.data as HourlyUsageRow[]) || [])
      setLoading(false)
    }
    load()
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Date × hour grid: { date: { hour: minutes } } ──────────────────────────
  const grid = useMemo(() => {
    const g: Record<string, Record<number, number>> = {}
    for (const r of hourly) {
      if (!g[r.usage_date]) g[r.usage_date] = {}
      g[r.usage_date][r.hour_of_day] = Math.round(r.screen_on_seconds / 60)
    }
    return g
  }, [hourly])

  const dates = useMemo(() => Object.keys(grid).sort(), [grid])

  // ── Average minutes per hour-of-day (across all days) ──────────────────────
  const avgByHour = useMemo(() => {
    const sum: Record<number, number> = {}
    const dayCount = dates.length || 1
    for (const r of hourly) {
      sum[r.hour_of_day] = (sum[r.hour_of_day] || 0) + r.screen_on_seconds / 60
    }
    return HOURS.map(h => ({
      hour: `${String(h).padStart(2, '0')}:00`,
      minutes: Math.round((sum[h] || 0) / dayCount),
    }))
  }, [hourly, dates])

  // ── Totals for the selected participant ────────────────────────────────────
  const totals = useMemo(() => {
    const totalMinutes = daily.reduce((s, r) => s + r.screen_on_minutes, 0)
    const unlocks = daily.reduce((s, r) => s + r.unlock_count, 0)
    const sessions = daily.reduce((s, r) => s + r.session_count, 0)
    const dayCount = daily.length
    return {
      totalMinutes,
      avgPerDay: dayCount > 0 ? totalMinutes / dayCount : 0,
      unlocks,
      sessions,
      dayCount,
    }
  }, [daily])

  const selectedParticipant = participants.find(p => p.id === selected)

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <Link
        href={`/studies/${studyId}`}
        className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors mb-4"
      >
        <ArrowLeft size={14} /> {studyName || 'Study'}
      </Link>

      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <LayoutGrid size={22} className="text-blue-500" />
            <h1 className="text-xl font-semibold text-gray-800">Processed Data</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">Hourly phone usage, derived from screen events.</p>
        </div>

        {participants.length > 0 && (
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 min-w-56"
          >
            {participants.map(p => (
              <option key={p.id} value={p.id}>{pName(p)}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <div className="flex items-center gap-2 font-medium mb-1">
            <AlertTriangle size={15} /> Usage views not available
          </div>
          <p className="text-amber-700">
            Could not read the usage views. Run{' '}
            <code>migration_2026_10_usage_summary_views.sql</code> in the Supabase SQL editor. ({error})
          </p>
        </div>
      )}

      {!error && participants.length === 0 && (
        <p className="text-gray-500 text-sm">No participants enrolled yet.</p>
      )}

      {loading && !error && participants.length > 0 && (
        <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      )}

      {!error && !loading && selectedParticipant && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <SummaryCard icon={<Clock size={16} />} label="Total screen time"
              value={fmtHM(totals.totalMinutes)} sub={`over ${totals.dayCount} day${totals.dayCount === 1 ? '' : 's'}`} />
            <SummaryCard icon={<Smartphone size={16} />} label="Avg per day"
              value={fmtHM(totals.avgPerDay)} sub="screen time" />
            <SummaryCard icon={<Unlock size={16} />} label="Unlocks"
              value={totals.unlocks.toLocaleString()} sub={`${totals.sessions.toLocaleString()} sessions`} />
            <SummaryCard icon={<Clock size={16} />} label="Busiest hour"
              value={(() => {
                const top = [...avgByHour].sort((a, b) => b.minutes - a.minutes)[0]
                return top && top.minutes > 0 ? top.hour : '—'
              })()} sub="avg peak" />
          </div>

          {dates.length === 0 ? (
            <p className="text-gray-500 text-sm">No screen-usage data for this participant yet.</p>
          ) : (
            <>
              {/* Average by hour-of-day chart */}
              <div className="rounded-xl border border-gray-200 bg-white p-4 mb-8">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Average minutes per hour of day</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={avgByHour} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                    <YAxis tick={{ fontSize: 11 }} label={{ value: 'min', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                    <Tooltip formatter={(v) => [`${v} min`, 'Avg']} />
                    <Bar dataKey="minutes" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Date × hour heatmap table */}
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden mb-4">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-700">Minutes used per hour</h2>
                  <span className="text-xs text-gray-400">rows = date · columns = hour (local time)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="text-xs border-collapse">
                    <thead>
                      <tr>
                        <th className="sticky left-0 bg-white px-2 py-2 text-left font-medium text-gray-400 z-10">Date</th>
                        {HOURS.map(h => (
                          <th key={h} className="px-1.5 py-2 text-center font-medium text-gray-400 w-9">
                            {String(h).padStart(2, '0')}
                          </th>
                        ))}
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
                              const m = grid[date][h] || 0
                              return (
                                <td key={h} className="px-0.5 py-0.5 text-center" title={`${date} ${String(h).padStart(2, '0')}:00 — ${m} min`}>
                                  <div
                                    className="rounded w-8 h-7 flex items-center justify-center mx-auto"
                                    style={{ background: cellColor(m), color: cellText(m) }}
                                  >
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
              <p className="text-xs text-gray-400">
                Each cell shows minutes the screen was on during that hour (0–60). Darker = more use.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}

function SummaryCard({
  icon, label, value, sub,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-1.5 text-xs mb-2 text-gray-500">{icon} {label}</div>
      <div className="text-2xl font-semibold text-gray-800">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}
