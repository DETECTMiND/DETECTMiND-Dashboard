'use client'

import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { localDay } from '@/lib/csv'
import type { ChartParticipant, ScreenStateRow } from './types'
import { C, ChartEmpty, ChartSection, TooltipBox, axisLine, axisTick, gridProps, legendStyle, seriesColor, useElementWidth } from './theme'

interface Props {
  data: ScreenStateRow[]
  participants: ChartParticipant[]
  showParticipant: boolean
}

function pName(p: ChartParticipant) {
  return p.label || p.device_id
}

const isOn = (s: string) => s === 'on' || s === 'unlocked'
const isOff = (s: string) => s === 'off' || s === 'locked'

function computeDailyScreenOn(data: ScreenStateRow[], participants: ChartParticipant[]) {
  const byParticipantDate: Record<string, Record<string, { time: number; state: string }[]>> = {}
  for (const row of data) {
    const pid = row.participant_id
    const date = localDay(row.recorded_at)
    const time = new Date(row.recorded_at).getTime()
    const state = (row.state || '').toLowerCase()
    ;((byParticipantDate[pid] ||= {})[date] ||= []).push({ time, state })
  }
  const allDates = Array.from(new Set(data.map(r => localDay(r.recorded_at)))).sort()
  return allDates.map(date => {
    const row: Record<string, number | string> = { date }
    for (const p of participants) {
      const events = byParticipantDate[p.id]?.[date] ?? []
      events.sort((a, b) => a.time - b.time)
      let minutes = 0
      let onTime: number | null = null
      for (const ev of events) {
        if (isOn(ev.state)) {
          if (onTime === null) onTime = ev.time
        } else if (isOff(ev.state) && onTime !== null) {
          minutes += (ev.time - onTime) / 60000
          onTime = null
        }
      }
      row[p.id] = Math.round(minutes)
    }
    return row
  })
}

interface TooltipPayload { color: string; name: string; value: number }

function ScreenTooltip({ active, payload, label, names }: {
  active?: boolean; payload?: TooltipPayload[]; label?: string; names: Record<string, string>
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <TooltipBox>
      <p className="mb-1 font-semibold">{label}</p>
      {payload.map(entry => (
        <p key={entry.name} style={{ color: entry.color }}>{names[entry.name] ?? entry.name}: {entry.value} min</p>
      ))}
    </TooltipBox>
  )
}

function stateColor(state: string) {
  const s = (state || '').toLowerCase()
  if (isOn(s)) return C.green
  if (isOff(s)) return C.muted
  return C.amber
}

function ActogramStrip({ data, participants }: { data: ScreenStateRow[]; participants: ChartParticipant[] }) {
  const [wrapRef, SVG_WIDTH] = useElementWidth<HTMLDivElement>()
  const ROW_HEIGHT = 40
  const LABEL_WIDTH = SVG_WIDTH < 480 ? 80 : 110
  const TICK_H = 24
  const AXIS_H = 20
  const PADDING_TOP = 4

  const sorted = useMemo(() => [...data].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()), [data])
  const times = sorted.map(r => new Date(r.recorded_at).getTime())
  const minTime = times.length > 0 ? times[0] : 0
  const maxTime = times.length > 0 ? times[times.length - 1] : 86400000
  const range = maxTime - minTime || 1
  const toX = (t: number) => LABEL_WIDTH + ((t - minTime) / range) * (SVG_WIDTH - LABEL_WIDTH - 8)

  const midnights: { t: number; label: string }[] = []
  const day = new Date(minTime)
  day.setHours(0, 0, 0, 0)
  day.setDate(day.getDate() + 1)
  while (day.getTime() <= maxTime) {
    midnights.push({ t: day.getTime(), label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) })
    day.setDate(day.getDate() + 1)
  }
  const labelEvery = Math.max(1, Math.ceil((midnights.length * 56) / Math.max(1, SVG_WIDTH - LABEL_WIDTH)))
  const svgHeight = PADDING_TOP + participants.length * ROW_HEIGHT + AXIS_H
  const baseY = PADDING_TOP + participants.length * ROW_HEIGHT

  return (
    <div ref={wrapRef} className="w-full">
      <svg width={SVG_WIDTH} height={svgHeight} role="img" aria-label="Screen on and off events over time" style={{ display: 'block' }}>
        {participants.map((p, idx) => {
          const y = PADDING_TOP + idx * ROW_HEIGHT
          return (
            <g key={p.id}>
              <rect x={0} y={y} width={SVG_WIDTH} height={ROW_HEIGHT} fill={idx % 2 === 0 ? C.sunken : 'transparent'} />
              <text x={LABEL_WIDTH - 6} y={y + ROW_HEIGHT / 2 + 4} textAnchor="end" fontSize={11} fill={C.fg}>
                {pName(p).slice(0, SVG_WIDTH < 480 ? 10 : 16)}
              </text>
              {midnights.map(b => (
                <line key={b.t} x1={toX(b.t)} x2={toX(b.t)} y1={y + 2} y2={y + ROW_HEIGHT - 2} stroke={C.grid} strokeWidth={1} />
              ))}
              {sorted.filter(r => r.participant_id === p.id).map((r, i) => (
                <rect key={i} x={toX(new Date(r.recorded_at).getTime()) - 1} y={y + (ROW_HEIGHT - TICK_H) / 2} width={2} height={TICK_H}
                  fill={stateColor(r.state)} opacity={0.85} />
              ))}
            </g>
          )
        })}
        {midnights.filter((_, i) => i % labelEvery === 0).map(b => (
          <text key={b.t} x={toX(b.t)} y={baseY + AXIS_H - 4} textAnchor="middle" fontSize={10} fill={C.axis}>{b.label}</text>
        ))}
        <line x1={LABEL_WIDTH} x2={SVG_WIDTH - 4} y1={baseY} y2={baseY} stroke={C.grid} strokeWidth={1} />
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted">
        {[[C.green, 'On / unlocked'], [C.muted, 'Off / locked'], [C.amber, 'Other']].map(([color, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function ScreenStateChart({ data, participants, showParticipant }: Props) {
  // Only participants that have rows in this range
  const present = useMemo(() => {
    const ids = new Set(data.map(r => r.participant_id))
    const known = participants.filter(p => ids.has(p.id))
    const unknown = [...ids].filter(id => !participants.some(p => p.id === id)).map(id => ({ id, label: null, device_id: id }))
    return [...known, ...unknown]
  }, [data, participants])
  const names = useMemo(() => Object.fromEntries(present.map(p => [p.id, pName(p)])), [present])
  const barData = useMemo(() => computeDailyScreenOn(data, present), [data, present])

  if (data.length === 0) return <ChartEmpty>No screen state data available.</ChartEmpty>

  return (
    <div className="space-y-8">
      <ChartSection title="Screen-on time per day">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={barData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={axisLine} minTickGap={24} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} unit=" min" width={56} />
            <Tooltip content={<ScreenTooltip names={names} />} cursor={{ fill: 'var(--surface-sunken)', opacity: 0.6 }} />
            {showParticipant && present.length > 1 && (
              <Legend iconType="square" iconSize={8} wrapperStyle={legendStyle} formatter={value => names[value] ?? value} />
            )}
            {present.map((p, i) => (
              <Bar key={p.id} dataKey={p.id} name={p.id} fill={seriesColor(i)} radius={[2, 2, 0, 0]} maxBarSize={32} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartSection>

      <ChartSection title="Screen events over time" hint="Each tick is one screen event.">
        <ActogramStrip data={data} participants={present} />
      </ChartSection>
    </div>
  )
}
