'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Users, AlertTriangle, CheckCircle, GitMerge, ArrowRight, ShieldAlert } from 'lucide-react'
import { Badge, Button, Card, Modal } from '@/components/ui'
import { errorText } from '@/components/feedback'
import { fetchAll } from '@/lib/csv'

type SyncLogRow = { participant_id: string; synced_at: string; records_synced: number | null }

interface Participant {
  id: string
  device_id: string
  label: string | null
  status: string
  enrolled_at: string
  last_sync_at: string | null
  device_info: Record<string, string | number | boolean> | null
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
  const value = di.model || di.device || di.manufacturer
  return value == null ? null : String(value)
}

function overlaps(a: Timeline, b: Timeline): boolean {
  if (!a.first || !a.last || !b.first || !b.last) return false
  return a.first <= b.last && b.first <= a.last
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
  const supabase = useMemo(() => createClient(), [])
  const listId = useId()
  const confirmId = useId()
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
      ;(g[baseId(p.device_id)] ||= []).push(p)
    }
    return Object.entries(g)
      .filter(([, members]) => members.length > 1)
      .map(([base, members]) => ({
        base,
        members: [...members].sort((a, b) => a.enrolled_at.localeCompare(b.enrolled_at)),
      }))
  }, [participants])

  // Which group the researcher is merging + the chosen primary.
  const [activeBase, setActiveBase] = useState<string | null>(null)
  const [primaryId, setPrimaryId] = useState<string | null>(null)

  // Data timelines (first/last sync, record count) for members once expanded.
  useEffect(() => {
    if (!open || groups.length === 0) return
    let cancelled = false
    const ids = groups.flatMap(g => g.members.map(m => m.id))
    fetchAll<SyncLogRow>((from, to) => supabase.from('sync_log')
      .select('participant_id, synced_at, records_synced')
      .in('participant_id', ids).order('id').range(from, to))
      .then(rows => {
        if (cancelled) return
        const tl: Record<string, Timeline> = {}
        for (const id of ids) tl[id] = { first: null, last: null, records: 0 }
        for (const row of rows) {
          const t = tl[row.participant_id]
          if (!t) continue
          if (!t.first || row.synced_at < t.first) t.first = row.synced_at
          if (!t.last || row.synced_at > t.last) t.last = row.synced_at
          t.records += row.records_synced || 0
        }
        setTimelines(tl)
      })
      .catch(() => { /* timelines are a hint only */ })
    return () => { cancelled = true }
  }, [open, groups, supabase])

  // Safety of merging all members of a group onto one primary.
  function groupSafety(members: Participant[]): Safety {
    const models = members.map(model)
    const modelsMatch = models.every(m => m && m === models[0])
    // Any pair of overlapping timelines => risky (likely two different people).
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const ti = timelines[members[i].id]
        const tj = timelines[members[j].id]
        if (ti && tj && overlaps(ti, tj)) return 'risky'
      }
    }
    return modelsMatch ? 'safe' : 'review'
  }

  function latestSyncOf(members: Participant[]) {
    return Math.max(...members.map(member => {
      const value = timelines[member.id]?.last || member.last_sync_at
      return value ? new Date(value).getTime() : 0
    }))
  }

  if (groups.length === 0) return null

  const active = groups.find(g => g.base === activeBase)

  async function doMerge() {
    if (!active || !primaryId) return
    setMerging(true); setError(null)
    try {
      for (const d of active.members.filter(m => m.id !== primaryId)) {
        const { error } = await supabase.rpc('merge_participants', { p_primary: primaryId, p_duplicate: d.id })
        if (error) throw new Error(errorText(error))
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
    if (s === 'safe') return <Badge tone="green" icon={<CheckCircle size={11} aria-hidden="true" />}>Likely safe</Badge>
    if (s === 'review') return <Badge tone="amber" icon={<AlertTriangle size={11} aria-hidden="true" />}>Check first</Badge>
    return <Badge tone="red" icon={<ShieldAlert size={11} aria-hidden="true" />}>Risky</Badge>
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-amber-800">
          <GitMerge size={16} aria-hidden="true" className="shrink-0" />
          <span>
            <strong>{groups.length}</strong> possible duplicate{groups.length > 1 ? 's' : ''}: the same phone joined again as <code>_2</code>, <code>_3</code>…
          </span>
        </p>
        <Button variant="secondary" size="sm" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={listId}>
          {open ? 'Hide' : 'Review merges'}
        </Button>
      </div>

      {open && (
        <div id={listId} className="space-y-3">
          {groups.map(g => {
            const safety = groupSafety(g.members)
            const latest = latestSyncOf(g.members)
            return (
              <Card key={g.base} padded={false} className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Users size={15} className="shrink-0 text-subtle" aria-hidden="true" />
                    <span className="truncate font-mono text-sm font-semibold text-fg">{g.base}</span>
                    <span className="text-xs text-subtle">· {g.members.length} participants</span>
                  </div>
                  {safetyBadge(safety)}
                </div>
                <ul className="divide-y divide-line">
                  {g.members.map(m => {
                    const tl = timelines[m.id]
                    const memberSync = tl?.last || m.last_sync_at
                    const likelyCurrent = !!memberSync && latest > 0 && new Date(memberSync).getTime() === latest
                    return (
                      <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-fg">{pName(m)}</p>
                          <p className="text-xs text-subtle">
                            {model(m) || 'Unknown device'} · joined {new Date(m.enrolled_at).toLocaleDateString()}
                            {tl && tl.first && ` · data ${new Date(tl.first).toLocaleDateString()} to ${tl.last ? new Date(tl.last).toLocaleDateString() : 'now'} (${tl.records.toLocaleString()} records)`}
                          </p>
                          {likelyCurrent && <p className="mt-0.5 text-[11px] font-semibold text-accent">Likely the current phone (most recent sync)</p>}
                        </div>
                        <Badge tone={m.status === 'active' ? 'green' : 'neutral'}>{m.status === 'active' ? 'Active' : 'Withdrawn'}</Badge>
                      </li>
                    )
                  })}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-3 bg-sunken px-4 py-3">
                  <p className="text-xs text-muted">
                    {safety === 'risky'
                      ? 'The data timelines overlap, so these may be different people. Merge only if you are sure.'
                      : safety === 'review'
                        ? 'The phone models differ. Check these are the same participant before merging.'
                        : 'Same phone model and no overlapping data, as expected after a reinstall.'}
                  </p>
                  <Button size="sm" onClick={() => { setActiveBase(g.base); setPrimaryId(g.members[0].id); setConfirmText(''); setError(null) }}>
                    Merge…
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={!!active} onClose={() => setActiveBase(null)} dismissible={!merging} size="md"
        title="Merge participants"
        icon={<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><GitMerge size={18} /></span>}
        description="Choose which participant keeps all the data. The phone using another account switches to it automatically at its next successful sync."
        footer={<>
          <Button variant="secondary" onClick={() => setActiveBase(null)} disabled={merging}>Cancel</Button>
          <Button onClick={doMerge} loading={merging} disabled={merging || confirmText !== 'MERGE' || !primaryId}>
            {merging ? 'Merging…' : <>Merge <ArrowRight size={14} aria-hidden="true" /></>}
          </Button>
        </>}>
        {active && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-fg">Keep the data on</legend>
              {active.members.map(m => {
                const latest = latestSyncOf(active.members)
                const value = timelines[m.id]?.last || m.last_sync_at
                const likelyCurrent = !!value && latest > 0 && new Date(value).getTime() === latest
                const on = primaryId === m.id
                return (
                  <label key={m.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 ${on ? 'border-accent bg-accent-soft' : 'border-line'}`}>
                    <input type="radio" name="merge-primary" checked={on} onChange={() => setPrimaryId(m.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{pName(m)}</span>
                      <span className="block text-xs text-subtle">{model(m) || 'Unknown device'} · joined {new Date(m.enrolled_at).toLocaleDateString()}{likelyCurrent ? ' · likely the current phone' : ''}</span>
                    </span>
                    {on && <span className="shrink-0 text-xs font-semibold text-accent">Keeps data</span>}
                  </label>
                )
              })}
            </fieldset>

            <p className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>All sensor data from the other {active.members.length - 1} participant{active.members.length - 1 === 1 ? '' : 's'} moves onto the one you chose. Keep the current phone online afterwards so it can switch over. This cannot be undone automatically.</span>
            </p>

            <div>
              <label htmlFor={confirmId} className="mb-1 block text-sm font-medium text-fg">Type <strong>MERGE</strong> to confirm</label>
              <input id={confirmId} value={confirmText} onChange={e => setConfirmText(e.target.value)} autoComplete="off" spellCheck={false}
                className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25" />
            </div>
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
        )}
      </Modal>
    </>
  )
}
