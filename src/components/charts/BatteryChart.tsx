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
import type { BatteryRow, ChartParticipant as Participant, ChartPoint, InjectedTooltipProps } from './types'
import { C, TooltipBox, axisLine, axisTick, gridProps, legendStyle, seriesColor } from './theme'

interface Props {
  data: BatteryRow[]
  participants: Participant[]
  showParticipant: boolean
}

function participantName(p: Participant): string {
  return p.label || p.device_id
}

function formatTick(v: string | number): string {
  if (!v) return ''
  const d = new Date(v)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDateTime(v: string | number | undefined): string {
  if (!v) return ''
  const d = new Date(v)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function CustomDot(props: { cx?: number; cy?: number; payload?: ChartPoint }) {
  const { cx, cy, payload } = props
  if (!payload?.is_charging) return null
  return <circle cx={cx} cy={cy} r={4} fill={C.green} stroke={C.surface} strokeWidth={1} />
}

interface ChargingPeriod {
  participantId: string
  x1: string
  x2: string
}

interface BatteryTooltipProps extends InjectedTooltipProps {
  participantIds: string[]
  participantMap: Record<string, Participant>
  chartData: ChartPoint[]
  showParticipant: boolean
}

function BatteryTooltip({ active, payload, label, participantIds, participantMap, chartData, showParticipant }: BatteryTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <TooltipBox>
      <p className="mb-1 font-semibold">{formatDateTime(label)}</p>
      {participantIds.map(pid => {
        const p = participantMap[pid]
        const name = p ? participantName(p) : pid
        const levelEntry = payload.find(e => e.dataKey === `level_${pid}`)
        const tempEntry = payload.find(e => e.dataKey === `temp_${pid}`)
        const dataPoint = chartData.find(d => d.recorded_at === label)
        const isCharging = dataPoint?.[`is_charging_${pid}`]
        if (levelEntry == null && tempEntry == null) return null
        return (
          <div key={pid} className="border-t border-line pt-1 first:border-0 first:pt-0">
            <p className="font-medium text-muted">{showParticipant ? name : 'Battery'}</p>
            {levelEntry != null && (
              <p style={{ color: levelEntry.color }}>
                Level: {levelEntry.value}%{isCharging ? ' ⚡ charging' : ''}
              </p>
            )}
            {tempEntry != null && (
              <p style={{ color: C.amber }}>Temp: {Number(tempEntry.value).toFixed(1)}°C</p>
            )}
          </div>
        )
      })}
    </TooltipBox>
  )
}

export default function BatteryChart({ data, participants, showParticipant }: Props) {
  const participantMap = useMemo(
    () => Object.fromEntries(participants.map((p, i) => [p.id, { ...p, color: seriesColor(i) }])),
    [participants]
  )

  const hasTemperature = useMemo(
    () => data.some(row => row.temperature != null),
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
    const byParticipant: Record<string, BatteryRow[]> = {}
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
    const timeMap = new Map<string, ChartPoint>()
    for (const row of sortedData) {
      const key = row.recorded_at
      let entry = timeMap.get(key)
      if (!entry) {
        entry = { recorded_at: key }
        timeMap.set(key, entry)
      }
      entry[`level_${row.participant_id}`] = row.level
      entry[`is_charging_${row.participant_id}`] = row.is_charging
      if (row.temperature != null) {
        entry[`temp_${row.participant_id}`] = row.temperature
      }
    }
    return Array.from(timeMap.values())
  }, [sortedData])

  if (data.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center text-sm text-subtle">
        No battery data available
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={chartData} margin={{ top: 8, right: hasTemperature ? 60 : 16, bottom: 8, left: 8 }}>
        <CartesianGrid {...gridProps} />

        {chargingPeriods.map((period, i) => (
          <ReferenceArea
            key={i}
            x1={period.x1}
            x2={period.x2}
            fill={C.green}
            fillOpacity={0.07}
            strokeOpacity={0}
          />
        ))}

        <XAxis
          dataKey="recorded_at"
          tickFormatter={formatTick}
          tick={axisTick}
          tickLine={false}
          axisLine={axisLine}
          minTickGap={60}
        />

        <YAxis
          yAxisId="level"
          domain={[0, 100]}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          label={{ value: 'Level (%)', angle: -90, position: 'insideLeft', offset: 10, style: axisTick }}
        />

        {hasTemperature && (
          <YAxis
            yAxisId="temp"
            orientation="right"
            tick={{ fontSize: 11, fill: C.amber }}
            tickLine={false}
            axisLine={false}
            label={{ value: 'Temp (°C)', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 11, fill: C.amber } }}
          />
        )}

        <Tooltip content={<BatteryTooltip participantIds={participantIds} participantMap={participantMap} chartData={chartData} showParticipant={showParticipant} />} />
        <Legend wrapperStyle={legendStyle} />

        {participantIds.map((pid, idx) => {
          const p = participantMap[pid]
          const color = p ? p.color : seriesColor(idx)
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

        {hasTemperature && participantIds.map(pid => {
          const p = participantMap[pid]
          const name = p ? participantName(p) : pid
          return (
            <Line
              key={`temp_${pid}`}
              yAxisId="temp"
              type="monotone"
              dataKey={`temp_${pid}`}
              name={showParticipant ? `${name} – Temp` : 'Temp (°C)'}
              stroke={C.amber}
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
