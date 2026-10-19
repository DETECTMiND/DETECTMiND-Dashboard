'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { ChevronRight, GitMerge } from 'lucide-react'

type Audit = {
  id: string
  primary_participant_id: string
  duplicate_participant_id: string
  merged_by: string | null
  merged_at: string
  adopted_at: string | null
}

/** Collapsible list of the study's latest participant merges. */
export function MergeAudit({ studyId, names }: { studyId: string; names: Record<string, string> }) {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<Audit[]>([])
  useEffect(() => {
    let cancelled = false
    supabase.from('participant_merge_audit').select('*')
      .eq('study_id', studyId).order('merged_at', { ascending: false }).limit(20)
      .then(({ data }) => { if (!cancelled) setRows((data || []) as Audit[]) })
    return () => { cancelled = true }
  }, [supabase, studyId])
  if (!rows.length) return null
  const name = (id: string) => names[id] || id.slice(0, 8)
  return (
    <details className="group rounded-xl border border-line bg-surface shadow-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-fg [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="text-subtle transition-transform group-open:rotate-90" aria-hidden="true" />
        <GitMerge size={14} className="text-subtle" aria-hidden="true" /> Merge history ({rows.length})
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {rows.map(row => (
          <li key={row.id} className="px-4 py-3 text-xs text-muted">
            <p><strong className="text-fg">{name(row.duplicate_participant_id)}</strong> merged into <strong className="text-fg">{name(row.primary_participant_id)}</strong></p>
            <p className="mt-0.5 text-subtle">
              {new Date(row.merged_at).toLocaleString()} · by researcher {row.merged_by?.slice(0, 8) || 'unknown'} · {row.adopted_at ? `phone switched over ${new Date(row.adopted_at).toLocaleString()}` : 'waiting for the phone to switch over'}
            </p>
          </li>
        ))}
      </ul>
    </details>
  )
}
