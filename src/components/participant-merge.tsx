'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Users, AlertTriangle, CheckCircle, GitMerge, X, ArrowRight, ShieldAlert } from 'lucide-react'

type SyncLogRow = { participant_id: string; synced_at: string; records_synced: number | null }

interface Participant {
  id: string
  device_id: string
  label: string | null
  status: string
  enrolled_at: string
  last_sync_at: string | null
  device_info: Record<string, string> | null
  merged_into?: string | null
}

type Safety = 'safe' | 'review' | 'risky'

interface Timeline { first: string | null; last: string | null; records: number }

// Base device_id = strip a trailing _N suffix.
function baseId(deviceId: string): string {
  return deviceId.replace(/_\d+$/, '')
}

function pName(p: Participant): string {
  return p.label || p.device_id
}

function model(p: Participant): string | null {
  const di = p.device_info || {}
  return (di.model || di.device || di.manufacturer || null)
}

/**
 * Suggests merges for participants that share a base device_id (X, X_2, X_3).
 * Conservative: only labels a pair "safe" when device models match AND their
 * data timelines do not overlap (classic reinstall). Everything else is "review".
 */
export function MergeSuggestions({
  participants, onMerged,
}: {
  participants: Participant[]
  onMerged: () => void
}) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [timelines, setTimelines] = useState<Record<string, Timeline>>({})
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')

  // Group non-merged participants by base id, keep only groups with 2+ members.
  const groups = useMemo(() => {
    const g: Record<string, Participant[]> = {}
    for (const p of participants) {
      if (p.merged_into) continue // already merged away
      const b = baseId(p.device_id)
      ;(g[b] ||= []).push(p)
    }
    return Object.entries(g)
      .filter(([, members]) => members.length > 1)
      .map(([base, members]) => ({
        base,
        members: [...members].sort((a, b) => a.enrolled_at.localeCompare(b.enrolled_at)),
      }))
  }, [participants])

  // Which group the researcher is inspecting + the chosen primary.
  const [activeBase, setActiveBase] = useState<string | null>(null)
  const [primaryId, setPrimaryId] = useState<string | null>(null)

  // Load data timelines (min/max sync, record count) for members once expanded.
  useEffect(() => {
    if (!open || groups.length === 0) return
    async function loadTimelines() {
      const ids = groups.flatMap(g => g.members.map(m => m.id))
      const { data } = await supabase
        .from('sync_log')
        .select('participant_id, synced_at, records_synced')
        .in('participant_id', ids)
      const tl: Record<string, Timeline> = {}
      for (const id of ids) tl[id] = { first: null, last: null, records: 0 }
      for (const row of (data || []) as SyncLogRow[]) {
        const t = tl[row.participant_id]
        if (!t) continue
        const ts = row.synced_at as string
        if (!t.first || ts < t.first) t.first = ts
        if (!t.last || ts > t.last) t.last = ts
        t.records += row.records_synced || 0
      }
      setTimelines(tl)
    }
    loadTimelines()
  }, [open, groups]) // eslint-disable-line react-hooks/exhaustive-deps

  function overlaps(a: Timeline, b: Timeline): boolean {
    if (!a.first || !a.last || !b.first || !b.last) return false
    return a.first <= b.last && b.first <= a.last
  }

  // Safety of merging all members of a group onto one primary.
  function groupSafety(members: Participant[]): Safety {
    const models = members.map(model)
    const modelsMatch = models.every(m => m && m === models[0])
    // Any pair of overlapping timelines => risky (likely two different people).
    let anyOverlap = false
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const ti = timelines[members[i].id]
        const tj = timelines[members[j].id]
        if (ti && tj && overlaps(ti, tj)) anyOverlap = true
      }
    }
    if (anyOverlap) return 'risky'
    if (modelsMatch) return 'safe'
    return 'review'
  }

  if (groups.length === 0) return null

  const active = groups.find(g => g.base === activeBase)

  async function doMerge() {
    if (!active || !primaryId) return
    setMerging(true); setError(null)
    try {
      const dups = active.members.filter(m => m.id !== primaryId)
      for (const d of dups) {
        const { error } = await supabase.rpc('merge_participants', {
          p_primary: primaryId,
          p_duplicate: d.id,
        })
        if (error) throw error
      }
      setActiveBase(null); setPrimaryId(null); setConfirmText('')
      onMerged()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setMerging(false)
    }
  }

  const safetyBadge = (s: Safety) => {
    if (s === 'safe') return <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle size={12} /> Likely safe</span>
    if (s === 'review') return <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle size={12} /> Review</span>
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600"><ShieldAlert size={12} /> Risky</span>
  }

  return (
    <>
      {/* Banner */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-amber-800">
          <GitMerge size={16} />
          <span>
            <strong>{groups.length}</strong> possible duplicate{groups.length > 1 ? 's' : ''} detected
            {' '}(same device re-enrolled as <code>_2</code>, <code>_3</code>…)
          </span>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className="text-sm font-semibold text-amber-800 hover:text-amber-900 underline shrink-0"
        >
          {open ? 'Hide' : 'Review merges'}
        </button>
      </div>

      {/* Groups */}
      {open && (
        <div className="space-y-3">
          {groups.map(g => {
            const safety = groupSafety(g.members)
            return (
              <div key={g.base} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <Users size={15} className="text-gray-400" />
                    <span className="text-sm font-semibold text-gray-700">{g.base}</span>
                    <span className="text-xs text-gray-400">· {g.members.length} participants</span>
                  </div>
                  {safetyBadge(safety)}
                </div>
                <div className="divide-y divide-gray-50">
                  {g.members.map(m => {
                    const tl = timelines[m.id]
                    return (
                      <div key={m.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-800 truncate">{pName(m)}</p>
                          <p className="text-xs text-gray-400">
                            {model(m) || 'unknown device'} · enrolled {new Date(m.enrolled_at).toLocaleDateString()}
                            {tl && tl.first && ` · data ${new Date(tl.first).toLocaleDateString()}–${tl.last ? new Date(tl.last).toLocaleDateString() : '…'} (${tl.records.toLocaleString()})`}
                          </p>
                        </div>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${m.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {m.status}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="px-4 py-3 bg-gray-50 flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500">
                    {safety === 'risky'
                      ? 'Timelines overlap — these may be different people. Merge only if you are sure.'
                      : safety === 'review'
                        ? 'Device models differ — confirm these are the same participant before merging.'
                        : 'Matching device, non-overlapping data — consistent with a reinstall.'}
                  </p>
                  <button
                    onClick={() => { setActiveBase(g.base); setPrimaryId(g.members[0].id); setConfirmText(''); setError(null) }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 shrink-0"
                  >
                    Merge…
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Merge confirmation modal */}
      {active && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !merging && setActiveBase(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><GitMerge size={18} /> Merge participants</h2>
              <button onClick={() => !merging && setActiveBase(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <p className="text-sm text-gray-600 mb-3">Choose which participant keeps all the data. The others are merged into it and marked withdrawn.</p>

            <div className="space-y-2 mb-4">
              {active.members.map(m => (
                <label key={m.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer ${primaryId === m.id ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                  <input type="radio" checked={primaryId === m.id} onChange={() => setPrimaryId(m.id)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{pName(m)}</p>
                    <p className="text-xs text-gray-400">{model(m) || 'unknown'} · enrolled {new Date(m.enrolled_at).toLocaleDateString()}</p>
                  </div>
                  {primaryId === m.id && <span className="text-xs font-semibold text-blue-600 shrink-0">Primary</span>}
                </label>
              ))}
            </div>

            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 mb-4 flex gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>This re-points all sensor data from the other {active.members.length - 1} participant(s) onto the primary. The duplicate rows are kept (withdrawn) but the data move is <strong>not automatically reversible</strong>.</span>
            </div>

            <label className="block text-xs text-gray-500 mb-1">Type <strong>MERGE</strong> to confirm</label>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="MERGE"
            />

            {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setActiveBase(null)} disabled={merging} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg">Cancel</button>
              <button
                onClick={doMerge}
                disabled={merging || confirmText !== 'MERGE' || !primaryId}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 flex items-center gap-1.5"
              >
                {merging ? 'Merging…' : <>Merge <ArrowRight size={14} /></>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
