'use client'

import React, { useMemo } from 'react'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
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
  const d = new Date(v)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDateTime(v: any): string {
  if (!v) return ''
  const d = new Date(v)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function CustomDot(props: any) {
  const { cx, cy, payload } = props
  if (!payload?.is_charging) return null
  return <circle cx={cx} cy={cy} r={4} fill="#22c55e" stroke="#fff" strokeWidth={1} />
}

interface ChargingPeriod {
  participantId: string
  x1: string
  x2: string
}

export default function BatteryChart({ data, participants, showParticipant }: Props) {
  const participantMap = useMemo(
    () => Object.fromEntries(participants.map((p, i) => [p.id, { ...p, color: PALETTE[i % PALETTE.length] }])),
    [participants]
  )

  const hasTemperature = useMemo(
    () => data.some(row => row.temperature != null && row.temperature !== ''),
    [data]
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

  const chargingPeriods = useMemo<ChargingPeriod[]>(() => {
    const periods: ChargingPeriod[] = []
    const byParticipant: Record<string, any[]> = {}
    for (const row of sortedData) {
      if (!byParticipant[row.participant_id]) byParticipant[row.participant_id] = []
      byParticipant[row.participant_id].push(row)
    }
    for (const [pid, rows] of Object.entries(byParticipant)) {
      let start: string | null = null
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (row.is_charging && start === null) {
          start = row.recorded_at
        } else if (!row.is_charging && start !== null) {
          periods.push({ participantId: pid, x1: start, x2: rows[i - 1].recorded_at })
          start = null
        }
      }
      if (start !== null) {
        periods.push({ participantId: pid, x1: start, x2: rows[rows.length - 1].recorded_at })
      }
    }
    return periods
  }, [sortedData])

  const chartData = useMemo(() => {
    const timeMap = new Map<string, any>()
    for (const row of sortedData) {
      const key = row.recorded_at
      if (!timeMap.has(key)) {
        timeMap.set(key, { recorded_at: key })
      }
      const entry = timeMap.get(key)
      entry[`level_${row.participant_id}`] = row.level
      entry[`is_charging_${row.participant_id}`] = row.is_charging
      if (row.temperature != null) {
        entry[`temp_${row.participant_id}`] = row.temperature
      }
    }
    return Array.from(timeMap.values())
  }, [sortedData])

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1 max-w-xs">
        <p className="font-semibold text-gray-700 mb-1">{formatDateTime(label)}</p>
        {participantIds.map(pid => {
          const p = participantMap[pid]
          const name = p ? participantName(p) : pid
          const levelEntry = payload.find((e: any) => e.dataKey === `level_${pid}`)
          const tempEntry = payload.find((e: any) => e.dataKey === `temp_${pid}`)
          const dataPoint = chartData.find(d => d.recorded_at === label)
          const isCharging = dataPoint?.[`is_charging_${pid}`]
          if (levelEntry == null && tempEntry == null) return null
          return (
            <div key={pid} className="border-t border-gray-100 pt-1 first:border-0 first:pt-0">
              <p className="font-medium text-gray-600">{showParticipant ? name : 'Battery'}</p>
              {levelEntry != null && (
                <p style={{ color: levelEntry.color }}>
                  Level: {levelEntry.value}%{isCharging ? ' ⚡ charging' : ''}
                </p>
              )}
              {tempEntry != null && (
                <p className="text-orange-500">Temp: {tempEntry.value?.toFixed(1)}°C</p>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-80 text-gray-400 text-sm">
        No battery data available
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={chartData} margin={{ top: 8, right: hasTemperature ? 60 : 16, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />

        {chargingPeriods.map((period, i) => (
          <ReferenceArea
            key={i}
            x1={period.x1}
            x2={period.x2}
            fill="#22c55e"
            fillOpacity={0.07}
            strokeOpacity={0}
          />
        ))}

        <XAxis
          dataKey="recorded_at"
          tickFormatter={formatTick}
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={{ stroke: '#e5e7eb' }}
          minTickGap={60}
        />

        <YAxis
          yAxisId="level"
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          label={{ value: 'Level (%)', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11, fill: '#9ca3af' } }}
        />

        {hasTemperature && (
          <YAxis
            yAxisId="temp"
            orientation="right"
            tick={{ fontSize: 11, fill: '#f97316' }}
            tickLine={false}
            axisLine={false}
            label={{ value: 'Temp (°C)', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 11, fill: '#f97316' } }}
          />
        )}

        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />

        {participantIds.map((pid, idx) => {
          const p = participantMap[pid]
          const color = p ? PALETTE[participants.indexOf(p) % PALETTE.length] : PALETTE[idx % PALETTE.length]
          const name = p ? participantName(p) : pid
          return (
            <Line
              key={`level_${pid}`}
              yAxisId="level"
              type="monotone"
              dataKey={`level_${pid}`}
              name={showParticipant ? `${name} – Level` : 'Level (%)'}
              stroke={color}
              strokeWidth={1.5}
              dot={<CustomDot />}
              connectNulls
              isAnimationActive={false}
            />
          )
        })}

        {hasTemperature && participantIds.map((pid, idx) => {
          const p = participantMap[pid]
          const name = p ? participantName(p) : pid
          return (
            <Line
              key={`temp_${pid}`}
              yAxisId="temp"
              type="monotone"
              dataKey={`temp_${pid}`}
              name={showParticipant ? `${name} – Temp` : 'Temp (°C)'}
              stroke="#f97316"
              strokeWidth={1}
              strokeDasharray="4 2"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )
        })}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
