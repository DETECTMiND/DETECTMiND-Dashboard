'use client'

import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { localDay } from '@/lib/csv'
import type { CallSmsRow, ChartParticipant as Participant } from './types'
import { C, ChartEmpty, ChartSection, axisLine, axisTick, gridProps, legendStyle, tooltipProps } from './theme'

interface Props {
  data: CallSmsRow[]
  participants: Participant[]
  showParticipant: boolean
  sensorKey: string
}

const DIR_COLORS: Record<string, string> = {
  incoming: C.blue,
  outgoing: C.green,
  missed: C.red,
  unknown: C.muted,
}

const DIR_LABELS: Record<string, string> = { incoming: 'Incoming', outgoing: 'Outgoing', missed: 'Missed', unknown: 'Unknown' }

function normaliseDir(v: string | null | undefined): string {
  const s = (v ?? '').toLowerCase()
  if (s === 'incoming' || s === 'outgoing' || s === 'missed') return s
  if (s.startsWith('miss')) return 'missed'
  if (s.startsWith('out') || s === 'sent') return 'outgoing'
  if (s.startsWith('in') || s.startsWith('receiv')) return 'incoming'
  return 'unknown'
}

export default function CallsSmsChart({ data, sensorKey }: Props) {
  const isCalls = sensorKey === 'data_calls'
  const noun = isCalls ? 'call' : 'SMS'

  const directions = useMemo(() => {
    const dirs = new Set<string>()
    for (const r of data) dirs.add(normaliseDir(r.direction))
    return ['incoming', 'outgoing', 'missed', 'unknown'].filter(d => dirs.has(d))
  }, [data])

  const dailyData = useMemo(() => {
    const map = new Map<string, Record<string, number>>()
    for (const r of data) {
      const t = r.event_time || r.recorded_at
      if (!t) continue
      const date = localDay(t)
      const dir = normaliseDir(r.direction)
      if (!map.has(date)) map.set(date, {})
      const entry = map.get(date)!
      entry[dir] = (entry[dir] ?? 0) + 1
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, counts]) => ({ date, ...counts }))
  }, [data])

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

  if (!data.length) return <ChartEmpty>No {noun} data available.</ChartEmpty>

  return (
    <div className="space-y-8">
      <ChartSection title={`${isCalls ? 'Calls' : 'SMS'} per day`}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={dailyData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={axisLine} minTickGap={24} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
            <Tooltip {...tooltipProps} />
            <Legend wrapperStyle={legendStyle} />
            {directions.map(dir => (
              <Bar key={dir} dataKey={dir} name={DIR_LABELS[dir]} fill={DIR_COLORS[dir]} maxBarSize={28} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartSection>

      <ChartSection title={`${isCalls ? 'Calls' : 'SMS'} by hour of day`} hint="Peak hours show when the participant communicates most.">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={hourData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="hour" tickFormatter={h => `${h}h`} tick={axisTick} tickLine={false} axisLine={axisLine} minTickGap={8} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
            <Tooltip {...tooltipProps} labelFormatter={h => `${h}:00`} />
            <Legend wrapperStyle={legendStyle} />
            {directions.map(dir => (
              <Bar key={dir} dataKey={dir} name={DIR_LABELS[dir]} stackId="a" fill={DIR_COLORS[dir]} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartSection>

      {isCalls && durationBuckets.length > 0 && (
        <ChartSection title="Call duration">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={durationBuckets} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid {...gridProps} vertical={false} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={axisLine} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="count" name="Calls" fill={C.blue} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      )}
    </div>
  )
}
