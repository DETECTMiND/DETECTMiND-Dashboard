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

interface Props {
  data: any[]
  participants: { id: string; label: string | null; device_id: string }[]
  showParticipant: boolean
}

const PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#f97316', '#84cc16']

function getDurationMs(row: any): number {
  if (row.duration_ms != null) return Number(row.duration_ms)
  if (row.start_time && row.end_time) {
    return new Date(row.end_time).getTime() - new Date(row.start_time).getTime()
  }
  return 0
}

function getDateStr(iso: string): string {
  return iso.slice(0, 10)
}

function getHour(iso: string): number {
  return new Date(iso).getHours()
}

export default function AppUsageChart({ data, participants, showParticipant }: Props) {
  const appTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of data) {
      const app = row.app_name ?? row.package_name ?? 'Unknown'
      const ms = getDurationMs(row)
      map.set(app, (map.get(app) ?? 0) + ms)
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([app, ms]) => ({ app, minutes: Math.round(ms / 60000) }))
  }, [data])

  const totalMinutes = useMemo(
    () => appTotals.reduce((s, r) => s + r.minutes, 0),
    [appTotals]
  )

  const top8Apps = useMemo(() => appTotals.slice(0, 8).map((r) => r.app), [appTotals])

  const dailyData = useMemo(() => {
    const dateAppMap = new Map<string, Map<string, number>>()
    for (const row of data) {
      if (!row.start_time) continue
      const date = getDateStr(row.start_time)
      const rawApp = row.app_name ?? row.package_name ?? 'Unknown'
      const app = top8Apps.includes(rawApp) ? rawApp : 'Other'
      const ms = getDurationMs(row)
      if (!dateAppMap.has(date)) dateAppMap.set(date, new Map())
      const inner = dateAppMap.get(date)!
      inner.set(app, (inner.get(app) ?? 0) + ms)
    }
    return Array.from(dateAppMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, inner]) => {
        const entry: Record<string, any> = { date }
        for (const app of [...top8Apps, 'Other']) {
          entry[app] = Math.round((inner.get(app) ?? 0) / 60000)
        }
        return entry
      })
  }, [data, top8Apps])

  const heatmapData = useMemo(() => {
    const appHourMap = new Map<string, number[]>()
    const appHourCount = new Map<string, number[]>()
    for (const app of top8Apps) {
      appHourMap.set(app, new Array(24).fill(0))
      appHourCount.set(app, new Array(24).fill(0))
    }
    for (const row of data) {
      if (!row.start_time) continue
      const rawApp = row.app_name ?? row.package_name ?? 'Unknown'
      if (!top8Apps.includes(rawApp)) continue
      const hour = getHour(row.start_time)
      const ms = getDurationMs(row)
      appHourMap.get(rawApp)![hour] += ms / 60000
      appHourCount.get(rawApp)![hour] += 1
    }
    const result: { app: string; hours: number[] }[] = []
    for (const app of top8Apps) {
      const sums = appHourMap.get(app)!
      const counts = appHourCount.get(app)!
      result.push({
        app,
        hours: sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0)),
      })
    }
    return result
  }, [data, top8Apps])

  const heatmapMax = useMemo(() => {
    let max = 0
    for (const row of heatmapData) for (const v of row.hours) if (v > max) max = v
    return max || 1
  }, [heatmapData])

  const cellW = 32
  const cellH = 22
  const labelW = 112
  const xAxisH = 20
  const svgW = labelW + 24 * cellW
  const svgH = heatmapData.length * cellH + xAxisH

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Top Apps by Usage Time</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            layout="vertical"
            data={appTotals}
            margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}m`} />
            <YAxis
              type="category"
              dataKey="app"
              width={140}
              tick={{ fontSize: 11 }}
              tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + '…' : v)}
            />
            <Tooltip
              formatter={(value: any, _name: any, entry: any) => {
                const pct = totalMinutes > 0 ? ((entry.payload.minutes / totalMinutes) * 100).toFixed(1) : '0'
                return [`${value} min (${pct}%)`, entry.payload.app]
              }}
            />
            <Bar dataKey="minutes" fill="#3b82f6" radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Daily App Usage by App</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={dailyData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}m`} />
            <Tooltip formatter={(v: any) => [`${v} min`]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {[...top8Apps, 'Other'].map((app, i) => (
              <Bar
                key={app}
                dataKey={app}
                stackId="a"
                fill={PALETTE[i % PALETTE.length]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Usage Patterns by Hour</h3>
        <div className="overflow-x-auto">
          <svg width={svgW} height={svgH + 4} style={{ display: 'block' }}>
            {heatmapData.map((row, ri) => (
              <g key={row.app} transform={`translate(0, ${ri * cellH})`}>
                <text
                  x={labelW - 6}
                  y={cellH / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="#374151"
                >
                  {row.app.length > 14 ? row.app.slice(0, 13) + '…' : row.app}
                </text>
                {row.hours.map((val, hi) => {
                  const opacity = val / heatmapMax
                  return (
                    <rect
                      key={hi}
                      x={labelW + hi * cellW}
                      y={1}
                      width={cellW - 2}
                      height={cellH - 2}
                      fill={`rgba(59,130,246,${opacity.toFixed(3)})`}
                      rx={2}
                    >
                      <title>{`${row.app} @ ${hi}:00 — avg ${val.toFixed(1)} min`}</title>
                    </rect>
                  )
                })}
              </g>
            ))}
            <g transform={`translate(0, ${heatmapData.length * cellH})`}>
              {Array.from({ length: 24 }, (_, hi) =>
                hi % 3 === 0 ? (
                  <text
                    key={hi}
                    x={labelW + hi * cellW + cellW / 2}
                    y={xAxisH - 4}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#6b7280"
                  >
                    {hi}
                  </text>
                ) : null
              )}
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}
