import type { createClient } from '@/lib/supabase-browser'

// Queries on data_* tables scoped to one study or one participant. Rows have
// no study_id, so a study filter goes through the participants FK with an
// inner embed instead of a giant `.in('participant_id', [...])` URL. RLS still
// applies to both tables, exactly as before.

export type Client = ReturnType<typeof createClient>

export interface DataScope {
  studyId: string
  /** 'all' or a participant id */
  participant: string
}

/** Name of the embed added by `scopedSelect` for study-wide queries; strip it before showing or exporting rows. */
export const SCOPE_EMBED = 'participants'

export function scopedSelect(
  supabase: Client,
  table: string,
  scope: DataScope,
  columns = '*',
  options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean },
) {
  // The column list is dynamic, so type it as '*' (rows are plain records).
  if (scope.participant !== 'all') {
    return supabase.from(table).select(columns as '*', options).eq('participant_id', scope.participant)
  }
  const withEmbed = `${columns}, ${SCOPE_EMBED}!inner(study_id)` as '*'
  return supabase.from(table).select(withEmbed, options).eq(`${SCOPE_EMBED}.study_id`, scope.studyId)
}

/** Removes the scope embed from rows returned by `scopedSelect`. */
export function stripScope<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map(r => {
    if (!(SCOPE_EMBED in r)) return r
    const copy = { ...r }
    delete copy[SCOPE_EMBED]
    return copy
  })
}
