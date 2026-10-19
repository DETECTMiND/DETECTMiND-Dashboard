import { isPendingApproval } from './pending-studies'

// One place for how a study's status is named and coloured.

export type StatusTone = 'neutral' | 'green' | 'amber' | 'blue' | 'orange' | 'red' | 'violet'

export interface StudyStatusInfo {
  /** pending = draft that an admin has not approved yet */
  key: 'pending' | 'draft' | 'active' | 'paused' | 'completed' | 'archived'
  label: string
  tone: StatusTone
  /** Tailwind class for a small status dot */
  dot: string
  /** One-line explanation for tooltips and help text */
  description: string
}

const INFO: Record<StudyStatusInfo['key'], Omit<StudyStatusInfo, 'key'>> = {
  pending: { label: 'Pending approval', tone: 'orange', dot: 'bg-orange-500', description: 'Waiting for an admin to approve it. Participants cannot join yet.' },
  draft: { label: 'Draft', tone: 'neutral', dot: 'bg-slate-400', description: 'Approved but parked by an admin. Participants cannot join.' },
  active: { label: 'Active', tone: 'green', dot: 'bg-emerald-500', description: 'Participants can join and data is being collected.' },
  paused: { label: 'Paused', tone: 'amber', dot: 'bg-amber-400', description: 'Phones keep their data but stop collecting until it is resumed.' },
  completed: { label: 'Completed', tone: 'blue', dot: 'bg-blue-500', description: 'Finished. Data stays available; phones stop collecting.' },
  archived: { label: 'Archived', tone: 'neutral', dot: 'bg-slate-300', description: 'Hidden from active work.' },
}

export function studyStatusInfo(study: { status?: string | null; approved_at?: string | null } | null | undefined): StudyStatusInfo {
  const raw = study?.status ?? 'draft'
  const key: StudyStatusInfo['key'] = isPendingApproval(study)
    ? 'pending'
    : (raw in INFO ? raw : 'draft') as StudyStatusInfo['key']
  return { key, ...INFO[key] }
}

export type SyncStatusKey = 'success' | 'partial' | 'error'
export const SYNC_STATUS: Record<SyncStatusKey, { label: string; tone: StatusTone; dot: string }> = {
  success: { label: 'Success', tone: 'green', dot: 'bg-emerald-500' },
  partial: { label: 'Partial', tone: 'amber', dot: 'bg-amber-400' },
  error: { label: 'Error', tone: 'red', dot: 'bg-red-500' },
}
