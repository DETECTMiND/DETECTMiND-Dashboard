'use client'

import { useMemo } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import { localDay } from '@/lib/csv'
import type { AppUsageRow, ChartPoint, ChartParticipant } from './types'
import { C, ChartEmpty, ChartSection, axisLine, axisTick, gridProps, intensity, legendStyle, seriesColor, tooltipProps, useElementWidth } from './theme'

interface Props {
  data: AppUsageRow[]
  participants: ChartParticipant[]
  showParticipant: boolean
}

function getDurationMs(row: AppUsageRow): number {
  if (row.duration_seconds != null) return Number(row.duration_seconds) * 1000
  if (row.start_time && row.end_time) {
    return new Date(row.end_time).getTime() - new Date(row.start_time).getTime()
  }
  return 0
}

export default function AppUsageChart({ data }: Props) {
  const appTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of data) {
      const app = row.app_name ?? row.package_name ?? 'Unknown'
      map.set(app, (map.get(app) ?? 0) + getDurationMs(row))
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([app, ms]) => ({ app, minutes: Math.round(ms / 60000) }))
  }, [data])

  const totalMinutes = useMemo(() => appTotals.reduce((s, r) => s + r.minutes, 0), [appTotals])
  const top8Apps = useMemo(() => appTotals.slice(0, 8).map(r => r.app), [appTotals])

  const dailyData = useMemo(() => {
    const dateAppMap = new Map<string, Map<string, number>>()
    for (const row of data) {
      if (!row.start_time) continue
      const date = localDay(row.start_time)
      const rawApp = row.app_name ?? row.package_name ?? 'Unknown'
      const app = top8Apps.includes(rawApp) ? rawApp : 'Other'
      if (!dateAppMap.has(date)) dateAppMap.set(date, new Map())
      const inner = dateAppMap.get(date)!
      inner.set(app, (inner.get(app) ?? 0) + getDurationMs(row))
    }
    return Array.from(dateAppMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, inner]) => {
        const entry: ChartPoint = { date }
        for (const app of [...top8Apps, 'Other']) entry[app] = Math.round((inner.get(app) ?? 0) / 60000)
        return entry
      })
  }, [data, top8Apps])

  const heatmapData = useMemo(() => {
    const sums = new Map<string, number[]>()
    const counts = new Map<string, number[]>()
    for (const app of top8Apps) {
      sums.set(app, new Array(24).fill(0))
      counts.set(app, new Array(24).fill(0))
    }
    for (const row of data) {
      if (!row.start_time) continue
      const rawApp = row.app_name ?? row.package_name ?? 'Unknown'
      if (!top8Apps.includes(rawApp)) continue
      const hour = new Date(row.start_time).getHours()
      sums.get(rawApp)![hour] += getDurationMs(row) / 60000
      counts.get(rawApp)![hour] += 1
    }
    return top8Apps.map(app => ({
      app,
      hours: sums.get(app)!.map((s, i) => (counts.get(app)![i] > 0 ? s / counts.get(app)![i] : 0)),
    }))
  }, [data, top8Apps])

  const heatmapMax = useMemo(() => {
    let max = 0
    for (const row of heatmapData) for (const v of row.hours) if (v > max) max = v
    return max || 1
  }, [heatmapData])

  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const labelW = width < 480 ? 84 : 112
  const cellW = Math.max(8, (width - labelW) / 24)
  const cellH = 22
  const xAxisH = 20
  const svgH = heatmapData.length * cellH + xAxisH
  const maxChars = labelW < 100 ? 10 : 14

  if (!data.length) return <ChartEmpty>No app usage data available.</ChartEmpty>

  return (
    <div className="flex flex-col gap-8">
      <ChartSection title="Top apps by usage time">
        <ResponsiveContainer width="100%" height={Math.max(160, appTotals.length * 22)}>
          <BarChart layout="vertical" data={appTotals} margin={{ top: 4, right: 24, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} horizontal={false} />
            <XAxis type="number" tick={axisTick} axisLine={axisLine} tickLine={false} tickFormatter={v => `${v}m`} />
            <YAxis type="category" dataKey="app" width={width < 480 ? 96 : 140} tick={axisTick} axisLine={false} tickLine={false}
              tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + '…' : v)} />
            <Tooltip {...tooltipProps}
              formatter={(value, _name, entry) => {
                const point = entry.payload as { minutes: number; app: string }
                const pct = totalMinutes > 0 ? ((point.minutes / totalMinutes) * 100).toFixed(1) : '0'
                return [`${value} min (${pct}%)`, point.app]
              }} />
            <Bar dataKey="minutes" fill={C.blue} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartSection>

      <ChartSection title="Daily app usage by app">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={dailyData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="date" tick={axisTick} axisLine={axisLine} tickLine={false} minTickGap={24} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={v => `${v}m`} width={44} />
            <Tooltip {...tooltipProps} formatter={v => [`${v} min`]} />
            <Legend wrapperStyle={legendStyle} />
            {[...top8Apps, 'Other'].map((app, i) => (
              <Bar key={app} dataKey={app} stackId="a" fill={seriesColor(i)} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartSection>

      <ChartSection title="Usage patterns by hour" hint="Average minutes per session, by hour of day.">
        <div ref={wrapRef} className="w-full">
          <svg width={width} height={svgH + 4} role="img" aria-label="Average app usage by hour of day" style={{ display: 'block' }}>
            {heatmapData.map((row, ri) => (
              <g key={row.app} transform={`translate(0, ${ri * cellH})`}>
                <text x={labelW - 6} y={cellH / 2} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={C.fg}>
                  {row.app.length > maxChars ? row.app.slice(0, maxChars - 1) + '…' : row.app}
                </text>
                {row.hours.map((val, hi) => (
                  <rect key={hi} x={labelW + hi * cellW} y={1} width={Math.max(1, cellW - 2)} height={cellH - 2} rx={2}
                    fill={val > 0 ? intensity(C.blue, 0.12 + 0.88 * (val / heatmapMax)) : C.sunken}>
                    <title>{`${row.app} at ${hi}:00, average ${val.toFixed(1)} min`}</title>
                  </rect>
                ))}
              </g>
            ))}
            <g transform={`translate(0, ${heatmapData.length * cellH})`}>
              {Array.from({ length: 24 }, (_, hi) =>
                hi % (cellW < 18 ? 6 : 3) === 0 ? (
                  <text key={hi} x={labelW + hi * cellW + cellW / 2} y={xAxisH - 4} textAnchor="middle" fontSize={10} fill={C.axis}>{hi}</text>
                ) : null,
              )}
            </g>
          </svg>
        </div>
      </ChartSection>
    </div>
  )
}
