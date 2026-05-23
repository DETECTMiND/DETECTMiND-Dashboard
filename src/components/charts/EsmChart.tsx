'use client'

import { useMemo } from 'react'
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface Participant { id: string; label: string | null; device_id: string }
interface Props {
  data: any[]
  participants: Participant[]
  showParticipant: boolean
}

function pName(p: Participant) { return p.label || p.device_id }

const PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4']
const LATENCY_LABELS = ['<1 min', '1–5 min', '5–15 min', '15–30 min', '30–60 min', '>60 min']

export default function EsmChart({ data, participants, showParticipant }: Props) {
  const pMap = useMemo(() => Object.fromEntries(participants.map(p => [p.id, p])), [participants])
  const pIds = useMemo(() => [...new Set(data.map(r => r.participant_id as string))], [data])

  // ── Daily response rate ───────────────────────────────────────────────────────
  const dailyData = useMemo(() => {
    const map = new Map<string, { responded: number; expired: number; pending: number; total: number }>()
    for (const r of data) {
      const date = (r.triggered_at ?? '').slice(0, 10)
      if (!date) continue
      if (!map.has(date)) map.set(date, { responded: 0, expired: 0, pending: 0, total: 0 })
      const entry = map.get(date)!
      entry.total++
      const status = (r.status ?? '').toLowerCase()
      if (status === 'responded' || r.responded_at) entry.responded++
      else if (status === 'expired' || r.expired_at) entry.expired++
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

  const SVG_W = 800
  const ROW_H = 36
  const LABEL_W = 110
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

  function statusColor(r: any): string {
    const s = (r.status ?? '').toLowerCase()
    if (s === 'responded' || r.responded_at) return '#10b981'
    if (s === 'expired' || r.expired_at) return '#ef4444'
    return '#f59e0b'
  }

  if (!data.length) return (
    <div className="py-12 text-center text-sm text-gray-400">No ESM response data available.</div>
  )

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Daily ESM Response Rate</h3>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={dailyData} margin={{ top: 4, right: 48, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
            <YAxis yAxisId="count" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="count" dataKey="responded" name="Responded" stackId="a" fill="#10b981" isAnimationActive={false} />
            <Bar yAxisId="count" dataKey="expired" name="Expired" stackId="a" fill="#ef4444" isAnimationActive={false} />
            <Bar yAxisId="count" dataKey="pending" name="Pending" stackId="a" fill="#d1d5db" isAnimationActive={false} />
            <Line yAxisId="rate" type="monotone" dataKey="rate" name="Response %" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Response Latency Distribution</h3>
        <p className="text-[10px] text-gray-400 mb-3">Time from ESM trigger to response — shorter = more engaged participants</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={latencyData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip />
            <Bar dataKey="count" name="Responses" fill="#10b981" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">ESM Response Timeline</h3>
        <p className="text-[10px] text-gray-400 mb-3">Each dot = one ESM prompt · green=responded · red=expired · amber=pending</p>
        <div className="overflow-x-auto">
          <svg width={SVG_W} height={svgH} style={{ display: 'block' }}>
            {pIds.map((pid, rowIdx) => {
              const p = pMap[pid]
              const y = rowIdx * ROW_H
              const rows = timelineRows.sorted.filter(r => r.participant_id === pid)
              return (
                <g key={pid}>
                  <rect x={0} y={y} width={SVG_W} height={ROW_H} fill={rowIdx % 2 === 0 ? '#f9fafb' : '#ffffff'} />
                  <text x={LABEL_W - 6} y={y + ROW_H / 2 + 4} textAnchor="end" fontSize={11} fill="#374151" fontFamily="sans-serif">
                    {p ? pName(p) : pid}
                  </text>
                  {midnightBounds.map(b => (
                    <line key={b.t} x1={toX(b.t)} x2={toX(b.t)} y1={y + 4} y2={y + ROW_H - 4} stroke="#e5e7eb" strokeWidth={1} />
                  ))}
                  {rows.map((r, i) => {
                    const t = new Date(r.triggered_at ?? 0).getTime()
                    const x = toX(t)
                    const color = statusColor(r)
                    return (
                      <circle key={i} cx={x} cy={y + ROW_H / 2} r={5} fill={color} opacity={0.85}>
                        <title>{`${new Date(r.triggered_at).toLocaleString()} — ${r.status ?? 'pending'}`}</title>
                      </circle>
                    )
                  })}
                </g>
              )
            })}
            <g transform={`translate(0, ${pIds.length * ROW_H})`}>
              {midnightBounds.map(b => (
                <text key={b.t} x={toX(b.t)} y={AXIS_H - 4} textAnchor="middle" fontSize={10} fill="#6b7280" fontFamily="sans-serif">
                  {b.label}
                </text>
              ))}
            </g>
          </svg>
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
          {[['#10b981', 'Responded'], ['#ef4444', 'Expired'], ['#f59e0b', 'Pending']].map(([color, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
