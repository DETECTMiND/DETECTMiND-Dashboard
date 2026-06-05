'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState, Suspense } from 'react'
import {
  Users, AlertTriangle, CheckCircle2, Wifi,
  Database, ChevronRight, MessageSquare,
} from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { formatDistanceToNow, startOfDay, startOfWeek, startOfMonth } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParticipantRow {
  id: string
  label: string | null
  device_id: string
  study_id: string
  status: string
  last_sync_at: string | null
  permissions: Record<string, boolean> | null
}

interface SyncRow {
  synced_at: string
  status: string
  records_synced: number
  participant_id: string
}

interface SensorCount { key: string; label: string; count: number }

interface EsmScheduleRate {
  id: string
  name: string
  total: number
  responded: number
  expired: number
  pending: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SYNC_STATUS: Record<string, { dot: string; badge: string; label: string }> = {
  success: { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Success' },
  partial: { dot: 'bg-amber-400',  badge: 'bg-amber-50 text-amber-700 border-amber-200',       label: 'Partial' },
  error:   { dot: 'bg-red-400',    badge: 'bg-red-50 text-red-700 border-red-200',              label: 'Error'   },
}

const SENSOR_LABELS: Record<string, string> = {
  data_app_usage:          'App Usage',
  data_notifications:      'Notifications',
  data_battery:            'Battery',
  data_calls:              'Calls',
  data_sms:                'SMS',
  data_esm_responses:      'ESM/EMA',
  data_location:           'Location',
  data_light:              'Light',
  data_screen_state:       'Screen State',
  data_gestures: 'User Gestures',
}

const SENSOR_TIME_COLS: Record<string, string> = {
  data_app_usage:          'start_time',
  data_notifications:      'posted_at',
  data_battery:            'recorded_at',
  data_calls:              'event_time',
  data_sms:                'event_time',
  data_esm_responses:      'triggered_at',
  data_location:           'recorded_at',
  data_light:              'recorded_at',
  data_screen_state:       'recorded_at',
  data_gestures: 'recorded_at',
}

const SENSOR_TABLES = Object.keys(SENSOR_LABELS)

type TimeFilter = 'today' | 'week' | 'month' | 'all'
const TIME_FILTERS: { key: TimeFilter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'all',   label: 'All Time' },
]

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function getRangeStart(filter: TimeFilter): string | null {
  const now = new Date()
  if (filter === 'today') return startOfDay(now).toISOString()
  if (filter === 'week')  return startOfWeek(now, { weekStartsOn: 1 }).toISOString()
  if (filter === 'month') return startOfMonth(now).toISOString()
  return null
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function OverviewContent() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const studyParam = searchParams.get('study')

  // Resolve selected study: prefer URL param, fall back to localStorage
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(() => {
    if (studyParam) return studyParam
    if (typeof window !== 'undefined') return localStorage.getItem('pinnedStudyId')
    return null
  })

  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [allParticipants, setAllParticipants] = useState<ParticipantRow[]>([])
  const [studies, setStudies] = useState<Record<string, { id: string; name: string }>>({})
  const [sensorCounts, setSensorCounts] = useState<SensorCount[]>([])
  const [totalRecords, setTotalRecords] = useState<number | null>(null)
  const [syncRows, setSyncRows] = useState<SyncRow[]>([])
  const [esmRates, setEsmRates] = useState<EsmScheduleRate[]>([])
  const [esmResponseTimes, setEsmResponseTimes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // Sync selectedStudyId when URL param changes
  useEffect(() => {
    if (studyParam) setSelectedStudyId(studyParam)
  }, [studyParam])

  // ── Load base data (doesn't change with time filter) ──────────────────────
  useEffect(() => {
    async function load() {
      const [{ data: pData }, { data: sData }] = await Promise.all([
        supabase.from('participants').select('id, label, device_id, study_id, status, last_sync_at, permissions'),
        supabase.from('studies').select('id, name'),
      ])
      const allP = (pData || []) as ParticipantRow[]
      const studyMap = Object.fromEntries((sData || []).map(s => [s.id, s]))
      setStudies(studyMap)

      // Resolve selected study — use first study if nothing pinned
      setSelectedStudyId(prev => {
        if (prev && studyMap[prev]) return prev
        const firstId = Object.keys(studyMap)[0] ?? null
        if (firstId) localStorage.setItem('pinnedStudyId', firstId)
        return firstId
      })

      setAllParticipants(allP)
    }
    load()
  }, [])

  // ── Load time-filtered data ───────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      const since = getRangeStart(timeFilter)

      // Participant IDs scoped to the selected study
      const studyParticipantIds = selectedStudyId
        ? allParticipants.filter(p => p.study_id === selectedStudyId).map(p => p.id)
        : allParticipants.map(p => p.id)

      // If the study has no participants, zero everything out immediately
      if (selectedStudyId && studyParticipantIds.length === 0) {
        const zeroCounts = SENSOR_TABLES.map(tbl => ({ key: tbl, label: SENSOR_LABELS[tbl], count: 0 }))
        setSensorCounts(zeroCounts)
        setTotalRecords(0)
        setSyncRows([])
        setEsmRates([])
        setEsmResponseTimes([])
        setLoading(false)
        return
      }

      // Sensor counts
      const countResults = await Promise.all(
        SENSOR_TABLES.map(tbl => {
          let q = supabase.from(tbl as any).select('*', { count: 'exact', head: true })
          if (since) q = q.gte(SENSOR_TIME_COLS[tbl], since)
          q = q.in('participant_id', studyParticipantIds)
          return q
        })
      )
      const counts: SensorCount[] = SENSOR_TABLES.map((tbl, i) => ({
        key: tbl, label: SENSOR_LABELS[tbl], count: countResults[i].count ?? 0,
      })).sort((a, b) => b.count - a.count)
      setSensorCounts(counts)
      setTotalRecords(counts.reduce((s, c) => s + c.count, 0))

      // Sync log
      let sq = supabase.from('sync_log').select('synced_at, status, records_synced, participant_id').order('synced_at', { ascending: false })
      if (since) sq = sq.gte('synced_at', since)
      sq = sq.in('participant_id', studyParticipantIds).limit(2000)
      const { data: syncData } = await sq
      setSyncRows((syncData || []) as SyncRow[])

      // ESM schedules — scoped to selected study
      const schedQuery = supabase.from('esm_schedules').select('id, name')
      if (selectedStudyId) schedQuery.eq('study_id', selectedStudyId)
      const { data: schedules } = await schedQuery
      if (schedules && schedules.length > 0) {
        const rates = await Promise.all(schedules.map(async s => {
          function base() {
            let q = supabase.from('data_esm_responses').select('*', { count: 'exact', head: true })
              .eq('schedule_id', s.id)
              .in('participant_id', studyParticipantIds)
            if (since) q = q.gte('triggered_at', since)
            return q
          }
          const [{ count: total }, { count: responded }, { count: expired }, { count: pending }] = await Promise.all([
            base(),
            base().not('responded_at', 'is', null).eq('expired', false),
            base().eq('expired', true),
            base().is('responded_at', null).eq('expired', false),
          ])
          return { id: s.id, name: s.name, total: total ?? 0, responded: responded ?? 0, expired: expired ?? 0, pending: pending ?? 0 }
        }))
        setEsmRates(rates.filter(r => r.total > 0))
      } else {
        setEsmRates([])
      }

      // ESM response timestamps for heatmap
      let rq = supabase.from('data_esm_responses').select('responded_at')
        .not('responded_at', 'is', null).eq('expired', false)
        .in('participant_id', studyParticipantIds)
      if (since) rq = rq.gte('triggered_at', since)
      const { data: rtData } = await rq
      setEsmResponseTimes((rtData || []).map((r: any) => r.responded_at as string))

      setLoading(false)
    }
    load()
  }, [timeFilter, selectedStudyId, allParticipants])

  // ── Derived ───────────────────────────────────────────────────────────────

  const studyParticipants = selectedStudyId
    ? allParticipants.filter(p => p.study_id === selectedStudyId)
    : allParticipants

  const activeParticipants = studyParticipants.filter(p => p.status === 'active')
  const withdrawnCount = studyParticipants.filter(p => p.status === 'withdrawn').length

  const staleCount = activeParticipants.filter(p => {
    if (!p.last_sync_at) return true
    return Date.now() - new Date(p.last_sync_at).getTime() > 60 * 60 * 1000
  }).length

  const permIssueCount = activeParticipants.filter(p => {
    if (!p.permissions) return true
    return Object.values(p.permissions).some(v => v === false)
  }).length

  const actionNeededCount = staleCount + permIssueCount

  const pMap = Object.fromEntries(studyParticipants.map(p => [p.id, p]))

  const latestSyncPerParticipant: Record<string, SyncRow> = {}
  for (const s of syncRows) {
    const p = pMap[s.participant_id]
    if (!p || p.status !== 'active') continue
    if (!latestSyncPerParticipant[s.participant_id]) {
      latestSyncPerParticipant[s.participant_id] = s
    }
  }
  const latestSyncs = Object.values(latestSyncPerParticipant)
  const successRate = latestSyncs.length > 0
    ? Math.round((latestSyncs.filter(s => s.status === 'success').length / latestSyncs.length) * 100)
    : null

  const syncBreakdownCounts = {
    success: latestSyncs.filter(s => s.status === 'success').length,
    partial: latestSyncs.filter(s => s.status === 'partial').length,
    error:   latestSyncs.filter(s => s.status === 'error').length,
  }

  const recent20 = syncRows.slice(0, 25).map(sync => ({
    ...sync,
    participant: pMap[sync.participant_id] || null,
    study: pMap[sync.participant_id] ? studies[pMap[sync.participant_id].study_id] : null,
  }))

  const maxCount = Math.max(...sensorCounts.map(c => c.count), 1)

  // Activity Heatmap: participant × day → synced (boolean)
  const heatmapParticipants = activeParticipants.slice(0, 12)
  const heatmapDays: string[] = []
  const numDays = timeFilter === 'today' ? 1 : timeFilter === 'week' ? 7 : timeFilter === 'month' ? 30 : 14
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    heatmapDays.push(d.toISOString().slice(0, 10))
  }
  const heatmapSynced = new Set(syncRows.map(s => `${s.participant_id}|${s.synced_at.slice(0, 10)}`))

  // ESM Response Time Heatmap: hour (0-23) × day-of-week (0=Sun..6=Sat)
  const esmHeatmap: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  for (const ts of esmResponseTimes) {
    const d = new Date(ts)
    esmHeatmap[d.getDay()][d.getHours()]++
  }
  const esmHeatMax = Math.max(...esmHeatmap.flat(), 1)

  const participantStudyId = selectedStudyId ?? studyParticipants[0]?.study_id ?? Object.keys(studies)[0] ?? null

  // ── Skeleton ──────────────────────────────────────────────────────────────
  if (loading && studyParticipants.length === 0 && sensorCounts.length === 0) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-7 bg-gray-200 rounded w-32 mb-1" />
            <div className="h-4 bg-gray-100 rounded w-56" />
          </div>
          <div className="flex gap-1">
            {[...Array(4)].map((_, i) => <div key={i} className="h-8 w-20 bg-gray-200 rounded-lg" />)}
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-gray-200 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 h-80 bg-gray-200 rounded-xl" />
          <div className="lg:col-span-2 h-80 bg-gray-200 rounded-xl" />
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
          <p className="text-gray-500 text-sm mt-0.5">Data collection health across all studies</p>
        </div>

        {/* Time filter */}
        <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
          {TIME_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setTimeFilter(f.key)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                timeFilter === f.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 transition-opacity duration-200 ${loading ? 'opacity-50' : 'opacity-100'}`}>

        {/* Participants */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col justify-between min-h-[160px]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <Users size={15} className="text-emerald-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Participants</span>
          </div>
          <div>
            <div className="text-4xl font-bold text-gray-900 tabular-nums tracking-tight">{studyParticipants.length}</div>
            <div className="mt-3 flex items-center gap-3 text-[13px]">
              {participantStudyId ? (
                <>
                  <Link href={`/studies/${participantStudyId}/participants?filter=active`}
                    className="flex items-center gap-1.5 text-emerald-600 font-medium hover:text-emerald-700 transition-colors">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />{activeParticipants.length} active
                  </Link>
                  <span className="text-gray-200">|</span>
                  <Link href={`/studies/${participantStudyId}/participants?filter=withdrawn`}
                    className="text-gray-400 font-medium hover:text-gray-600 transition-colors">
                    {withdrawnCount} withdrawn
                  </Link>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />{activeParticipants.length} active
                  </span>
                  <span className="text-gray-200">|</span>
                  <span className="text-gray-400 font-medium">{withdrawnCount} withdrawn</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Records collected */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col justify-between min-h-[160px]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <Database size={15} className="text-blue-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Records Collected</span>
          </div>
          <div>
            <div className="text-4xl font-bold text-gray-900 tabular-nums tracking-tight">{fmt(totalRecords ?? 0)}</div>
            <div className="mt-3 text-[13px] text-gray-400 font-medium">
              {sensorCounts.filter(c => c.count > 0).length} active sensor{sensorCounts.filter(c => c.count > 0).length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* Sync success rate */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col justify-between min-h-[160px]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
              <Wifi size={15} className="text-violet-600" />
            </div>
            <span className="text-sm font-medium text-gray-500">Sync Success Rate</span>
          </div>
          <div>
            <div className="text-4xl font-bold text-gray-900 tabular-nums tracking-tight">
              {successRate !== null ? `${successRate}%` : '—'}
            </div>
            <div className="mt-3 flex items-center gap-3 text-[13px]">
              <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />{syncBreakdownCounts.success}
              </span>
              <span className="flex items-center gap-1.5 text-amber-500 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />{syncBreakdownCounts.partial}
              </span>
              <span className="flex items-center gap-1.5 text-red-500 font-medium">
                <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />{syncBreakdownCounts.error}
              </span>
              <span className="text-gray-300 font-medium">/ {latestSyncs.length}</span>
            </div>
          </div>
        </div>

        {/* Action needed */}
        <div className={`rounded-2xl border shadow-sm p-6 flex flex-col justify-between min-h-[160px] transition-all ${
          actionNeededCount > 0 ? 'bg-red-50/50 border-red-100' : 'bg-white border-gray-100'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${actionNeededCount > 0 ? 'bg-red-100' : 'bg-emerald-50'}`}>
              {actionNeededCount > 0
                ? <AlertTriangle size={15} className="text-red-500" />
                : <CheckCircle2 size={15} className="text-emerald-500" />}
            </div>
            <span className="text-sm font-medium text-gray-500">Action Needed</span>
          </div>
          <div>
            <div className={`text-4xl font-bold tabular-nums tracking-tight ${actionNeededCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {actionNeededCount > 0 ? actionNeededCount : '—'}
            </div>
            <div className="mt-3 flex items-center gap-3 text-[13px]">
              {actionNeededCount > 0 ? (
                participantStudyId ? (
                  <>
                    <Link href={`/studies/${participantStudyId}/participants?filter=stale`}
                      className="flex items-center gap-1.5 text-amber-600 font-medium hover:text-amber-700 transition-colors">
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />{staleCount} stale
                    </Link>
                    <span className="text-gray-200">|</span>
                    <Link href={`/studies/${participantStudyId}/participants?filter=perm_missing`}
                      className="flex items-center gap-1.5 text-red-500 font-medium hover:text-red-600 transition-colors">
                      <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />{permIssueCount} perm
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 text-amber-600 font-medium">
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />{staleCount} stale
                    </span>
                    <span className="text-gray-200">|</span>
                    <span className="flex items-center gap-1.5 text-red-500 font-medium">
                      <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />{permIssueCount} perm
                    </span>
                  </>
                )
              ) : (
                <span className="text-emerald-600 font-medium">All clear</span>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Bottom row */}
      <div className={`grid grid-cols-1 lg:grid-cols-5 gap-6 transition-opacity duration-200 ${loading ? 'opacity-50' : 'opacity-100'}`}>

        {/* Recent Syncs */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800 text-sm">Recent Sync Activity</h2>
            <div className="flex items-center gap-3">
              {syncRows.some(s => s.status === 'error') && (
                <span className="flex items-center gap-1 text-[11px] text-red-500 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  {syncRows.filter(s => s.status === 'error').length} error{syncRows.filter(s => s.status === 'error').length !== 1 ? 's' : ''}
                </span>
              )}
              {syncRows.some(s => s.status === 'partial') && (
                <span className="flex items-center gap-1 text-[11px] text-amber-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  {syncRows.filter(s => s.status === 'partial').length} partial
                </span>
              )}
              <span className="text-xs text-gray-400">Last 25</span>
            </div>
          </div>

          {recent20.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <Wifi size={28} className="mx-auto text-gray-300 mb-2" />
              <p className="text-gray-400 text-sm">No sync data yet</p>
              <p className="text-gray-300 text-xs mt-1">Syncs appear here when participants connect</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Participant</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide hidden sm:table-cell">Study</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide hidden md:table-cell">Records</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide hidden md:table-cell">When</th>
                  <th className="text-right px-5 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recent20.map((sync, i) => {
                  const st = SYNC_STATUS[sync.status] || SYNC_STATUS.error
                  const p = sync.participant
                  const study = sync.study
                  return (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} />
                          <p className="font-medium text-gray-800 text-xs truncate max-w-28">
                            {p?.label || p?.device_id || 'Unknown'}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-3 hidden sm:table-cell">
                        {study ? (
                          <Link href={`/studies/${study.id}`} className="text-xs text-gray-500 hover:text-blue-600 hover:underline transition-colors truncate block max-w-32">
                            {study.name}
                          </Link>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right hidden md:table-cell">
                        <span className="text-xs text-gray-400 tabular-nums">{sync.records_synced?.toLocaleString() ?? '—'}</span>
                      </td>
                      <td className="px-3 py-3 text-right hidden md:table-cell">
                        <span className="text-xs text-gray-400">{formatDistanceToNow(new Date(sync.synced_at), { addSuffix: true })}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${st.badge}`}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right column — Records by Sensor + ESM Response Rate */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* Records by Sensor */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800 text-sm">Records by Sensor</h2>
              <span className="text-xs text-gray-400">{fmt(totalRecords ?? 0)} total</span>
            </div>
            <div className="px-5 py-3 space-y-2.5">
              {sensorCounts.map(sensor => (
                <div key={sensor.key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-600 font-medium">{sensor.label}</span>
                    <span className="text-xs text-gray-400 tabular-nums">{fmt(sensor.count)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-400 rounded-full transition-all"
                      style={{ width: `${maxCount > 0 ? (sensor.count / maxCount) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
              {sensorCounts.every(c => c.count === 0) && (
                <p className="text-gray-400 text-xs text-center py-4">No sensor data collected yet</p>
              )}
            </div>
          </div>

          {/* ESM Response Rate */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-violet-500" />
                <h2 className="font-semibold text-gray-800 text-sm">ESM Response Rate</h2>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-medium">
                <span className="flex items-center gap-1 text-emerald-600"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />responded</span>
                <span className="flex items-center gap-1 text-red-400"><span className="w-1.5 h-1.5 rounded-full bg-red-300 inline-block" />expired</span>
                <span className="flex items-center gap-1 text-gray-400"><span className="w-1.5 h-1.5 rounded-full bg-gray-200 inline-block" />pending</span>
              </div>
            </div>
            {esmRates.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <MessageSquare size={22} className="mx-auto text-gray-300 mb-2" />
                <p className="text-gray-400 text-xs">No ESM responses in this period</p>
              </div>
            ) : (
              <div className="px-5 py-3 space-y-4">
                {esmRates.map(s => {
                  const rate = s.total > 0 ? Math.round((s.responded / s.total) * 100) : 0
                  const expiredPct = s.total > 0 ? (s.expired / s.total) * 100 : 0
                  const pendingPct = s.total > 0 ? (s.pending / s.total) * 100 : 0
                  return (
                    <div key={s.id}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-gray-700 font-medium truncate max-w-36">{s.name}</span>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-xs font-bold text-gray-900 tabular-nums">{rate}%</span>
                          <span className="text-[11px] text-gray-400 tabular-nums">{s.responded}/{s.total}</span>
                        </div>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
                        <div className="h-full bg-emerald-400 transition-all" style={{ width: `${rate}%` }} />
                        <div className="h-full bg-red-300 transition-all" style={{ width: `${expiredPct}%` }} />
                        <div className="h-full bg-gray-200 transition-all" style={{ width: `${pendingPct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Participant Activity Heatmap */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800 text-sm">Participant Activity</h2>
              <span className="text-xs text-gray-400">synced per day</span>
            </div>
            {heatmapParticipants.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-gray-400 text-xs">No active participants</p>
              </div>
            ) : (
              <div className="px-5 py-4 overflow-x-auto">
                {/* Day labels */}
                <div className="flex items-center mb-2 ml-24 gap-0.5">
                  {heatmapDays.map(day => (
                    <div key={day} className="flex-1 text-center">
                      <span className="text-[9px] text-gray-300 font-medium">
                        {new Date(day + 'T12:00:00').toLocaleDateString('en', { weekday: 'narrow' })}
                      </span>
                    </div>
                  ))}
                </div>
                {/* Rows */}
                <div className="space-y-1">
                  {heatmapParticipants.map(p => (
                    <div key={p.id} className="flex items-center gap-0.5">
                      <span className="w-24 shrink-0 text-[11px] text-gray-500 font-medium truncate pr-2 text-right">
                        {p.label || p.device_id.slice(-8)}
                      </span>
                      {heatmapDays.map(day => {
                        const active = heatmapSynced.has(`${p.id}|${day}`)
                        return (
                          <div
                            key={day}
                            title={`${p.label || p.device_id} · ${day}`}
                            className={`flex-1 h-5 rounded-sm transition-colors ${active ? 'bg-emerald-400' : 'bg-gray-100'}`}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-3 mt-3 text-[11px] text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-400 inline-block" /> synced</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-100 inline-block" /> no sync</span>
                </div>
              </div>
            )}
          </div>

          {/* ESM Response Time Heatmap */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-violet-500" />
                <h2 className="font-semibold text-gray-800 text-sm">ESM Response Times</h2>
              </div>
              <span className="text-xs text-gray-400">by hour &amp; day</span>
            </div>
            {esmResponseTimes.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <MessageSquare size={22} className="mx-auto text-gray-300 mb-2" />
                <p className="text-gray-400 text-xs">No responses in this period</p>
              </div>
            ) : (
              <div className="px-4 py-4 overflow-x-auto">
                <div className="flex items-center mb-1 ml-9">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="flex-1 text-center">
                      {h % 4 === 0 && (
                        <span className="text-[9px] text-gray-400 font-medium">
                          {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, dow) => (
                    <div key={dow} className="flex items-center gap-0.5">
                      <span className="w-9 shrink-0 text-[10px] text-gray-400 font-medium text-right pr-2">{day}</span>
                      {esmHeatmap[dow].map((count, hour) => {
                        const intensity = count / esmHeatMax
                        const bg = count === 0
                          ? 'bg-gray-100'
                          : intensity < 0.25 ? 'bg-violet-100'
                          : intensity < 0.5  ? 'bg-violet-300'
                          : intensity < 0.75 ? 'bg-violet-500'
                          : 'bg-violet-700'
                        return (
                          <div
                            key={hour}
                            title={`${day} ${hour}:00 — ${count} response${count !== 1 ? 's' : ''}`}
                            className={`flex-1 h-5 rounded-sm ${bg} transition-colors cursor-default`}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-1 mt-3">
                  <span className="text-[10px] text-gray-400 mr-1">fewer</span>
                  {['bg-gray-100', 'bg-violet-100', 'bg-violet-300', 'bg-violet-500', 'bg-violet-700'].map(c => (
                    <span key={c} className={`w-3.5 h-3.5 rounded-sm ${c} inline-block`} />
                  ))}
                  <span className="text-[10px] text-gray-400 ml-1">more</span>
                </div>
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  )
}

export default function OverviewPage() {
  return (
    <Suspense>
      <OverviewContent />
    </Suspense>
  )
}
