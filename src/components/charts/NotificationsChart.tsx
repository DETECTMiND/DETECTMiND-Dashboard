'use client'

import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

interface Props {
  data: any[]
  participants: { id: string; label: string | null; device_id: string }[]
  showParticipant: boolean
}

export default function NotificationsChart({ data, participants, showParticipant }: Props) {
  const spanDays = useMemo(() => {
    if (!data.length) return 0
    const times = data.map(r => new Date(r.posted_at).getTime())
    return (Math.max(...times) - Math.min(...times)) / 86400000
  }, [data])

  // ── Heatmap data ─────────────────────────────────────────────────────────────
  const { heatmap, xLabels } = useMemo(() => {
    const useExactDates = spanDays <= 14
    const cellMap: Record<string, Record<number, number>> = {}

    for (const r of data) {
      const d = new Date(r.posted_at)
      const xKey = useExactDates
        ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(d.getDay() + 6) % 7]
      const h = d.getHours()
      if (!cellMap[xKey]) cellMap[xKey] = {}
      cellMap[xKey][h] = (cellMap[xKey][h] ?? 0) + 1
    }

    const xLabels = useExactDates
      ? Array.from(new Set(data.map(r => {
          const d = new Date(r.posted_at)
          return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        }))).sort((a, b) => {
          const ta = data.find(r => new Date(r.posted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) === a)
          const tb = data.find(r => new Date(r.posted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) === b)
          return new Date(ta?.posted_at ?? 0).getTime() - new Date(tb?.posted_at ?? 0).getTime()
        })
      : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

    // If day-of-week mode, average counts
    if (!useExactDates) {
      const countMap: Record<string, number> = {}
      for (const r of data) {
        const d = new Date(r.posted_at)
        const key = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(d.getDay() + 6) % 7]
        countMap[key] = (countMap[key] ?? 0) + 1
      }
      const weeks = Math.max(1, Math.ceil(spanDays / 7))
      for (const xk of xLabels) {
        if (!cellMap[xk]) cellMap[xk] = {}
        for (let h = 0; h < 24; h++) {
          if (cellMap[xk][h]) cellMap[xk][h] = Math.round(cellMap[xk][h] / weeks)
        }
      }
    }

    return { heatmap: cellMap, xLabels }
  }, [data, spanDays])

  const heatmapMax = useMemo(() => {
    let max = 0
    for (const xk of xLabels) {
      for (let h = 0; h < 24; h++) {
        const v = heatmap[xk]?.[h] ?? 0
        if (v > max) max = v
      }
    }
    return max || 1
  }, [heatmap, xLabels])

  // ── Top apps ─────────────────────────────────────────────────────────────────
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

  const cellW = Math.max(28, Math.floor(640 / Math.max(xLabels.length, 1)))
  const cellH = 20
  const labelW = 40
  const xAxisH = 18
  const svgW = labelW + xLabels.length * cellW
  const svgH = 24 * cellH + xAxisH

  if (!data.length) return (
    <div className="py-12 text-center text-sm text-gray-400">No notification data available.</div>
  )

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Notification Heatmap (Day × Hour)</h3>
        <p className="text-[10px] text-gray-400 mb-3">
          {spanDays <= 14 ? 'Exact dates' : 'Averaged by day of week'} · colour intensity = notification count
        </p>
        <div className="overflow-x-auto">
          <svg width={svgW} height={svgH} style={{ display: 'block' }}>
            {Array.from({ length: 24 }, (_, h) => (
              <g key={h} transform={`translate(0, ${h * cellH})`}>
                <text x={labelW - 4} y={cellH / 2} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="#9ca3af">
                  {h}h
                </text>
                {xLabels.map((xk, xi) => {
                  const v = heatmap[xk]?.[h] ?? 0
                  const opacity = v / heatmapMax
                  return (
                    <g key={xk}>
                      <rect
                        x={labelW + xi * cellW + 1}
                        y={1}
                        width={cellW - 2}
                        height={cellH - 2}
                        fill={`rgba(59,130,246,${opacity.toFixed(3)})`}
                        rx={2}
                      >
                        <title>{`${xk} ${h}:00 — ${v} notifications`}</title>
                      </rect>
                      {v > 0 && cellW >= 28 && (
                        <text
                          x={labelW + xi * cellW + cellW / 2}
                          y={cellH / 2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={8}
                          fill={opacity > 0.5 ? '#fff' : '#374151'}
                          pointerEvents="none"
                        >
                          {v}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            ))}
            <g transform={`translate(0, ${24 * cellH})`}>
              {xLabels.map((xk, xi) => (
                <text
                  key={xk}
                  x={labelW + xi * cellW + cellW / 2}
                  y={xAxisH - 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#6b7280"
                >
                  {xk}
                </text>
              ))}
            </g>
          </svg>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Top Notification Sources</h3>
        <ResponsiveContainer width="100%" height={Math.max(180, topApps.length * 28)}>
          <BarChart layout="vertical" data={topApps} margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="app"
              width={150}
              tick={{ fontSize: 11 }}
              tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 19) + '…' : v}
            />
            <Tooltip formatter={(v: any) => [v, 'Notifications']} />
            <Bar dataKey="count" fill="#3b82f6" radius={[0, 3, 3, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
