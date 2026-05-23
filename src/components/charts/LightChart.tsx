'use client'

import React, { useMemo } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface Participant {
  id: string
  label: string | null
  device_id: string
}

interface Props {
  data: any[]
  participants: Participant[]
  showParticipant: boolean
}

const PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4']

function participantName(p: Participant): string {
  return p.label || p.device_id
}

function formatTick(v: any): string {
  if (!v) return ''
  return new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDateTime(v: any): string {
  if (!v) return ''
  return new Date(v).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function LightChart({ data, participants, showParticipant }: Props) {
  const participantMap = useMemo(
    () => Object.fromEntries(participants.map(p => [p.id, p])),
    [participants]
  )

  const participantIds = useMemo(() => {
    const seen = new Set<string>()
    data.forEach(row => seen.add(row.participant_id))
    return Array.from(seen)
  }, [data])

  const sortedData = useMemo(
    () => [...data].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()),
    [data]
  )

  const luxTimeData = useMemo(() => {
    const timeMap = new Map<string, any>()
    for (const row of sortedData) {
      const key = row.recorded_at
      if (!timeMap.has(key)) timeMap.set(key, { recorded_at: key })
      const entry = timeMap.get(key)
      entry[`lux_${row.participant_id}`] = row.lux
    }
    return Array.from(timeMap.values())
  }, [sortedData])

  const hourlyData = useMemo(() => {
    const buckets: Record<string, Record<string, { sum: number; count: number }>> = {}
    for (let h = 0; h < 24; h++) {
      buckets[h] = {}
      for (const pid of participantIds) {
        buckets[h][pid] = { sum: 0, count: 0 }
      }
    }
    for (const row of data) {
      const hour = new Date(row.recorded_at).getHours()
      if (!buckets[hour][row.participant_id]) {
        buckets[hour][row.participant_id] = { sum: 0, count: 0 }
      }
      buckets[hour][row.participant_id].sum += row.lux ?? 0
      buckets[hour][row.participant_id].count += 1
    }
    return Array.from({ length: 24 }, (_, h) => {
      const entry: any = { hour: h }
      for (const pid of participantIds) {
        const b = buckets[h][pid]
        entry[`avg_lux_${pid}`] = b && b.count > 0 ? Math.round(b.sum / b.count) : 0
      }
      return entry
    })
  }, [data, participantIds])

  const LuxTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1">
        <p className="font-semibold text-gray-700 mb-1">{formatDateTime(label)}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ color: entry.color }}>
            {entry.name}: {entry.value?.toLocaleString()} lux
          </p>
        ))}
      </div>
    )
  }

  const HourTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1">
        <p className="font-semibold text-gray-700 mb-1">{`Hour ${label}:00`}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ color: entry.fill }}>
            {entry.name}: {entry.value?.toLocaleString()} lux
          </p>
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-80 text-gray-400 text-sm">
        No light data available
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-2">Lux Over Time</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={luxTimeData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="recorded_at"
              tickFormatter={formatTick}
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
              minTickGap={60}
            />
            <YAxis
              domain={[0, 'auto']}
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              label={{ value: 'Lux', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11, fill: '#9ca3af' } }}
            />
            <Tooltip content={<LuxTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            {participantIds.map((pid, idx) => {
              const p = participantMap[pid]
              const color = PALETTE[idx % PALETTE.length]
              const name = p ? participantName(p) : pid
              return (
                <Line
                  key={`lux_${pid}`}
                  type="monotone"
                  dataKey={`lux_${pid}`}
                  name={showParticipant ? name : 'Lux'}
                  stroke={color}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <p className="text-sm font-semibold text-gray-700 mb-2">Average Lux by Hour of Day</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={hourlyData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis
              dataKey="hour"
              tickFormatter={(v: number) => `${v}h`}
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
              label={{ value: 'Hour of Day', position: 'insideBottom', offset: -4, style: { fontSize: 11, fill: '#9ca3af' } }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              label={{ value: 'Avg Lux', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11, fill: '#9ca3af' } }}
            />
            <Tooltip content={<HourTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            {participantIds.map((pid, idx) => {
              const p = participantMap[pid]
              const color = PALETTE[idx % PALETTE.length]
              const name = p ? participantName(p) : pid
              return (
                <Bar
                  key={`avg_lux_${pid}`}
                  dataKey={`avg_lux_${pid}`}
                  name={showParticipant ? name : 'Avg Lux'}
                  fill={color}
                  maxBarSize={20}
                  isAnimationActive={false}
                />
              )
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
