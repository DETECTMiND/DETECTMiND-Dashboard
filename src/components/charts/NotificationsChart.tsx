'use client'

import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { localDay } from '@/lib/csv'
import type { ChartParticipant, NotificationRow } from './types'
import { C, ChartEmpty, ChartSection, axisLine, axisTick, gridProps, intensity, tooltipProps, useElementWidth } from './theme'

interface Props {
  data: NotificationRow[]
  participants: ChartParticipant[]
  showParticipant: boolean
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function shortDay(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function NotificationsChart({ data }: Props) {
  const spanDays = useMemo(() => {
    if (!data.length) return 0
    const times = data.map(r => new Date(r.posted_at).getTime())
    return (Math.max(...times) - Math.min(...times)) / 86400000
  }, [data])

  // Day × hour counts: exact local dates for up to two weeks, else averaged per weekday
  const { heatmap, xKeys, xLabels } = useMemo(() => {
    const exact = spanDays <= 14
    const cells: Record<string, number[]> = {}
    for (const r of data) {
      const d = new Date(r.posted_at)
      const key = exact ? localDay(d) : WEEKDAYS[(d.getDay() + 6) % 7]
      ;(cells[key] ||= new Array(24).fill(0))[d.getHours()]++
    }
    const keys = exact ? Object.keys(cells).sort() : WEEKDAYS
    if (!exact) {
      const weeks = Math.max(1, Math.ceil(spanDays / 7))
      for (const k of keys) cells[k] = (cells[k] || new Array(24).fill(0)).map(v => Math.round(v / weeks))
    }
    return { heatmap: cells, xKeys: keys, xLabels: exact ? keys.map(shortDay) : keys }
  }, [data, spanDays])

  const heatmapMax = useMemo(() => {
    let max = 0
    for (const k of xKeys) for (const v of heatmap[k] ?? []) if (v > max) max = v
    return max || 1
  }, [heatmap, xKeys])

  const topApps = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of data) {
      const app = r.app_name || r.package_name || 'Unknown'
      map.set(app, (map.get(app) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([app, count]) => ({ app, count }))
  }, [data])

  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const labelW = 36
  const cellW = Math.max(14, (width - labelW) / Math.max(xKeys.length, 1))
  const cellH = 18
  const xAxisH = 18
  const svgW = Math.max(width, labelW + xKeys.length * cellW)
  const svgH = 24 * cellH + xAxisH
  const labelEvery = Math.max(1, Math.ceil(44 / cellW))

  if (!data.length) return <ChartEmpty>No notification data available.</ChartEmpty>

  return (
    <div className="space-y-8">
      <ChartSection title="Notifications by day and hour"
        hint={spanDays <= 14 ? 'Darker cells mean more notifications.' : 'Averaged per weekday. Darker cells mean more notifications.'}>
        <div ref={wrapRef} className="w-full overflow-x-auto">
          <svg width={svgW} height={svgH} role="img" aria-label="Heatmap of notifications by day and hour" style={{ display: 'block' }}>
            {Array.from({ length: 24 }, (_, h) => (
              <g key={h} transform={`translate(0, ${h * cellH})`}>
                {h % 3 === 0 && (
                  <text x={labelW - 4} y={cellH / 2} textAnchor="end" dominantBaseline="middle" fontSize={9} fill={C.axis}>{h}h</text>
                )}
                {xKeys.map((xk, xi) => {
                  const v = heatmap[xk]?.[h] ?? 0
                  const amount = v / heatmapMax
                  return (
                    <g key={xk}>
                      <rect x={labelW + xi * cellW + 1} y={1} width={Math.max(1, cellW - 2)} height={cellH - 2} rx={2}
                        fill={v > 0 ? intensity(C.blue, 0.12 + 0.88 * amount) : C.sunken}>
                        <title>{`${xLabels[xi]} ${h}:00: ${v} notification${v === 1 ? '' : 's'}`}</title>
                      </rect>
                      {v > 0 && cellW >= 28 && (
                        <text x={labelW + xi * cellW + cellW / 2} y={cellH / 2} textAnchor="middle" dominantBaseline="middle"
                          fontSize={8} fill={amount > 0.5 ? '#fff' : C.fg} pointerEvents="none">{v}</text>
                      )}
                    </g>
                  )
                })}
              </g>
            ))}
            <g transform={`translate(0, ${24 * cellH})`}>
              {xKeys.map((xk, xi) => xi % labelEvery === 0 ? (
                <text key={xk} x={labelW + xi * cellW + cellW / 2} y={xAxisH - 4} textAnchor="middle" fontSize={9} fill={C.axis}>
                  {xLabels[xi]}
                </text>
              ) : null)}
            </g>
          </svg>
        </div>
      </ChartSection>

      <ChartSection title="Top notification sources">
        <ResponsiveContainer width="100%" height={Math.max(180, topApps.length * 28)}>
          <BarChart layout="vertical" data={topApps} margin={{ top: 4, right: 24, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} horizontal={false} />
            <XAxis type="number" tick={axisTick} axisLine={axisLine} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="app" width={width < 480 ? 100 : 150} tick={axisTick} axisLine={false} tickLine={false}
              tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 19) + '…' : v} />
            <Tooltip {...tooltipProps} formatter={v => [v, 'Notifications']} />
            <Bar dataKey="count" fill={C.blue} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartSection>
    </div>
  )
}
