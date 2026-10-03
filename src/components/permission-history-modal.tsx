'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { ShieldCheck, X, AlertTriangle, CheckCircle } from 'lucide-react'

interface Participant {
  id: string
  device_id: string
  label: string | null
}

interface EventRow {
  permission: string
  action: string      // granted | revoked
  recorded_at: string
}

interface OutageRow {
  permission: string
  revoked_at: string
  restored_at: string | null
  outage_minutes: number | null
}

function pName(p: Participant) { return p.label || p.device_id }

function fmt(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) } catch { return iso }
}

function prettyPerm(p: string): string {
  return p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtDuration(mins: number | null): string {
  if (mins == null) return 'still off'
  if (mins < 60) return `${Math.round(mins)}m`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function PermissionHistoryModal({
  participant, onClose,
}: {
  participant: Participant
  onClose: () => void
}) {
  const supabase = createClient()
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [outages, setOutages] = useState<OutageRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'outages' | 'events'>('outages')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [evRes, outRes] = await Promise.all([
      supabase.from('data_permission_events')
        .select('permission, action, recorded_at')
        .eq('participant_id', participant.id)
        .order('recorded_at', { ascending: false })
        .limit(2000),
      supabase.from('permission_outages')
        .select('permission, revoked_at, restored_at, outage_minutes')
        .eq('participant_id', participant.id)
        .order('revoked_at', { ascending: false })
        .limit(2000),
    ])
    setEvents((evRes.data || []) as EventRow[])
    setOutages((outRes.data || []) as OutageRow[])
    setLoading(false)
  }, [participant.id])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Current state per permission (from the latest event).
  const currentState = useMemo(() => {
    const map: Record<string, { action: string; at: string }> = {}
    for (const e of (events || [])) {
      if (!map[e.permission]) map[e.permission] = { action: e.action, at: e.recorded_at }
    }
    return map
  }, [events])

  const openOutages = (outages || []).filter(o => o.restored_at == null).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
              <ShieldCheck size={18} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Permission History</h2>
              <p className="text-xs text-gray-400">{pName(participant)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5 text-xs">
              {(['outages', 'events'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-md font-medium transition-all ${tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {t === 'outages' ? 'Outages' : 'All events'}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Current-state summary */}
        {!loading && Object.keys(currentState).length > 0 && (
          <div className="px-6 py-3 border-b border-gray-50 flex flex-wrap gap-2">
            {Object.entries(currentState).map(([perm, s]) => {
              const granted = s.action === 'granted'
              return (
                <span key={perm} className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full ${granted ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  {granted ? <CheckCircle size={11} /> : <AlertTriangle size={11} />}
                  {prettyPerm(perm)}
                </span>
              )
            })}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-12 text-center">
              <div className="h-6 w-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : tab === 'outages' ? (
            (outages && outages.length > 0) ? (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide">
                    <th className="px-6 py-2.5 font-semibold">Permission</th>
                    <th className="px-4 py-2.5 font-semibold">Turned off</th>
                    <th className="px-4 py-2.5 font-semibold">Turned back on</th>
                    <th className="px-4 py-2.5 font-semibold">Off for</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {outages.map((o, i) => (
                    <tr key={i} className="hover:bg-amber-50/30">
                      <td className="px-6 py-2.5 text-gray-800 font-medium">{prettyPerm(o.permission)}</td>
                      <td className="px-4 py-2.5 text-gray-600">{fmt(o.revoked_at)}</td>
                      <td className="px-4 py-2.5 text-gray-600">{fmt(o.restored_at)}</td>
                      <td className={`px-4 py-2.5 font-medium ${o.restored_at ? 'text-gray-700' : 'text-red-600'}`}>{fmtDuration(o.outage_minutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState text="No permission outages recorded" sub="This participant hasn't turned any permission off." />
            )
          ) : (
            (events && events.length > 0) ? (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide">
                    <th className="px-6 py-2.5 font-semibold">Permission</th>
                    <th className="px-4 py-2.5 font-semibold">Change</th>
                    <th className="px-4 py-2.5 font-semibold">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {events.map((e, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-6 py-2.5 text-gray-800 font-medium">{prettyPerm(e.permission)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${e.action === 'granted' ? 'text-emerald-700' : 'text-red-600'}`}>
                          {e.action === 'granted' ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                          {e.action === 'granted' ? 'Granted' : 'Revoked'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{fmt(e.recorded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState text="No permission events recorded" sub="Permission changes will appear here once the app reports them." />
            )
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-400 shrink-0">
            {openOutages > 0
              ? `${openOutages} permission${openOutages > 1 ? 's' : ''} currently turned off`
              : 'All tracked permissions currently granted'}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ text, sub }: { text: string; sub: string }) {
  return (
    <div className="p-12 text-center">
      <ShieldCheck size={32} className="mx-auto text-gray-300 mb-3" />
      <p className="text-gray-600 font-medium">{text}</p>
      <p className="text-gray-400 text-sm mt-1">{sub}</p>
    </div>
  )
}
