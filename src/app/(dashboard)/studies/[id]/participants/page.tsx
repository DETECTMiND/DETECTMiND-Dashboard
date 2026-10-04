'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState, Suspense, useMemo, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, AlertTriangle, CheckCircle2, Clock, Smartphone, Pencil,
  Database, MessageSquare, Search, X, Activity, RefreshCw,
  TrendingUp, Zap, AlertCircle, CheckCircle, ShieldCheck,
} from 'lucide-react'
import { formatDistanceToNow, format, parseISO } from 'date-fns'
import { MergeSuggestions } from '@/components/participant-merge'
import { PermissionHistoryModal } from '@/components/permission-history-modal'
import { PinLockouts } from '@/components/pin-lockouts'
import { MergeAudit } from '@/components/merge-audit'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

interface Participant {
  id: string
  device_id: string
  label: string | null
  status: string
  enrolled_at: string
  last_sync_at: string | null
  permissions: Record<string, boolean> | null
  device_info: Record<string, string | number | boolean> | null
  merged_into?: string | null
  merged_at?: string | null
  merge_adopted_at?: string | null
}

const STATUS_OPTIONS = ['active', 'withdrawn']
const STATUS_STYLES: Record<string, string> = {
  active:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  withdrawn: 'bg-red-50 text-red-600 border border-red-200',
}

type FilterKey = 'all' | 'active' | 'withdrawn' | 'stale' | 'perm_missing'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',          label: 'All' },
  { key: 'active',       label: 'Active' },
  { key: 'withdrawn',    label: 'Withdrawn' },
  { key: 'stale',        label: 'Sync Stale' },
  { key: 'perm_missing', label: 'Permission Missing' },
]

interface SyncRow {
  synced_at: string
  status: string
  records_synced: number
  participant_id: string
  error_message?: string | null
}

function pName(p: Participant) { return p.label || p.device_id }

function syncCellColor(rows: SyncRow[]): string {
  if (!rows.length) return '#e5e7eb'
  const hasError   = rows.some(r => r.status === 'error')
  const hasPartial = rows.some(r => r.status === 'partial')
  if (hasError)   return '#fca5a5'
  if (hasPartial) return '#fcd34d'
  return '#34d399'
}

function syncCellIntensity(rows: SyncRow[], maxPerDay: number): string {
  if (!rows.length) return '#e5e7eb'
  const hasError   = rows.some(r => r.status === 'error')
  const hasPartial = rows.some(r => r.status === 'partial')
  const ratio = Math.min(rows.length / Math.max(maxPerDay, 1), 1)
  if (hasError)   return `rgba(239,68,68,${0.3 + ratio * 0.7})`
  if (hasPartial) return `rgba(245,158,11,${0.3 + ratio * 0.7})`
  return `rgba(16,185,129,${0.2 + ratio * 0.8})`
}

// ── Sync History Modal ────────────────────────────────────────────────────────

interface SyncModalProps {
  participant: Participant
  onClose: () => void
}

function SyncHistoryModal({ participant, onClose }: SyncModalProps) {
  const supabase = createClient()
  const [rows, setRows] = useState<SyncRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [range, setRange] = useState<'30d' | '90d' | 'all'>('90d')

  const fetchRows = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('sync_log')
      .select('synced_at, status, records_synced, participant_id')
      .eq('participant_id', participant.id)
      .order('synced_at', { ascending: true })
    if (range !== 'all') {
      const days = range === '30d' ? 30 : 90
      const since = new Date()
      since.setDate(since.getDate() - days)
      q = q.gte('synced_at', since.toISOString())
    }
    const { data } = await q.limit(2000)
    setRows((data || []) as SyncRow[])
    setLoading(false)
  }, [participant.id, range])

  useEffect(() => { fetchRows() }, [fetchRows])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const { calendarWeeks, trendData, stats, maxPerDay } = useMemo(() => {
    if (!rows || !rows.length) return { calendarWeeks: [], trendData: [], stats: null, maxPerDay: 1 }

    const byDate = new Map<string, SyncRow[]>()
    for (const r of rows) {
      const d = r.synced_at.slice(0, 10)
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d)!.push(r)
    }

    const maxPerDay = Math.max(...Array.from(byDate.values()).map(v => v.length), 1)

    // Calendar: pad start to Monday, fill to today
    const dates = Array.from(byDate.keys()).sort()
    const start = new Date(dates[0])
    const end   = new Date()
    while ((start.getDay() + 6) % 7 !== 0) start.setDate(start.getDate() - 1)

    const calendarWeeks: { date: string; rows: SyncRow[]; inRange: boolean }[][] = [[]]
    const cur = new Date(start)
    const rangeStart = new Date(dates[0])
    while (cur <= end) {
      const d = cur.toISOString().slice(0, 10)
      const w = calendarWeeks[calendarWeeks.length - 1]
      w.push({ date: d, rows: byDate.get(d) || [], inRange: cur >= rangeStart })
      if (w.length === 7) calendarWeeks.push([])
      cur.setDate(cur.getDate() + 1)
    }

    // Trend data — daily
    const trendData = Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, rs]) => ({
        date,
        records: rs.reduce((s, r) => s + (r.records_synced || 0), 0),
        syncs:   rs.length,
        errors:  rs.filter(r => r.status === 'error').length,
      }))

    const totalSyncs   = rows.length
    const successCount = rows.filter(r => r.status === 'success').length
    const errorCount   = rows.filter(r => r.status === 'error').length
    const partialCount = rows.filter(r => r.status === 'partial').length
    const totalRecords = rows.reduce((s, r) => s + (r.records_synced || 0), 0)
    const successRate  = totalSyncs > 0 ? Math.round((successCount / totalSyncs) * 100) : 0
    const activeDays   = byDate.size

    const lastSync = rows[rows.length - 1]

    return {
      calendarWeeks,
      trendData,
      maxPerDay,
      stats: { totalSyncs, successCount, errorCount, partialCount, totalRecords, successRate, activeDays, lastSync },
    }
  }, [rows])

  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const recentRows = useMemo(() => {
    if (!rows) return []
    return [...rows].reverse().slice(0, 20)
  }, [rows])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
              <Activity size={18} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Sync History</h2>
              <p className="text-xs text-gray-400">{pName(participant)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Range selector */}
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5 text-xs">
              {(['30d', '90d', 'all'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                    range === r ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {r === 'all' ? 'All time' : r === '30d' ? '30 days' : '90 days'}
                </button>
              ))}
            </div>
            <button
              onClick={fetchRows}
              disabled={loading}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1 px-6 py-5">

          {rows === null ? (
            <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
              <RefreshCw size={14} className="animate-spin" /> Loading sync history…
            </div>
          ) : rows.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
              <Activity size={32} className="text-gray-300" />
              <p className="text-sm font-medium">No sync records found</p>
              <p className="text-xs">Try selecting a wider date range</p>
            </div>
          ) : (
            <div className={`space-y-6 transition-opacity duration-200 ${loading ? 'opacity-50' : 'opacity-100'}`}>
              {/* Stats cards */}
              {stats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3.5">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap size={13} className="text-blue-500" />
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Total Syncs</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-800">{stats.totalSyncs.toLocaleString()}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{stats.activeDays} active days</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3.5">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle size={13} className="text-emerald-500" />
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Success Rate</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-800">{stats.successRate}%</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{stats.successCount} successful</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3.5">
                    <div className="flex items-center gap-2 mb-1">
                      <TrendingUp size={13} className="text-indigo-500" />
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Records Synced</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-800">{stats.totalRecords.toLocaleString()}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      ~{stats.activeDays > 0 ? Math.round(stats.totalRecords / stats.activeDays).toLocaleString() : 0}/day avg
                    </p>
                  </div>
                  <div className={`rounded-xl p-3.5 ${stats.errorCount > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle size={13} className={stats.errorCount > 0 ? 'text-red-500' : 'text-gray-400'} />
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Errors</span>
                    </div>
                    <p className={`text-2xl font-bold ${stats.errorCount > 0 ? 'text-red-600' : 'text-gray-800'}`}>
                      {stats.errorCount}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{stats.partialCount} partial</p>
                  </div>
                </div>
              )}

              {/* Calendar heatmap */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-gray-700">Sync Calendar</p>
                  <div className="flex items-center gap-3 text-[10px] text-gray-400">
                    {[
                      ['#e5e7eb', 'No sync'],
                      ['rgba(16,185,129,0.8)', 'Success'],
                      ['rgba(245,158,11,0.8)', 'Partial'],
                      ['rgba(239,68,68,0.8)', 'Error'],
                    ].map(([c, l]) => (
                      <span key={l} className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-sm inline-block" style={{ background: c }} />
                        {l}
                      </span>
                    ))}
                    <span className="text-gray-300">· darker = more syncs</span>
                  </div>
                </div>
                <div className="overflow-x-auto pb-1">
                  <div className="flex gap-1 min-w-fit">
                    {/* Day-of-week labels */}
                    <div className="flex flex-col gap-1 mr-1 mt-5">
                      {DOW.map(d => (
                        <div key={d} className="h-[14px] flex items-center text-[9px] text-gray-400 w-6">{d}</div>
                      ))}
                    </div>
                    {/* Week columns */}
                    {calendarWeeks.map((week, wi) => {
                      const monthLabel = week[0]?.date
                        ? (() => {
                            const d = new Date(week[0].date)
                            return d.getDate() <= 7 ? format(d, 'MMM') : ''
                          })()
                        : ''
                      return (
                        <div key={wi} className="flex flex-col gap-1">
                          <div className="h-4 text-[9px] text-gray-400 flex items-end pb-0.5">{monthLabel}</div>
                          {week.map(({ date, rows: dayRows, inRange }) => {
                            const color = inRange ? syncCellIntensity(dayRows, maxPerDay) : '#f3f4f6'
                            const total = dayRows.reduce((s, r) => s + (r.records_synced || 0), 0)
                            const tip = dayRows.length
                              ? `${date}\n${dayRows.length} syncs · ${total.toLocaleString()} records\n${dayRows.filter(r => r.status === 'success').length} ok · ${dayRows.filter(r => r.status === 'error').length} err`
                              : date
                            return (
                              <div
                                key={date}
                                title={tip}
                                className="w-[14px] h-[14px] rounded-[3px] cursor-default transition-transform hover:scale-125"
                                style={{ background: color }}
                              />
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Trend chart */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">Daily Sync Activity</p>
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={trendData} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={{ stroke: '#e5e7eb' }}
                      interval="preserveStartEnd"
                      tickFormatter={d => {
                        try { return format(parseISO(d), 'MMM d') } catch { return d }
                      }}
                    />
                    <YAxis yAxisId="records" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
                    <YAxis yAxisId="syncs" orientation="right" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8 }}
                      formatter={(v: any, name: any) => {
                        if (name === 'records') return [v.toLocaleString(), 'Records']
                        if (name === 'syncs') return [v, 'Syncs']
                        return [v, 'Errors']
                      }}
                      labelFormatter={d => {
                        try { return format(parseISO(d as string), 'MMM d, yyyy') } catch { return d }
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="records" dataKey="records" name="records" fill="#818cf8" opacity={0.7} radius={[2,2,0,0]} isAnimationActive={false} maxBarSize={20} />
                    {trendData.some(d => d.errors > 0) && (
                      <Bar yAxisId="syncs" dataKey="errors" name="errors" fill="#fca5a5" opacity={0.9} radius={[2,2,0,0]} isAnimationActive={false} maxBarSize={12} />
                    )}
                    <Line yAxisId="syncs" type="monotone" dataKey="syncs" name="syncs" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Recent syncs table */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">Recent Syncs</p>
                <div className="rounded-xl border border-gray-100 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500">Time</th>
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500">Status</th>
                        <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-gray-500">Records</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {recentRows.map((r, i) => {
                        const s = r.status?.toLowerCase()
                        const badge =
                          s === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          s === 'error'   ? 'bg-red-50 text-red-600 border-red-200' :
                          s === 'partial' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-gray-100 text-gray-500 border-gray-200'
                        return (
                          <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-4 py-2.5 text-gray-600 tabular-nums">
                              <div>{format(parseISO(r.synced_at), 'MMM d, yyyy')}</div>
                              <div className="text-gray-400">{format(parseISO(r.synced_at), 'HH:mm:ss')}</div>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold ${badge}`}>
                                {r.status || 'unknown'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-700 font-medium tabular-nums">
                              {(r.records_synced || 0).toLocaleString()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {rows.length > 20 && (
                    <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-400 text-center">
                      Showing 20 most recent of {rows.length.toLocaleString()} total
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Participants page ─────────────────────────────────────────────────────────

function ParticipantsContent() {
  const { id: studyId } = useParams()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [participants, setParticipants] = useState<Participant[]>([])
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [labelValue, setLabelValue] = useState('')
  const [search, setSearch] = useState('')
  const [syncModalParticipant, setSyncModalParticipant] = useState<Participant | null>(null)
  const [permModalParticipant, setPermModalParticipant] = useState<Participant | null>(null)
  const [latestSync, setLatestSync] = useState<Record<string, SyncRow>>({})
  const [activeFilter, setActiveFilter] = useState<FilterKey>(() => {
    const f = searchParams.get('filter')
    return (f && ['all', 'active', 'withdrawn', 'stale', 'perm_missing'].includes(f) ? f : 'all') as FilterKey
  })

  async function load() {
    const { data } = await supabase.from('participants').select('*')
      .eq('study_id', studyId).order('enrolled_at', { ascending: false })
    const rows = (data || []) as Participant[]
    setParticipants(rows)
    const ids = new Set(rows.map(p => p.id))
    const { data: logs } = ids.size
      ? await supabase.from('sync_log').select('synced_at,status,records_synced,participant_id,error_message')
          .in('participant_id', [...ids]).order('synced_at', { ascending: false }).limit(2000)
      : { data: [] }
    const newest: Record<string, SyncRow> = {}
    for (const log of (logs || []) as SyncRow[]) {
      if (ids.has(log.participant_id) && !newest[log.participant_id]) newest[log.participant_id] = log
    }
    setLatestSync(newest)
  }

  useEffect(() => { load() }, [studyId])

  async function saveLabel(participantId: string) {
    await supabase.from('participants').update({ label: labelValue }).eq('id', participantId)
    setEditingLabel(null)
    load()
  }

  async function updateStatus(participantId: string, status: string) {
    await supabase.from('participants').update({ status }).eq('id', participantId)
    load()
  }

  function getMissingPermissions(p: Participant): string[] {
    if (!p.permissions) return ['no permissions reported']
    return Object.entries(p.permissions).filter(([, v]) => v === false).map(([k]) => k)
  }

  function isSyncStale(p: Participant): boolean {
    if (!p.last_sync_at) return true
    return Date.now() - new Date(p.last_sync_at).getTime() > 60 * 60 * 1000
  }

  function hasPermIssue(p: Participant): boolean {
    if (!p.permissions) return true
    return Object.values(p.permissions).some(v => v === false)
  }

  const activeOnly = participants.filter(p => p.status === 'active')

  const filtered = participants.filter(p => {
    const q = search.toLowerCase()
    if (q) {
      const name = (p.label || p.device_id).toLowerCase()
      const did = p.device_id.toLowerCase()
      if (!name.includes(q) && !did.includes(q)) return false
    }
    if (activeFilter === 'active')       return p.status === 'active'
    if (activeFilter === 'withdrawn')    return p.status === 'withdrawn'
    if (activeFilter === 'stale')        return p.status === 'active' && isSyncStale(p)
    if (activeFilter === 'perm_missing') return p.status === 'active' && hasPermIssue(p)
    return true
  })

  const filterCounts: Record<FilterKey, number> = {
    all:          participants.length,
    active:       participants.filter(p => p.status === 'active').length,
    withdrawn:    participants.filter(p => p.status === 'withdrawn').length,
    stale:        activeOnly.filter(p => isSyncStale(p)).length,
    perm_missing: activeOnly.filter(p => hasPermIssue(p)).length,
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href={`/studies/${studyId}`} className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors mb-3">
            <ArrowLeft size={14} /> Back to Study
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Participants</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {`${participants.length} enrolled · ${filterCounts.active} active`}
          </p>
        </div>
      </div>

      {/* Duplicate-participant merge suggestions */}
      {participants.length > 0 && (
        <MergeSuggestions participants={participants} onMerged={load} />
      )}

      <PinLockouts studyId={studyId as string} />
      <MergeAudit
        studyId={studyId as string}
        names={Object.fromEntries(participants.map(p => [p.id, pName(p)]))}
      />

      {/* Search + filters toolbar */}
      {participants.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or device ID…"
              className="pl-8 pr-7 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all bg-white placeholder-gray-400 w-56"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="h-5 w-px bg-gray-200" />

          {FILTERS.map(f => {
            const isActive = activeFilter === f.key
            const count = filterCounts[f.key]
            const isWarn   = f.key === 'stale' && count > 0
            const isDanger = f.key === 'perm_missing' && count > 0

            return (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  isActive
                    ? isWarn    ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
                    : isDanger  ? 'bg-red-500 border-red-500 text-white shadow-sm'
                    :             'bg-blue-600 border-blue-600 text-white shadow-sm'
                    : isWarn    ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                    : isDanger  ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                    :             'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
                }`}
              >
                {f.label}
                <span className={`text-[11px] tabular-nums font-bold ${isActive ? 'opacity-70' : isWarn ? 'text-amber-600' : isDanger ? 'text-red-500' : 'text-gray-400'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* List */}
      {participants.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <Smartphone size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No participants yet</p>
          <p className="text-gray-400 text-sm mt-1">Participants appear here when they join via the mobile app</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 py-12 text-center">
          <Search size={26} className="mx-auto text-gray-300 mb-2" />
          <p className="text-gray-500 font-medium text-sm">No matches</p>
          <p className="text-gray-400 text-xs mt-1">Try a different search or filter</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(p => {
            const missing = getMissingPermissions(p)
            const isWithdrawn = p.status === 'withdrawn'
            const hasPermIssues = !isWithdrawn && hasPermIssue(p)
            const stale = !isWithdrawn && isSyncStale(p)
            const hasAlerts = stale || hasPermIssues
            const health = latestSync[p.id]

            return (
              <div key={p.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex">
                  <div className="flex-1 px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">

                        {/* Name row */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {editingLabel === p.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                value={labelValue}
                                onChange={e => setLabelValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveLabel(p.id); if (e.key === 'Escape') setEditingLabel(null) }}
                                className="px-2.5 py-1 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                placeholder="Label"
                                autoFocus
                              />
                              <button onClick={() => saveLabel(p.id)} className="text-blue-600 text-sm font-semibold hover:text-blue-700">Save</button>
                              <button onClick={() => setEditingLabel(null)} className="text-gray-400 text-sm hover:text-gray-600">Cancel</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setEditingLabel(p.id); setLabelValue(p.label || '') }}
                              className="flex items-center gap-1.5 font-semibold text-gray-900 hover:text-blue-600 transition-colors group"
                            >
                              {p.label || p.device_id}
                              <Pencil size={11} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
                            </button>
                          )}
                          {p.label && (
                            <span className="text-gray-400 text-xs font-mono bg-gray-50 px-1.5 py-0.5 rounded">
                              {p.device_id}
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-500'}`}>
                            {p.status}
                          </span>
                        </div>

                        {/* Meta row */}
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-400">
                          <span>Enrolled {formatDistanceToNow(new Date(p.enrolled_at), { addSuffix: true })}</span>
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {p.last_sync_at
                              ? `Synced ${formatDistanceToNow(new Date(p.last_sync_at), { addSuffix: true })}`
                              : 'Never synced'}
                          </span>
                          {p.device_info?.model && <span className="text-gray-300">·</span>}
                          {p.device_info?.model && <span>{p.device_info.model}</span>}
                          {p.device_info?.android_version && <span>Android {p.device_info.android_version}</span>}
                          {p.device_info?.app_version && <span>App {p.device_info.app_version}</span>}
                          {p.device_info?.pending_records && <span>{p.device_info.pending_records} pending</span>}
                        </div>

                        {p.merged_into && !p.merge_adopted_at && (
                          <div className="mt-2 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2 py-1 inline-flex">
                            Waiting for device to adopt primary on its next sync
                          </div>
                        )}
                        {p.merged_into && p.merge_adopted_at && (
                          <div className="mt-2 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1 inline-flex">
                            Device adopted primary {formatDistanceToNow(new Date(p.merge_adopted_at), { addSuffix: true })}
                          </div>
                        )}
                        {health && health.status !== 'success' && (
                          <div className="mt-2 text-[11px] text-red-600">
                            Last sync: {health.status}{health.error_message ? ` · ${health.error_message}` : ''}
                          </div>
                        )}

                        {/* Alert tags */}
                        {hasAlerts && (
                          <div className="flex flex-wrap gap-1.5 mt-2.5">
                            {stale && (
                              <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-md text-[11px] font-semibold">
                                <AlertTriangle size={10} /> Sync stale
                              </span>
                            )}
                            {hasPermIssues ? (
                              missing.map(m => (
                                <span key={m} className="inline-flex items-center gap-1 bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-md text-[11px] font-semibold">
                                  <AlertTriangle size={10} /> {m}
                                </span>
                              ))
                            ) : p.permissions ? (
                              <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md text-[11px] font-semibold">
                                <CheckCircle2 size={10} /> All permissions granted
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        <Link
                          href={`/studies/${studyId}/data?participant=${p.id}`}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-all"
                        >
                          <Database size={12} /> Sensor Data
                        </Link>
                        <Link
                          href={`/studies/${studyId}/esm-responses?participant=${p.id}`}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-500 hover:bg-violet-50 hover:text-violet-600 hover:border-violet-200 transition-all"
                        >
                          <MessageSquare size={12} /> ESM Responses
                        </Link>
                        <button
                          onClick={() => setSyncModalParticipant(p)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all"
                        >
                          <Activity size={12} /> Sync History
                        </button>
                        <button
                          onClick={() => setPermModalParticipant(p)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-500 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 transition-all"
                        >
                          <ShieldCheck size={12} /> Permissions
                        </button>
                        <select
                          value={p.status}
                          onChange={e => updateStatus(p.id, e.target.value)}
                          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                        >
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Sync History Modal */}
      {syncModalParticipant && (
        <SyncHistoryModal
          participant={syncModalParticipant}
          onClose={() => setSyncModalParticipant(null)}
        />
      )}

      {/* Permission History Modal */}
      {permModalParticipant && (
        <PermissionHistoryModal
          participant={permModalParticipant}
          onClose={() => setPermModalParticipant(null)}
        />
      )}
    </div>
  )
}

export default function ParticipantsPage() {
  return (
    <Suspense>
      <ParticipantsContent />
    </Suspense>
  )
}
