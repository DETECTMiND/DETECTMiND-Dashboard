'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState, Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Smartphone, Pencil, Database, MessageSquare, Search, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Participant {
  id: string
  device_id: string
  label: string | null
  status: string
  enrolled_at: string
  last_sync_at: string | null
  permissions: Record<string, boolean> | null
  device_info: Record<string, string> | null
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

function ParticipantsContent() {
  const { id: studyId } = useParams()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [participants, setParticipants] = useState<Participant[]>([])
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [labelValue, setLabelValue] = useState('')
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterKey>(() => {
    const f = searchParams.get('filter')
    return (f && ['all', 'active', 'withdrawn', 'stale', 'perm_missing'].includes(f) ? f : 'all') as FilterKey
  })

  async function load() {
    const { data } = await supabase
      .from('participants')
      .select('*')
      .eq('study_id', studyId)
      .order('enrolled_at', { ascending: false })
    setParticipants((data || []) as Participant[])
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
    return true // 'all'
  })

  // Per-filter counts — stale/perm only among active participants
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
            const isWarn  = f.key === 'stale' && count > 0
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

            return (
              <div
                key={p.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
              >
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
                          {p.device_info?.os_version && <span>OS {p.device_info.os_version}</span>}
                        </div>

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
                      <div className="flex items-center gap-2 shrink-0">
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
