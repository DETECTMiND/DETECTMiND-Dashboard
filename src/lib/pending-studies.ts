import type { SupabaseClient } from '@supabase/supabase-js'

// A study is pending admin approval while it is a draft that was never
// approved (an admin moving an approved study back to draft keeps approved_at).
// RLS limits the rows: admins count every pending study, others only their own.

export function isPendingApproval(study: { status?: string | null; approved_at?: string | null } | null | undefined): boolean {
  return !!study && study.status === 'draft' && !study.approved_at
}

/** Number of studies waiting for admin approval (0 on error). Works with the browser or server client. */
export async function fetchPendingStudyCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('studies')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'draft')
    .is('approved_at', null)
  if (error) return 0
  return count ?? 0
}

export const STUDY_STATUSES = ['draft', 'active', 'paused', 'completed'] as const
export type StudyStatus = (typeof STUDY_STATUSES)[number]

/**
 * Status values the caller may pick for a study (mirrors tr_studies_status_guard):
 * admins any; owners only active / paused / completed on an approved study that
 * is not in draft; editors and viewers none (only the current value).
 * Always includes the current status. `editable` is false when nothing else can be picked.
 */
export function statusOptionsFor(
  role: 'admin' | 'owner' | 'editor' | 'viewer' | null,
  study: { status: string; approved_at?: string | null },
): { options: string[]; editable: boolean; reason: string | null } {
  if (role === 'admin') return { options: [...STUDY_STATUSES], editable: true, reason: null }
  if (role === 'owner') {
    if (study.status === 'draft') {
      return {
        options: ['draft'], editable: false,
        reason: study.approved_at
          ? 'An admin moved this study back to draft. Only an admin can reactivate it.'
          : 'This study is waiting for admin approval. Only an admin can activate it.',
      }
    }
    return { options: ['active', 'paused', 'completed'], editable: true, reason: null }
  }
  return { options: [study.status], editable: false, reason: 'Only a study owner or an admin can change the study status.' }
}

/** Window event fired after a study is approved, rejected or deleted, so a pending-count badge can refetch. */
export const PENDING_STUDIES_CHANGED_EVENT = 'detectmind:pending-studies-changed'

export function notifyPendingStudiesChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PENDING_STUDIES_CHANGED_EVENT))
}
