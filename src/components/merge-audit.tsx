'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { GitMerge } from 'lucide-react'

type Audit = {
  id: string
  primary_participant_id: string
  duplicate_participant_id: string
  merged_by: string | null
  merged_at: string
  adopted_at: string | null
}

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
  return <details className="rounded-xl border border-gray-200 bg-white">
    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-700 flex items-center gap-2">
      <GitMerge size={14} /> Merge audit ({rows.length})
    </summary>
    <div className="border-t border-gray-100 divide-y divide-gray-100">
      {rows.map(row => <div key={row.id} className="px-4 py-3 text-xs text-gray-600">
        <p><strong>{names[row.duplicate_participant_id] || row.duplicate_participant_id.slice(0, 8)}</strong> merged into <strong>{names[row.primary_participant_id] || row.primary_participant_id.slice(0, 8)}</strong></p>
        <p className="text-gray-400 mt-0.5">
          {new Date(row.merged_at).toLocaleString()} · researcher {row.merged_by?.slice(0, 8) || 'unknown'} · {row.adopted_at ? `device adopted ${new Date(row.adopted_at).toLocaleString()}` : 'waiting for device adoption'}
        </p>
      </div>)}
    </div>
  </details>
}
