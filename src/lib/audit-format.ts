// Turns audit_log rows into readable sentences, e.g.
// "Anoop invited x@y.com as viewer to Sleep study". Shared by the audit log
// page (Admin → Activity log) and its CSV export.

export type AuditRow = {
  id: number
  actor: string | null
  action: string
  target_type: string | null
  target_id: string | null
  details: Record<string, unknown> | null
  at: string
}

export const AUDIT_ACTIONS: { value: string; label: string }[] = [
  { value: 'study_created', label: 'Study created' },
  { value: 'study_approved', label: 'Study approved' },
  { value: 'study_status_changed', label: 'Study status changed' },
  { value: 'study_deleted', label: 'Study deleted' },
  { value: 'study_pin_changed', label: 'Enrolment PIN changed' },
  { value: 'study_owner_assigned', label: 'Owner assigned' },
  { value: 'study_owner_removed', label: 'Owner removed' },
  { value: 'study_member_invited', label: 'Invited to study' },
  { value: 'study_member_added', label: 'Team member added' },
  { value: 'study_member_changed', label: 'Team role changed' },
  { value: 'study_member_removed', label: 'Team member removed' },
  { value: 'participant_deleted', label: 'Participant deleted' },
  { value: 'participant_merged', label: 'Participants merged' },
  { value: 'researcher_invited', label: 'Dashboard invite sent' },
  { value: 'researcher_role_changed', label: 'Account type changed' },
  { value: 'researcher_deactivated', label: 'Account deactivated' },
  { value: 'researcher_reactivated', label: 'Account reactivated' },
]

export const AUDIT_ACTION_LABEL: Record<string, string> = Object.fromEntries(AUDIT_ACTIONS.map(a => [a.value, a.label]))

export type AuditTone = 'danger' | 'warning' | 'success' | 'neutral'

export function auditTone(action: string): AuditTone {
  if (/deleted|removed|deactivated/.test(action)) return 'danger'
  if (/changed|merged|pin/.test(action)) return 'warning'
  if (/approved|created|added|assigned|invited|reactivated/.test(action)) return 'success'
  return 'neutral'
}

export interface AuditContext {
  /** user_id -> display name or email */
  people: Record<string, string>
  /** study_id -> current name (only studies that still exist) */
  studies: Record<string, string>
}

export interface AuditDescription {
  actor: string
  sentence: string
  /** Set when the study still exists, for a link. */
  studyId: string | null
  studyName: string | null
  /** Set when the participant still exists (merge primary), for a link. */
  participantId: string | null
}

const ROLE_WORD: Record<string, string> = {
  owner: 'owner', editor: 'editor', viewer: 'viewer', admin: 'admin', researcher: 'researcher',
}

function article(role: string) {
  return /^[aeiou]/i.test(role) ? `an ${role}` : `a ${role}`
}

export function describeAudit(row: AuditRow, ctx: AuditContext): AuditDescription {
  const d = row.details || {}
  const str = (k: string) => (typeof d[k] === 'string' || typeof d[k] === 'number' ? String(d[k]) : '')
  const role = (k: string) => ROLE_WORD[str(k)] ?? str(k)
  const actor = row.actor ? (ctx.people[row.actor] || `User ${row.actor.slice(0, 8)}`) : 'System'

  // Which study does this row belong to?
  const studyIdRaw = row.target_type === 'study' ? (row.target_id || '') : (str('study_id') || '')
  const studyExists = !!studyIdRaw && !!ctx.studies[studyIdRaw]
  const studyName = str('study_name') || (studyIdRaw ? ctx.studies[studyIdRaw] : '') || ''
  const study = studyName ? `“${studyName}”` : studyIdRaw ? `study ${studyIdRaw.slice(0, 8)}` : 'a study'
  const who = str('email') || (str('user_id') ? `user ${str('user_id').slice(0, 8)}` : 'someone')

  let sentence: string
  let participantId: string | null = null
  switch (row.action) {
    case 'study_created':
      sentence = `${actor} created ${study}${d.approved === false ? ' (pending approval)' : str('status') ? ` as ${str('status')}` : ''}`
      break
    case 'study_approved':
      sentence = `${actor} approved ${study}${str('to') ? ` (now ${str('to')})` : ''}`
      break
    case 'study_status_changed':
      sentence = `${actor} changed ${study} from ${str('from') || '?'} to ${str('to') || '?'}`
      break
    case 'study_deleted': {
      const n = Number(d.participant_count) || 0
      const verb = d.approved === false ? 'rejected and deleted the pending study' : 'deleted'
      sentence = `${actor} ${verb} ${study} (${n.toLocaleString()} participant${n === 1 ? '' : 's'})`
      if (str('reason')) sentence += `. Reason: ${str('reason')}`
      break
    }
    case 'study_pin_changed':
      sentence = `${actor} ${d.pin_required ? 'set a new enrolment PIN on' : 'removed the enrolment PIN from'} ${study}`
      break
    case 'study_owner_assigned':
      sentence = `${actor} made ${who} an owner of ${study}${str('from') ? ` (was ${role('from')})` : ''}`
      break
    case 'study_owner_removed':
      sentence = str('to')
        ? `${actor} changed ${who} from owner to ${role('to')} in ${study}`
        : `${actor} removed owner ${who} from ${study}`
      break
    case 'study_member_invited': {
      const outcome = str('outcome')
      sentence = outcome === 'invite_sent_membership_failed'
        ? `${actor} sent an invite to ${who} for ${study}, but adding them to the team failed`
        : outcome === 'updated'
          ? `${actor} set ${who} as ${article(role('role'))} of ${study} by email`
          : d.new_account
            ? `${actor} invited ${who} as ${article(role('role'))} to ${study}`
            : `${actor} added existing account ${who} as ${article(role('role'))} to ${study}`
      break
    }
    case 'study_member_added':
      sentence = `${actor} added ${who} to ${study} as ${article(role('role'))}`
      break
    case 'study_member_changed':
      sentence = `${actor} changed ${who}'s role in ${study} from ${role('from')} to ${role('to')}`
      break
    case 'study_member_removed':
      sentence = `${actor} removed ${who} from ${study}`
      break
    case 'participant_deleted': {
      const counts = (d.counts || {}) as Record<string, number>
      const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0)
      sentence = `${actor} deleted participant ${str('label') || str('device_id') || (row.target_id || '').slice(0, 8)} from ${study} (${total.toLocaleString()} data rows removed)`
      break
    }
    case 'participant_merged':
      sentence = `${actor} merged duplicate participant ${str('duplicate').slice(0, 8)} into ${(row.target_id || '').slice(0, 8)} in ${study}${d.moved !== undefined ? ` (${Number(d.moved) || 0} rows moved)` : ''}`
      participantId = studyExists ? row.target_id : null
      break
    case 'researcher_invited':
      if (d.resend) {
        sentence = d.kind === 'password_reset'
          ? `${actor} sent a password reset link to ${who}`
          : `${actor} sent the dashboard invite to ${who} again`
      } else if (str('study_name') || str('study_id')) {
        sentence = `${actor} invited ${who} to the dashboard (as ${article(str('study_role') || 'member')} of ${study})`
      } else {
        sentence = `${actor} invited ${who} to the dashboard as ${article(role('role') || 'researcher')}${d.existing_account ? ' (existing account)' : ''}`
      }
      break
    case 'researcher_role_changed':
      sentence = `${actor} changed ${who}'s account type from ${role('from')} to ${role('to')}`
      break
    case 'researcher_deactivated':
      sentence = `${actor} deactivated ${who}`
      break
    case 'researcher_reactivated':
      sentence = `${actor} reactivated ${who}`
      break
    default:
      sentence = `${actor}: ${AUDIT_ACTION_LABEL[row.action] ?? row.action.replaceAll('_', ' ')}${str('email') ? ` (${str('email')})` : ''}`
  }

  return {
    actor,
    sentence,
    studyId: studyExists ? studyIdRaw : null,
    studyName: studyName || null,
    participantId,
  }
}
