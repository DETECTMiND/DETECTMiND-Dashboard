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

interface Props {
  data: any[]
  participants: { id: string; label: string | null; device_id: string }[]
  showParticipant: boolean
}

const PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4']

function pName(p: { id: string; label: string | null; device_id: string }) {
  return p.label || p.device_id
}

function toDateStr(iso: string) {
  return iso.slice(0, 10)
}

function computeDailyScreenOn(
  data: any[],
  participants: Props['participants'],
): { date: string; [pid: string]: number | string }[] {
  const byParticipantDate: Record<string, Record<string, { time: number; state: string }[]>> = {}

  for (const row of data) {
    const pid = row.participant_id as string
    const date = toDateStr(row.recorded_at as string)
    const time = new Date(row.recorded_at as string).getTime()
    const state = (row.state as string || '').toLowerCase()
    if (!byParticipantDate[pid]) byParticipantDate[pid] = {}
    if (!byParticipantDate[pid][date]) byParticipantDate[pid][date] = []
    byParticipantDate[pid][date].push({ time, state })
  }

  const allDates = Array.from(
    new Set(data.map(r => toDateStr(r.recorded_at as string)))
  ).sort()

  return allDates.map(date => {
    const row: { date: string; [pid: string]: number | string } = { date }
    for (const p of participants) {
      const events = byParticipantDate[p.id]?.[date] ?? []
      events.sort((a, b) => a.time - b.time)
      let minutes = 0
      let onTime: number | null = null
      for (const ev of events) {
        if (ev.state === 'on' || ev.state === 'unlocked') {
          if (onTime === null) onTime = ev.time
        } else if (ev.state === 'off' || ev.state === 'locked') {
          if (onTime !== null) {
            minutes += (ev.time - onTime) / 60000
            onTime = null
          }
        }
      }
      row[p.id] = Math.round(minutes)
    }
    return row
  })
}

interface TooltipPayload {
  color: string
  name: string
  value: number
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
  participants: Props['participants']
}

function CustomTooltip({ active, payload, label, participants }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const pMap = Object.fromEntries(participants.map(p => [p.id, pName(p)]))
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map(entry => (
        <p key={entry.name} style={{ color: entry.color }}>
          {pMap[entry.name] ?? entry.name}: {entry.value} min
        </p>
      ))}
    </div>
  )
}

function ActogramStrip({ data, participants }: { data: any[]; participants: Props['participants'] }) {
  const SVG_WIDTH = 900
  const ROW_HEIGHT = 48
  const LABEL_WIDTH = 110
  const TICK_H = 28
  const AXIS_H = 20
  const PADDING_TOP = 4

  const sorted = [...data].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  )

  const times = sorted.map(r => new Date(r.recorded_at).getTime())
  const minTime = times.length > 0 ? Math.min(...times) : Date.now()
  const maxTime = times.length > 0 ? Math.max(...times) : Date.now() + 86400000

  const range = maxTime - minTime || 1

  function toX(t: number) {
    return LABEL_WIDTH + ((t - minTime) / range) * (SVG_WIDTH - LABEL_WIDTH - 8)
  }

  const midnightBoundaries: { t: number; label: string }[] = []
  const startDay = new Date(minTime)
  startDay.setHours(0, 0, 0, 0)
  startDay.setDate(startDay.getDate() + 1)
  while (startDay.getTime() <= maxTime) {
    midnightBoundaries.push({
      t: startDay.getTime(),
      label: startDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    })
    startDay.setDate(startDay.getDate() + 1)
  }

  function stateColor(state: string) {
    const s = (state || '').toLowerCase()
    if (s === 'on' || s === 'unlocked') return '#22c55e'
    if (s === 'off' || s === 'locked') return '#9ca3af'
    return '#f59e0b'
  }

  const svgHeight = PADDING_TOP + participants.length * ROW_HEIGHT + AXIS_H

  return (
    <div className="overflow-x-auto mt-4">
      <svg width={SVG_WIDTH} height={svgHeight} style={{ display: 'block' }}>
        {participants.map((p, idx) => {
          const y = PADDING_TOP + idx * ROW_HEIGHT
          const rows = sorted.filter(r => r.participant_id === p.id)
          return (
            <g key={p.id}>
              <rect
                x={0}
                y={y}
                width={SVG_WIDTH}
                height={ROW_HEIGHT}
                fill={idx % 2 === 0 ? '#f9fafb' : '#ffffff'}
              />
              <text
                x={LABEL_WIDTH - 6}
                y={y + ROW_HEIGHT / 2 + 4}
                textAnchor="end"
                fontSize={11}
                fill="#374151"
                fontFamily="sans-serif"
              >
                {pName(p)}
              </text>
              {midnightBoundaries.map(b => (
                <line
                  key={b.t}
                  x1={toX(b.t)}
                  x2={toX(b.t)}
                  y1={y + 2}
                  y2={y + ROW_HEIGHT - 2}
                  stroke="#e5e7eb"
                  strokeWidth={1}
                />
              ))}
              {rows.map((r, i) => {
                const t = new Date(r.recorded_at).getTime()
                const x = toX(t)
                const color = stateColor(r.state)
                const tickY = y + (ROW_HEIGHT - TICK_H) / 2
                return (
                  <rect
                    key={i}
                    x={x - 1}
                    y={tickY}
                    width={2}
                    height={TICK_H}
                    fill={color}
                    opacity={0.8}
                  />
                )
              })}
            </g>
          )
        })}
        <g>
          {midnightBoundaries.map(b => {
            const x = toX(b.t)
            return (
              <text
                key={b.t}
                x={x}
                y={PADDING_TOP + participants.length * ROW_HEIGHT + AXIS_H - 4}
                textAnchor="middle"
                fontSize={10}
                fill="#6b7280"
                fontFamily="sans-serif"
              >
                {b.label}
              </text>
            )
          })}
        </g>
        <line
          x1={LABEL_WIDTH}
          x2={SVG_WIDTH - 4}
          y1={PADDING_TOP + participants.length * ROW_HEIGHT}
          y2={PADDING_TOP + participants.length * ROW_HEIGHT}
          stroke="#e5e7eb"
          strokeWidth={1}
        />
      </svg>
      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 pl-2">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#22c55e' }} />
          on / unlocked
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#9ca3af' }} />
          off / locked
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#f59e0b' }} />
          other
        </span>
      </div>
    </div>
  )
}

export default function ScreenStateChart({ data, participants, showParticipant }: Props) {
  const barData = useMemo(() => computeDailyScreenOn(data, participants), [data, participants])

  if (data.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400">No screen state data available.</div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Daily Screen-On Duration</h3>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickLine={false}
                axisLine={false}
                unit=" min"
                width={56}
              />
              <Tooltip
                content={<CustomTooltip participants={participants} />}
              />
              {showParticipant && participants.length > 1 && (
                <Legend
                  iconType="square"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value) => {
                    const p = participants.find(x => x.id === value)
                    return p ? pName(p) : value
                  }}
                />
              )}
              {participants.map((p, i) => (
                <Bar
                  key={p.id}
                  dataKey={p.id}
                  name={p.id}
                  fill={PALETTE[i % PALETTE.length]}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={32}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Event Actogram</h3>
        <ActogramStrip data={data} participants={participants} />
      </div>
    </div>
  )
}
