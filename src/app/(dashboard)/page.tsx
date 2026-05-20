'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState } from 'react'
import {
  Users, AlertTriangle, CheckCircle2, Wifi,
  Database, ArrowUpRight, ChevronRight,
} from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

interface SensorCount {
  key: string
  label: string
  count: number
}

interface SyncBreakdown {
  success: number
  partial: number
  error: number
  total: number
}

interface RecentSync {
  synced_at: string
  status: string
  records_synced: number
  participant: { label: string; device_id: string; study: { id: string; name: string } }
}

const SYNC_STATUS: Record<string, { dot: string; badge: string; label: string }> = {
  success: { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Success' },
  partial:  { dot: 'bg-amber-400',  badge: 'bg-amber-50 text-amber-700 border-amber-200',    label: 'Partial' },
  error:    { dot: 'bg-red-400',    badge: 'bg-red-50 text-red-700 border-red-200',           label: 'Error' },
}

const SENSOR_LABELS: Record<string, string> = {
  data_app_usage:         'App Usage',
  data_notifications:     'Notifications',
  data_battery:           'Battery',
  data_calls:             'Calls',
  data_sms:               'SMS',
  data_esm_responses:     'ESM/EMA',
  data_location:          'Location',
  data_light:             'Light',
  data_screen_state:      'Screen State',
  data_screen_interaction:'Screen Interaction',
}

const SENSOR_TABLES = Object.keys(SENSOR_LABELS) as Array<keyof typeof SENSOR_LABELS>

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export default function OverviewPage() {
  const supabase = createClient()

  const [participants, setParticipants] = useState<{ total: number; active: number } | null>(null)
  const [sensorCounts, setSensorCounts] = useState<SensorCount[] | null>(null)
  const [totalRecords, setTotalRecords] = useState<number | null>(null)
  const [syncBreakdown, setSyncBreakdown] = useState<SyncBreakdown | null>(null)
  const [recentSyncs, setRecentSyncs] = useState<RecentSync[] | null>(null)
  const [issueParticipants, setIssueParticipants] = useState<any[] | null>(null)

  useEffect(() => {
    async function load() {
      // Participants + last-sync info
      const { data: pData } = await supabase
        .from('participants')
        .select('id, status, permissions, label, device_id, study_id, last_sync_at')

      const parts = pData || []
      const issues = parts.filter(p => {
        if (p.status !== 'active') return false
        const perms = p.permissions as Record<string, boolean> | null
        if (!perms) return true
        return Object.values(perms).some(v => v === false)
      })
      setParticipants({ total: parts.length, active: parts.filter(p => p.status === 'active').length })
      setIssueParticipants(issues)

      // Sensor record counts — all in parallel
      const countResults = await Promise.all(
        SENSOR_TABLES.map(tbl =>
          supabase.from(tbl as any).select('*', { count: 'exact', head: true })
        )
      )
      const counts: SensorCount[] = SENSOR_TABLES.map((tbl, i) => ({
        key: tbl,
        label: SENSOR_LABELS[tbl],
        count: countResults[i].count ?? 0,
      })).sort((a, b) => b.count - a.count)
      setSensorCounts(counts)
      setTotalRecords(counts.reduce((sum, c) => sum + c.count, 0))

      // Sync breakdown from last 50 syncs
      const { data: syncData } = await supabase
        .from('sync_log')
        .select('synced_at, status, records_synced, participant_id')
        .order('synced_at', { ascending: false })
        .limit(50)

      const syncs = syncData || []
      const breakdown: SyncBreakdown = { success: 0, partial: 0, error: 0, total: syncs.length }
      syncs.forEach(s => { if (s.status in breakdown) (breakdown as any)[s.status]++ })
      setSyncBreakdown(breakdown)

      // Enrich recent 20 syncs with participant + study info
      const recent20 = syncs.slice(0, 20)
      if (recent20.length > 0) {
        const pIds = [...new Set(recent20.map(s => s.participant_id))]
        const { data: pInfo } = await supabase.from('participants').select('id, label, device_id, study_id').in('id', pIds)
        const { data: sInfo } = await supabase.from('studies').select('id, name')
        const pMap = Object.fromEntries((pInfo || []).map(p => [p.id, p]))
        const sMap = Object.fromEntries((sInfo || []).map(s => [s.id, s]))
        setRecentSyncs(
          recent20.map(sync => ({
            ...sync,
            participant: {
              ...(pMap[sync.participant_id] || { label: null, device_id: 'unknown' }),
              study: sMap[(pMap[sync.participant_id] || {}).study_id] || { id: '', name: 'Unknown' },
            },
          })) as any
        )
      } else {
        setRecentSyncs([])
      }
    }
    load()
  }, [])

  const loading = participants === null || sensorCounts === null || recentSyncs === null || issueParticipants === null

  if (loading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div>
          <div className="h-7 bg-gray-200 rounded-lg w-32 mb-2" />
          <div className="h-4 bg-gray-100 rounded w-64" />
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

  const maxCount = Math.max(...(sensorCounts?.map(c => c.count) ?? [1]), 1)
  const successRate = syncBreakdown && syncBreakdown.total > 0
    ? Math.round((syncBreakdown.success / syncBreakdown.total) * 100)
    : null

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
          <p className="text-gray-500 text-sm mt-0.5">Data collection health across all studies</p>
        </div>
        <Link
          href="/studies"
          className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
        >
          View studies <ArrowUpRight size={14} />
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Participants */}
        <div className="bg-white rounded-xl p-5 border border-gray-200">
          <div className="flex items-start justify-between mb-4">
            <div className="p-2.5 rounded-xl bg-emerald-50">
              <Users size={18} className="text-emerald-600" />
            </div>
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mt-1">Enrolled</span>
          </div>
          <div className="text-3xl font-bold text-gray-900 tabular-nums">{participants.total}</div>
          <div className="text-sm text-gray-500 mt-0.5">Participants</div>
          <div className="mt-4 space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>{participants.active} active</span>
              <span>{participants.total ? Math.round((participants.active / participants.total) * 100) : 0}%</span>
            </div>
            <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: participants.total ? `${(participants.active / participants.total) * 100}%` : '0%' }}
              />
            </div>
          </div>
        </div>

        {/* Total Records */}
        <div className="bg-white rounded-xl p-5 border border-gray-200">
          <div className="flex items-start justify-between mb-4">
            <div className="p-2.5 rounded-xl bg-blue-50">
              <Database size={18} className="text-blue-600" />
            </div>
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mt-1">All sensors</span>
          </div>
          <div className="text-3xl font-bold text-gray-900 tabular-nums">{formatCount(totalRecords ?? 0)}</div>
          <div className="text-sm text-gray-500 mt-0.5">Records Collected</div>
          <div className="mt-4 text-xs text-gray-400">
            Across {sensorCounts?.filter(c => c.count > 0).length ?? 0} active sensor{sensorCounts?.filter(c => c.count > 0).length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Sync Health */}
        <div className="bg-white rounded-xl p-5 border border-gray-200">
          <div className="flex items-start justify-between mb-4">
            <div className="p-2.5 rounded-xl bg-violet-50">
              <Wifi size={18} className="text-violet-600" />
            </div>
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mt-1">Last 50</span>
          </div>
          <div className="text-3xl font-bold text-gray-900 tabular-nums">
            {successRate !== null ? `${successRate}%` : '—'}
          </div>
          <div className="text-sm text-gray-500 mt-0.5">Sync Success Rate</div>
          <div className="mt-4 flex items-center gap-2.5 text-[11px]">
            <span className="flex items-center gap-1 text-emerald-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              {syncBreakdown?.success ?? 0}
            </span>
            <span className="flex items-center gap-1 text-amber-600">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
              {syncBreakdown?.partial ?? 0}
            </span>
            <span className="flex items-center gap-1 text-red-500">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
              {syncBreakdown?.error ?? 0}
            </span>
            <span className="text-gray-300">of {syncBreakdown?.total ?? 0}</span>
          </div>
        </div>

        {/* Permission Issues */}
        <div className={`rounded-xl p-5 border transition-all ${
          (issueParticipants?.length ?? 0) > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-start justify-between mb-4">
            <div className={`p-2.5 rounded-xl ${(issueParticipants?.length ?? 0) > 0 ? 'bg-red-100' : 'bg-gray-50'}`}>
              <AlertTriangle size={18} className={(issueParticipants?.length ?? 0) > 0 ? 'text-red-500' : 'text-gray-400'} />
            </div>
            {(issueParticipants?.length ?? 0) > 0 && (
              <span className="text-[10px] font-bold text-red-500 uppercase tracking-wide mt-1">Action needed</span>
            )}
          </div>
          <div className={`text-3xl font-bold tabular-nums ${(issueParticipants?.length ?? 0) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {issueParticipants?.length ?? 0}
          </div>
          <div className={`text-sm mt-0.5 ${(issueParticipants?.length ?? 0) > 0 ? 'text-red-500' : 'text-gray-500'}`}>
            Permission Issues
          </div>
          <div className={`mt-4 text-xs ${(issueParticipants?.length ?? 0) > 0 ? 'text-red-400' : 'text-gray-400'}`}>
            {(issueParticipants?.length ?? 0) === 0 ? 'All participants clear' : 'Among active participants'}
          </div>
        </div>

      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Recent Syncs */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800 text-sm">Recent Sync Activity</h2>
            <div className="flex items-center gap-3">
              {syncBreakdown && syncBreakdown.total > 0 && (
                <div className="flex items-center gap-2 text-[11px]">
                  {syncBreakdown.error > 0 && (
                    <span className="flex items-center gap-1 text-red-500 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      {syncBreakdown.error} error{syncBreakdown.error !== 1 ? 's' : ''}
                    </span>
                  )}
                  {syncBreakdown.partial > 0 && (
                    <span className="flex items-center gap-1 text-amber-600 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      {syncBreakdown.partial} partial
                    </span>
                  )}
                </div>
              )}
              <span className="text-xs text-gray-400">Last 20</span>
            </div>
          </div>

          {recentSyncs.length === 0 ? (
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
                {recentSyncs.map((sync, i) => {
                  const st = SYNC_STATUS[sync.status] || SYNC_STATUS.error
                  return (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} />
                          <p className="font-medium text-gray-800 text-xs">
                            {sync.participant?.label || sync.participant?.device_id}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-3 hidden sm:table-cell">
                        {sync.participant?.study?.id ? (
                          <Link
                            href={`/studies/${sync.participant.study.id}`}
                            className="text-xs text-gray-500 hover:text-blue-600 transition-colors hover:underline"
                          >
                            {sync.participant.study.name}
                          </Link>
                        ) : (
                          <span className="text-xs text-gray-400">{sync.participant?.study?.name}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right hidden md:table-cell">
                        <span className="text-xs text-gray-400 tabular-nums">
                          {sync.records_synced?.toLocaleString() ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right hidden md:table-cell">
                        <span className="text-xs text-gray-400">
                          {formatDistanceToNow(new Date(sync.synced_at), { addSuffix: true })}
                        </span>
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

        {/* Right column: Sensor Breakdown + Permission Issues stacked */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* Sensor data breakdown */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm flex-1">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800 text-sm">Records by Sensor</h2>
              <span className="text-xs text-gray-400">{formatCount(totalRecords ?? 0)} total</span>
            </div>
            <div className="px-5 py-3 space-y-2.5">
              {sensorCounts?.map(sensor => (
                <div key={sensor.key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-600 font-medium">{sensor.label}</span>
                    <span className="text-xs text-gray-400 tabular-nums">{formatCount(sensor.count)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-400 rounded-full transition-all"
                      style={{ width: `${maxCount > 0 ? (sensor.count / maxCount) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
              {sensorCounts?.every(c => c.count === 0) && (
                <p className="text-gray-400 text-xs text-center py-4">No sensor data collected yet</p>
              )}
            </div>
          </div>

          {/* Permission Issues */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800 text-sm">Permission Issues</h2>
              {(issueParticipants?.length ?? 0) > 0 && (
                <span className="flex items-center justify-center w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full">
                  {issueParticipants?.length}
                </span>
              )}
            </div>

            {(issueParticipants?.length ?? 0) === 0 ? (
              <div className="px-5 py-8 flex flex-col items-center text-center">
                <div className="w-9 h-9 bg-emerald-50 rounded-full flex items-center justify-center mb-2.5">
                  <CheckCircle2 size={18} className="text-emerald-500" />
                </div>
                <p className="text-gray-700 text-sm font-medium">All clear</p>
                <p className="text-gray-400 text-xs mt-1">All active participants have required permissions</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 max-h-52 overflow-y-auto">
                {issueParticipants?.map(p => {
                  const missing = Object.entries(p.permissions || {})
                    .filter(([, v]) => v === false)
                    .map(([k]) => k)
                  return (
                    <div key={p.id} className="px-5 py-3 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{p.label || p.device_id}</p>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {missing.length === 0 ? (
                              <span className="text-amber-600 text-[11px] bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md font-medium">
                                No permissions reported
                              </span>
                            ) : (
                              missing.map(m => (
                                <span key={m} className="bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-md text-[11px] font-medium">
                                  {m}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
