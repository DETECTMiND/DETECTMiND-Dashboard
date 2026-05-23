'use client'

import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface Participant { id: string; label: string | null; device_id: string }
interface Props {
  data: any[]
  participants: Participant[]
  showParticipant: boolean
  sensorKey: string
}

const DIR_COLORS: Record<string, string> = {
  incoming: '#3b82f6',
  outgoing: '#10b981',
  missed:   '#ef4444',
  sent:     '#10b981',
  received: '#3b82f6',
  unknown:  '#9ca3af',
}

function normaliseDir(v: string | null | undefined): string {
  const s = (v ?? 'unknown').toLowerCase()
  if (s.includes('in') || s.includes('receiv')) return 'incoming'
  if (s.includes('out') || s.includes('sent')) return 'outgoing'
  if (s.includes('miss')) return 'missed'
  return 'unknown'
}

export default function CallsSmsChart({ data, participants, showParticipant, sensorKey }: Props) {
  const isCalls = sensorKey === 'data_calls'
  const timeCol = isCalls ? 'event_time' : 'event_time'

  const directions = useMemo(() => {
    const dirs = new Set<string>()
    for (const r of data) dirs.add(normaliseDir(r.direction))
    return Array.from(dirs)
  }, [data])

  // ── Daily counts ──────────────────────────────────────────────────────────────
  const dailyData = useMemo(() => {
    const map = new Map<string, Record<string, number>>()
    for (const r of data) {
      const t = r.event_time || r.recorded_at
      if (!t) continue
      const date = t.slice(0, 10)
      const dir = normaliseDir(r.direction)
      if (!map.has(date)) map.set(date, {})
      const entry = map.get(date)!
      entry[dir] = (entry[dir] ?? 0) + 1
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, counts]) => ({ date, ...counts }))
  }, [data])

  // ── Hour of day ───────────────────────────────────────────────────────────────
  const hourData = useMemo(() => {
    const buckets: Record<number, Record<string, number>> = {}
    for (let h = 0; h < 24; h++) buckets[h] = {}
    for (const r of data) {
      const t = r.event_time || r.recorded_at
      if (!t) continue
      const h = new Date(t).getHours()
      const dir = normaliseDir(r.direction)
      buckets[h][dir] = (buckets[h][dir] ?? 0) + 1
    }
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, ...buckets[h] }))
  }, [data])

  // ── Duration histogram (calls only) ──────────────────────────────────────────
  const durationBuckets = useMemo(() => {
    if (!isCalls) return []
    const labels = ['<30s', '30s–2m', '2–5m', '5–15m', '15m+']
    const counts = [0, 0, 0, 0, 0]
    for (const r of data) {
      const s = Number(r.duration_seconds ?? 0)
      if (s < 30) counts[0]++
      else if (s < 120) counts[1]++
      else if (s < 300) counts[2]++
      else if (s < 900) counts[3]++
      else counts[4]++
    }
    return labels.map((label, i) => ({ label, count: counts[i] }))
  }, [data, isCalls])

  if (!data.length) return (
    <div className="py-12 text-center text-sm text-gray-400">No {isCalls ? 'call' : 'SMS'} data available.</div>
  )

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Daily {isCalls ? 'Call' : 'SMS'} Count</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={dailyData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {directions.map(dir => (
              <Bar key={dir} dataKey={dir} name={dir.charAt(0).toUpperCase() + dir.slice(1)} fill={DIR_COLORS[dir] ?? '#9ca3af'} maxBarSize={28} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">{isCalls ? 'Calls' : 'SMS'} by Hour of Day</h3>
        <p className="text-[10px] text-gray-400 mb-2">Social rhythm proxy — peak hours reveal communication patterns</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={hourData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="hour" tickFormatter={h => `${h}h`} tick={{ fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={h => `${h}:00`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {directions.map(dir => (
              <Bar key={dir} dataKey={dir} name={dir.charAt(0).toUpperCase() + dir.slice(1)} stackId="a" fill={DIR_COLORS[dir] ?? '#9ca3af'} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {isCalls && durationBuckets.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Call Duration Distribution</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={durationBuckets} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
