'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Smartphone, Pencil, Database } from 'lucide-react'
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

export default function ParticipantsPage() {
  const { id: studyId } = useParams()
  const supabase = createClient()
  const [participants, setParticipants] = useState<Participant[]>([])
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [labelValue, setLabelValue] = useState('')

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

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/studies/${studyId}`} className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors mb-4">
          <ArrowLeft size={15} /> Back to Study
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Participants</h1>
        <p className="text-gray-500 text-sm mt-0.5">{participants.length} enrolled</p>
      </div>

      {participants.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 border-dashed py-16 text-center">
          <Smartphone size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No participants yet</p>
          <p className="text-gray-400 text-sm mt-1">Participants appear here when they join via the mobile app</p>
        </div>
      ) : (
        <div className="space-y-3">
          {participants.map(p => {
            const missing = getMissingPermissions(p)
            const hasPermIssues = missing[0] === 'no permissions reported' ? !p.permissions : missing.length > 0
            const stale = isSyncStale(p)

            return (
              <div key={p.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
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
                            <button onClick={() => saveLabel(p.id)} className="text-blue-600 text-sm font-medium hover:text-blue-700">Save</button>
                            <button onClick={() => setEditingLabel(null)} className="text-gray-400 text-sm hover:text-gray-600">Cancel</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingLabel(p.id); setLabelValue(p.label || '') }}
                            className="flex items-center gap-1.5 font-semibold text-gray-900 hover:text-blue-600 transition-colors group"
                          >
                            {p.label || p.device_id}
                            <Pencil size={12} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
                          </button>
                        )}
                        {p.label && <span className="text-gray-400 text-xs font-mono">{p.device_id}</span>}
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-500'}`}>
                          {p.status}
                        </span>
                      </div>

                      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-400">
                        <span>Enrolled {formatDistanceToNow(new Date(p.enrolled_at), { addSuffix: true })}</span>
                        <span className="flex items-center gap-1">
                          <Clock size={11} />
                          {p.last_sync_at
                            ? `Synced ${formatDistanceToNow(new Date(p.last_sync_at), { addSuffix: true })}`
                            : 'Never synced'}
                        </span>
                        {p.device_info?.model && <span>{p.device_info.model}</span>}
                        {p.device_info?.os_version && <span>OS {p.device_info.os_version}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/studies/${studyId}/data?participant=${p.id}`}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-blue-600 hover:border-blue-200 transition-all"
                      >
                        <Database size={12} /> View Data
                      </Link>
                      <select
                        value={p.status}
                        onChange={e => updateStatus(p.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                      >
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>

                  {(stale || hasPermIssues) && (
                    <div className="mt-3 pt-3 border-t border-gray-50 flex flex-wrap gap-2">
                      {stale && (
                        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-full text-xs font-medium">
                          <AlertTriangle size={11} /> Sync stale
                        </span>
                      )}
                      {hasPermIssues ? (
                        missing.map(m => (
                          <span key={m} className="inline-flex items-center gap-1 bg-red-50 text-red-600 border border-red-200 px-2.5 py-0.5 rounded-full text-xs font-medium">
                            <AlertTriangle size={11} /> {m}
                          </span>
                        ))
                      ) : p.permissions ? (
                        <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full text-xs font-medium">
                          <CheckCircle2 size={11} /> All permissions granted
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
