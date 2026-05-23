'use client'

import { useEffect, useRef, useMemo, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

const PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4']

interface Participant { id: string; label: string | null; device_id: string }
interface Props {
  data: any[]
  participants: Participant[]
  showParticipant: boolean
}

function pName(p: Participant) { return p.label || p.device_id }

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

export default function LocationChart({ data, participants, showParticipant }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(800)
  const pMap = useMemo(() => Object.fromEntries(participants.map(p => [p.id, p])), [participants])
  const pIds = useMemo(() => [...new Set(data.map(r => r.participant_id as string))], [data])

  const allDates = useMemo(() => {
    const s = new Set<string>()
    for (const r of data) s.add(r.recorded_at?.slice(0, 10) ?? '')
    return Array.from(s).filter(Boolean).sort()
  }, [data])

  const [selectedDay, setSelectedDay] = useState('all')

  // Responsive canvas width
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setCanvasW(Math.floor(w))
    })
    ro.observe(el)
    setCanvasW(Math.floor(el.getBoundingClientRect().width) || 800)
    return () => ro.disconnect()
  }, [])

  // ── Canvas scatter map ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = canvasW
    canvas.height = Math.round(canvasW * 0.5)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const filtered = selectedDay === 'all' ? data : data.filter(r => r.recorded_at?.startsWith(selectedDay))
    const validPoints = filtered.filter(r => r.latitude != null && r.longitude != null)

    if (!validPoints.length) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#f9fafb'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#9ca3af'
      ctx.font = '13px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('No location data for this selection', canvas.width / 2, canvas.height / 2)
      return
    }

    const lats = validPoints.map(r => r.latitude as number)
    const lons = validPoints.map(r => r.longitude as number)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLon = Math.min(...lons), maxLon = Math.max(...lons)
    const PAD = 24

    const W = canvas.width, H = canvas.height
    const latRange = maxLat - minLat || 0.001
    const lonRange = maxLon - minLon || 0.001
    const scale = Math.min((W - PAD * 2) / lonRange, (H - PAD * 2) / latRange)

    function toXY(lat: number, lon: number): [number, number] {
      const x = PAD + (lon - minLon) * scale
      const y = H - PAD - (lat - minLat) * scale
      return [x, y]
    }

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, 0, W, H)

    // Grid
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 8; i++) {
      const x = PAD + i * (W - PAD * 2) / 8
      const y = PAD + i * (H - PAD * 2) / 8
      ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, H - PAD); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke()
    }

    // Per-participant sorted data + path + dots
    for (const pid of pIds) {
      const pPoints = validPoints
        .filter(r => r.participant_id === pid)
        .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
      if (!pPoints.length) continue
      const idx = pIds.indexOf(pid)
      const color = PALETTE[idx % PALETTE.length]

      if (selectedDay !== 'all' && pPoints.length > 1) {
        ctx.beginPath()
        ctx.strokeStyle = color + '66'
        ctx.lineWidth = 1.5
        const [x0, y0] = toXY(pPoints[0].latitude, pPoints[0].longitude)
        ctx.moveTo(x0, y0)
        for (let i = 1; i < pPoints.length; i++) {
          const [x, y] = toXY(pPoints[i].latitude, pPoints[i].longitude)
          ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      for (const pt of pPoints) {
        const [x, y] = toXY(pt.latitude, pt.longitude)
        ctx.beginPath()
        ctx.arc(x, y, selectedDay === 'all' ? 3 : 4, 0, Math.PI * 2)
        ctx.fillStyle = color + 'cc'
        ctx.fill()
      }
    }

    // Axis labels
    ctx.fillStyle = '#94a3b8'
    ctx.font = '10px monospace'
    ctx.textAlign = 'left'
    ctx.fillText(`${minLat.toFixed(4)}°N`, 2, H - PAD - 2)
    ctx.fillText(`${maxLat.toFixed(4)}°N`, 2, PAD + 12)
    ctx.textAlign = 'left'
    ctx.fillText(`${minLon.toFixed(4)}°E`, PAD, H - 4)
    ctx.textAlign = 'right'
    ctx.fillText(`${maxLon.toFixed(4)}°E`, W - 4, H - 4)
  }, [data, selectedDay, pIds, canvasW])

  // ── Mobility metrics ──────────────────────────────────────────────────────────
  const mobilityData = useMemo(() => {
    const dateMap = new Map<string, Record<string, { lats: number[]; lons: number[] }>>()
    for (const r of data) {
      if (r.latitude == null || r.longitude == null) continue
      const date = r.recorded_at?.slice(0, 10)
      if (!date) continue
      if (!dateMap.has(date)) dateMap.set(date, {})
      const dm = dateMap.get(date)!
      if (!dm[r.participant_id]) dm[r.participant_id] = { lats: [], lons: [] }
      dm[r.participant_id].lats.push(r.latitude)
      dm[r.participant_id].lons.push(r.longitude)
    }
    return Array.from(dateMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, byP]) => {
        const entry: any = { date }
        for (const pid of pIds) {
          const pts = byP[pid]
          if (!pts || pts.lats.length < 2) { entry[pid] = 0; continue }
          const centLat = pts.lats.reduce((s, v) => s + v, 0) / pts.lats.length
          const centLon = pts.lons.reduce((s, v) => s + v, 0) / pts.lons.length
          const msd = pts.lats.reduce((s, lat, i) => s + haversineKm(lat, pts.lons[i], centLat, centLon) ** 2, 0) / pts.lats.length
          entry[pid] = Math.round(Math.sqrt(msd) * 100) / 100
        }
        return entry
      })
  }, [data, pIds])

  // ── Hour density ──────────────────────────────────────────────────────────────
  const hourData = useMemo(() => {
    const buckets: Record<number, Record<string, number>> = {}
    for (let h = 0; h < 24; h++) buckets[h] = {}
    for (const r of data) {
      if (!r.recorded_at) continue
      const h = new Date(r.recorded_at).getHours()
      buckets[h][r.participant_id] = (buckets[h][r.participant_id] ?? 0) + 1
    }
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, ...buckets[h] }))
  }, [data])

  if (!data.length) return (
    <div className="py-12 text-center text-sm text-gray-400">No location data available.</div>
  )

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Location Scatter Map</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Select a day to see mobility path · All days shows point cloud</p>
          </div>
          <select
            value={selectedDay}
            onChange={e => setSelectedDay(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none"
          >
            <option value="all">All days</option>
            {allDates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div ref={containerRef} className="w-full">
          <canvas
            ref={canvasRef}
            className="w-full rounded-lg border border-gray-100 bg-gray-50 block"
          />
        </div>
        {showParticipant && (
          <div className="flex flex-wrap gap-3 mt-2">
            {pIds.map((pid, idx) => {
              const p = pMap[pid]
              return (
                <span key={pid} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PALETTE[idx % PALETTE.length] }} />
                  {p ? pName(p) : pid}
                </span>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Daily Mobility (Radius of Gyration)</h3>
        <p className="text-[10px] text-gray-400 mb-3">Distance (km) from centroid — proxy for daily movement range</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={mobilityData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit=" km" />
            <Tooltip formatter={(v: any) => [`${v} km`]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {pIds.map((pid, idx) => {
              const p = pMap[pid]
              return (
                <Line
                  key={pid}
                  type="monotone"
                  dataKey={pid}
                  name={p ? pName(p) : pid}
                  stroke={PALETTE[idx % PALETTE.length]}
                  dot={{ r: 3 }}
                  connectNulls
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">GPS Fix Density by Hour</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={hourData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="hour" tickFormatter={h => `${h}h`} tick={{ fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip labelFormatter={h => `${h}:00`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {pIds.map((pid, idx) => {
              const p = pMap[pid]
              return (
                <Bar key={pid} dataKey={pid} name={p ? pName(p) : pid}
                  stackId="a" fill={PALETTE[idx % PALETTE.length]} isAnimationActive={false} />
              )
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
