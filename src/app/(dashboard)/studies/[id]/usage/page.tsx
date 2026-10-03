'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Clock, Smartphone, Unlock, AlertTriangle } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface Participant {
  id: string
  label: string | null
  device_id: string
}

interface DailyUsageRow {
  participant_id: string
  usage_date: string
  screen_on_seconds: number
  screen_on_minutes: number
  screen_on_hours: number
  session_count: number
  avg_session_minutes: number
  unlock_count: number
  capped_sessions: number
}

interface AppUsageRow {
  participant_id: string
  usage_date: string
  package_name: string
  app_name: string
  foreground_seconds: number
  foreground_minutes: number
  open_count: number
}

const PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4']

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

export default function UsagePage() {
  const params = useParams()
  const studyId = params.id as string
  const supabase = createClient()

  const [studyName, setStudyName] = useState('')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [daily, setDaily] = useState<DailyUsageRow[]>([])
  const [apps, setApps] = useState<AppUsageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      const [{ data: study }, { data: pList }] = await Promise.all([
        supabase.from('studies').select('name').eq('id', studyId).single(),
        supabase.from('participants').select('id, label, device_id').eq('study_id', studyId),
      ])
      if (study) setStudyName(study.name)
      const parts = (pList as Participant[]) || []
      setParticipants(parts)

      if (parts.length === 0) {
        setDaily([])
        setApps([])
        setLoading(false)
        return
      }
      const pIds = parts.map(p => p.id)

      const [dailyRes, appsRes] = await Promise.all([
        supabase.from('daily_usage').select('*').in('participant_id', pIds).order('usage_date'),
        supabase.from('daily_app_usage').select('*').in('participant_id', pIds),
      ])

      if (dailyRes.error) {
        // Most likely the views have not been created yet.
        setError(dailyRes.error.message)
        setLoading(false)
        return
      }
      setDaily((dailyRes.data as DailyUsageRow[]) || [])
      setApps((appsRes.data as AppUsageRow[]) || [])
      setLoading(false)
    }
    load()
  }, [studyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const pMap = useMemo(
    () => Object.fromEntries(participants.map(p => [p.id, pName(p)])),
    [participants],
  )

  // ── Per-participant totals ────────────────────────────────────────────────
  const perParticipant = useMemo(() => {
    const acc: Record<string, {
      totalMinutes: number; days: Set<string>; unlocks: number;
      sessions: number; capped: number;
    }> = {}
    for (const r of daily) {
      const a = acc[r.participant_id] ||
        (acc[r.participant_id] = { totalMinutes: 0, days: new Set(), unlocks: 0, sessions: 0, capped: 0 })
      a.totalMinutes += r.screen_on_minutes
      a.days.add(r.usage_date)
      a.unlocks += r.unlock_count
      a.sessions += r.session_count
      a.capped += r.capped_sessions
    }
    return participants.map(p => {
      const a = acc[p.id]
      const dayCount = a ? a.days.size : 0
      return {
        participant: p,
        totalMinutes: a?.totalMinutes ?? 0,
        avgPerDay: a && dayCount > 0 ? a.totalMinutes / dayCount : 0,
        dayCount,
        unlocks: a?.unlocks ?? 0,
        sessions: a?.sessions ?? 0,
        capped: a?.capped ?? 0,
      }
    })
  }, [daily, participants])

  // ── Study-wide summary cards ──────────────────────────────────────────────
  const summary = useMemo(() => {
    const totalMinutes = daily.reduce((s, r) => s + r.screen_on_minutes, 0)
    const totalUnlocks = daily.reduce((s, r) => s + r.unlock_count, 0)
    const totalCapped = daily.reduce((s, r) => s + r.capped_sessions, 0)
    const totalSessions = daily.reduce((s, r) => s + r.session_count, 0)
    const activeParticipants = new Set(daily.map(r => r.participant_id)).size
    // avg per participant-day
    const participantDays = daily.length
    const avgPerDay = participantDays > 0 ? totalMinutes / participantDays : 0
    return { totalMinutes, totalUnlocks, totalCapped, totalSessions, activeParticipants, avgPerDay }
  }, [daily])

  // ── Daily chart data (minutes per participant per date) ───────────────────
  const chartData = useMemo(() => {
    const dates = Array.from(new Set(daily.map(r => r.usage_date))).sort()
    return dates.map(date => {
      const row: { date: string; [pid: string]: number | string } = { date }
      for (const p of participants) {
        const match = daily.find(r => r.usage_date === date && r.participant_id === p.id)
        row[p.id] = match ? Math.round(match.screen_on_minutes) : 0
      }
      return row
    })
  }, [daily, participants])

  // ── Top apps across study ─────────────────────────────────────────────────
  const topApps = useMemo(() => {
    const acc: Record<string, { name: string; minutes: number }> = {}
    for (const r of apps) {
      const a = acc[r.package_name] || (acc[r.package_name] = { name: r.app_name || r.package_name, minutes: 0 })
      a.minutes += r.foreground_minutes
    }
    return Object.values(acc).sort((a, b) => b.minutes - a.minutes).slice(0, 10)
  }, [apps])

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <Link
        href={`/studies/${studyId}`}
        className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors mb-4"
      >
        <ArrowLeft size={14} /> {studyName || 'Study'}
      </Link>

      <div className="flex items-center gap-2 mb-6">
        <Clock size={22} className="text-blue-500" />
        <h1 className="text-xl font-semibold text-gray-800">Phone Usage</h1>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <div className="flex items-center gap-2 font-medium mb-1">
            <AlertTriangle size={15} /> Usage views not available
          </div>
          <p className="text-amber-700">
            Could not read <code>daily_usage</code>. Run{' '}
            <code>migration_2026_10_usage_summary_views.sql</code> in the Supabase SQL editor
            to create the usage views. ({error})
          </p>
        </div>
      )}

      {!error && participants.length === 0 && (
        <p className="text-gray-500 text-sm">No participants enrolled yet.</p>
      )}

      {!error && participants.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <SummaryCard
              icon={<Clock size={16} />}
              label="Total screen time"
              value={fmtHM(summary.totalMinutes)}
              sub={`${summary.activeParticipants} active participant${summary.activeParticipants === 1 ? '' : 's'}`}
            />
            <SummaryCard
              icon={<Smartphone size={16} />}
              label="Avg per day"
              value={fmtHM(summary.avgPerDay)}
              sub="per participant-day"
            />
            <SummaryCard
              icon={<Unlock size={16} />}
              label="Total unlocks"
              value={summary.totalUnlocks.toLocaleString()}
              sub={`${summary.totalSessions.toLocaleString()} sessions`}
            />
            <SummaryCard
              icon={<AlertTriangle size={16} />}
              label="Capped sessions"
              value={summary.totalCapped.toLocaleString()}
              sub="dropped-event estimate"
              muted
            />
          </div>

          {/* Daily chart */}
          {chartData.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 mb-8">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Daily screen time (minutes)</h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend formatter={(v) => pMap[v as string] ?? v} />
                  {participants.map((p, i) => (
                    <Bar key={p.id} dataKey={p.id} stackId="a" fill={PALETTE[i % PALETTE.length]} name={p.id} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Per-participant table */}
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden mb-8">
            <h2 className="text-sm font-semibold text-gray-700 px-4 py-3 border-b border-gray-100">
              Per participant
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-2 font-medium">Participant</th>
                    <th className="px-4 py-2 font-medium">Total</th>
                    <th className="px-4 py-2 font-medium">Avg/day</th>
                    <th className="px-4 py-2 font-medium">Days</th>
                    <th className="px-4 py-2 font-medium">Unlocks</th>
                    <th className="px-4 py-2 font-medium">Sessions</th>
                    <th className="px-4 py-2 font-medium">Capped</th>
                  </tr>
                </thead>
                <tbody>
                  {perParticipant.map(row => (
                    <tr key={row.participant.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2 text-gray-800">{pName(row.participant)}</td>
                      <td className="px-4 py-2 text-gray-700">{fmtHM(row.totalMinutes)}</td>
                      <td className="px-4 py-2 text-gray-700">{fmtHM(row.avgPerDay)}</td>
                      <td className="px-4 py-2 text-gray-500">{row.dayCount}</td>
                      <td className="px-4 py-2 text-gray-500">{row.unlocks}</td>
                      <td className="px-4 py-2 text-gray-500">{row.sessions}</td>
                      <td className="px-4 py-2 text-gray-400">{row.capped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top apps */}
          {topApps.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <h2 className="text-sm font-semibold text-gray-700 px-4 py-3 border-b border-gray-100">
                Top apps (foreground time, study-wide)
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {topApps.map(app => (
                      <tr key={app.name} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2 text-gray-800">{app.name}</td>
                        <td className="px-4 py-2 text-gray-600 text-right">{fmtHM(app.minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SummaryCard({
  icon, label, value, sub, muted,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; muted?: boolean
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className={`flex items-center gap-1.5 text-xs mb-2 ${muted ? 'text-gray-400' : 'text-gray-500'}`}>
        {icon} {label}
      </div>
      <div className={`text-2xl font-semibold ${muted ? 'text-gray-500' : 'text-gray-800'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}
