'use client'

import { useMemo } from 'react'
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { localDay } from '@/lib/csv'
import type { ChartParticipant as Participant, EsmResponseRow } from './types'
import { C, ChartEmpty, ChartSection, axisLine, axisTick, gridProps, legendStyle, tooltipProps, useElementWidth } from './theme'

interface Props {
  data: EsmResponseRow[]
  participants: Participant[]
  showParticipant: boolean
}

function pName(p: Participant) { return p.label || p.device_id }

const LATENCY_LABELS = ['<1 min', '1–5 min', '5–15 min', '15–30 min', '30–60 min', '>60 min']

export default function EsmChart({ data, participants }: Props) {
  const pMap = useMemo(() => Object.fromEntries(participants.map(p => [p.id, p])), [participants])
  const pIds = useMemo(() => [...new Set(data.map(r => r.participant_id as string))], [data])

  // ── Daily response rate ───────────────────────────────────────────────────────
  const dailyData = useMemo(() => {
    const map = new Map<string, { responded: number; expired: number; pending: number; total: number }>()
    for (const r of data) {
      if (!r.triggered_at) continue
      const date = localDay(r.triggered_at)
      if (!map.has(date)) map.set(date, { responded: 0, expired: 0, pending: 0, total: 0 })
      const entry = map.get(date)!
      entry.total++
      if (r.responded_at && !r.expired) entry.responded++
      else if (r.expired) entry.expired++
      else entry.pending++
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, d]) => ({
        date,
        responded: d.responded,
        expired: d.expired,
        pending: d.pending,
        rate: d.total > 0 ? Math.round((d.responded / d.total) * 100) : 0,
      }))
  }, [data])

  // ── Latency distribution ──────────────────────────────────────────────────────
  const latencyData = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0]
    for (const r of data) {
      if (!r.responded_at || !r.triggered_at) continue
      const mins = (new Date(r.responded_at).getTime() - new Date(r.triggered_at).getTime()) / 60000
      if (mins < 0) continue
      if (mins < 1) counts[0]++
      else if (mins < 5) counts[1]++
      else if (mins < 15) counts[2]++
      else if (mins < 30) counts[3]++
      else if (mins < 60) counts[4]++
      else counts[5]++
    }
    return LATENCY_LABELS.map((label, i) => ({ label, count: counts[i] }))
  }, [data])

  // ── Response timeline (SVG scatter) ──────────────────────────────────────────
  const timelineRows = useMemo(() => {
    const sorted = [...data].sort((a, b) =>
      new Date(a.triggered_at ?? 0).getTime() - new Date(b.triggered_at ?? 0).getTime()
    )
    const times = sorted.map(r => new Date(r.triggered_at ?? 0).getTime()).filter(Boolean)
    const minT = times.length ? Math.min(...times) : 0
    const maxT = times.length ? Math.max(...times) : 1
    const range = maxT - minT || 1

    return { sorted, minT, maxT, range }
  }, [data])

  const [wrapRef, SVG_W] = useElementWidth<HTMLDivElement>()
  const ROW_H = 36
  const LABEL_W = SVG_W < 480 ? 80 : 110
  const AXIS_H = 20
  const svgH = pIds.length * ROW_H + AXIS_H + 8

  function toX(t: number) {
    return LABEL_W + ((t - timelineRows.minT) / timelineRows.range) * (SVG_W - LABEL_W - 16)
  }

  const midnightBounds = useMemo(() => {
    const bounds: { t: number; label: string }[] = []
    const start = new Date(timelineRows.minT)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() + 1)
    while (start.getTime() <= timelineRows.maxT) {
      bounds.push({
        t: start.getTime(),
        label: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      })
      start.setDate(start.getDate() + 1)
    }
    return bounds
  }, [timelineRows])

  const labelEvery = Math.max(1, Math.ceil((midnightBounds.length * 56) / Math.max(1, SVG_W - LABEL_W - 16)))

  function statusColor(r: EsmResponseRow): string {
    if (r.responded_at && !r.expired) return C.green
    if (r.expired) return C.red
    return C.amber
  }

  if (!data.length) return <ChartEmpty>No survey responses available.</ChartEmpty>

  return (
    <div className="space-y-8">
      <ChartSection title="Daily response rate">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={dailyData} margin={{ top: 4, right: 48, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={axisLine} minTickGap={16} />
            <YAxis yAxisId="count" tick={axisTick} tickLine={false} axisLine={false} width={40} />
            <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} unit="%" tick={axisTick} tickLine={false} axisLine={false} width={40} />
            <Tooltip {...tooltipProps} />
            <Legend wrapperStyle={legendStyle} />
            <Bar yAxisId="count" dataKey="responded" name="Responded" stackId="a" fill={C.green} isAnimationActive={false} />
            <Bar yAxisId="count" dataKey="expired" name="Expired" stackId="a" fill={C.red} isAnimationActive={false} />
            <Bar yAxisId="count" dataKey="pending" name="Pending" stackId="a" fill={C.muted} isAnimationActive={false} />
            <Line yAxisId="rate" type="monotone" dataKey="rate" name="Response %" stroke={C.blue} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartSection>

      <ChartSection title="Time to respond" hint="Time from the survey notification to the answer.">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={latencyData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={axisLine} minTickGap={16} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} />
            <Tooltip {...tooltipProps} />
            <Bar dataKey="count" name="Responses" fill={C.green} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartSection>

      <ChartSection title="Response timeline" hint="Each dot is one survey prompt.">
        <div ref={wrapRef} className="w-full">
          <svg width={SVG_W} height={svgH} role="img" aria-label="Survey prompts over time per participant" style={{ display: 'block' }}>
            {pIds.map((pid, rowIdx) => {
              const p = pMap[pid]
              const y = rowIdx * ROW_H
              const rows = timelineRows.sorted.filter(r => r.participant_id === pid)
              return (
                <g key={pid}>
                  <rect x={0} y={y} width={SVG_W} height={ROW_H} fill={rowIdx % 2 === 0 ? C.sunken : 'transparent'} />
                  <text x={LABEL_W - 6} y={y + ROW_H / 2 + 4} textAnchor="end" fontSize={11} fill={C.fg}>
                    {(p ? pName(p) : pid).slice(0, SVG_W < 480 ? 10 : 16)}
                  </text>
                  {midnightBounds.map(b => (
                    <line key={b.t} x1={toX(b.t)} x2={toX(b.t)} y1={y + 4} y2={y + ROW_H - 4} stroke={C.grid} strokeWidth={1} />
                  ))}
                  {rows.map((r, i) => {
                    const t = new Date(r.triggered_at ?? 0).getTime()
                    const x = toX(t)
                    const color = statusColor(r)
                    return (
                      <circle key={i} cx={x} cy={y + ROW_H / 2} r={5} fill={color} opacity={0.85}>
                        <title>{`${new Date(r.triggered_at).toLocaleString()} — ${r.responded_at && !r.expired ? 'responded' : r.expired ? 'expired' : 'pending'}`}</title>
                      </circle>
                    )
                  })}
                </g>
              )
            })}
            <g transform={`translate(0, ${pIds.length * ROW_H})`}>
              {midnightBounds.filter((_, i) => i % labelEvery === 0).map(b => (
                <text key={b.t} x={toX(b.t)} y={AXIS_H - 4} textAnchor="middle" fontSize={10} fill={C.axis}>
                  {b.label}
                </text>
              ))}
            </g>
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted">
          {[[C.green, 'Responded'], [C.red, 'Expired'], [C.amber, 'Pending']].map(([color, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      </ChartSection>
    </div>
  )
}
