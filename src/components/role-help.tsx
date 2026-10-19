import { ChevronDown, HelpCircle } from 'lucide-react'
import { RoleBadge, type BadgeRole } from '@/components/role-badge'

// One plain-words explanation of who can do what, shared by Admin → People
// and each study's Team tab.

const ACCOUNT_TYPES: { role: BadgeRole; text: string }[] = [
  { role: 'admin', text: 'Runs the dashboard. Sees every study, approves and deletes studies, adds or removes owners, manages people and reads the activity log.' },
  { role: 'researcher', text: 'Creates studies (an admin approves each one before participants can join) and works on the studies they have been added to.' },
]

const STUDY_ROLES: { role: BadgeRole; text: string }[] = [
  { role: 'owner', text: 'Everything an editor can do, plus pause or complete the study, change people\'s roles, remove people and delete participants.' },
  { role: 'editor', text: 'Changes the study details, sensors, surveys, enrolment PIN and participant labels, and invites editors and viewers.' },
  { role: 'viewer', text: 'Sees the study and its data, but cannot change anything.' },
]

/** Collapsible "Who can do what" panel. */
export function RoleHelp({ defaultOpen = false, className = '', studyOnly = false }: {
  defaultOpen?: boolean; className?: string
  /** On a study's Team tab only the study roles matter */
  studyOnly?: boolean
}) {
  return (
    <details open={defaultOpen} className={`group rounded-lg border border-line bg-surface ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-fg hover:bg-sunken [&::-webkit-details-marker]:hidden">
        <HelpCircle size={16} className="text-subtle" aria-hidden="true" />
        <span className="flex-1">Who can do what</span>
        <ChevronDown size={16} className="text-subtle transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className={`grid gap-5 border-t border-line px-4 py-4 ${studyOnly ? '' : 'sm:grid-cols-2'}`}>
        {!studyOnly && <section>
          <h3 className="text-xs font-semibold text-subtle">Account types</h3>
          <p className="mt-0.5 text-xs text-subtle">Set by an admin in Admin → People.</p>
          <dl className="mt-3 space-y-3">
            {ACCOUNT_TYPES.map(r => (
              <div key={r.role}>
                <dt><RoleBadge role={r.role} /></dt>
                <dd className="mt-1 text-sm text-muted">{r.text}</dd>
              </div>
            ))}
          </dl>
        </section>}
        <section>
          <h3 className="text-xs font-semibold text-subtle">Roles in a study</h3>
          {!studyOnly && <p className="mt-0.5 text-xs text-subtle">Set on each study&apos;s Team tab.</p>}
          <dl className="mt-3 space-y-3">
            {STUDY_ROLES.map(r => (
              <div key={r.role}>
                <dt><RoleBadge role={r.role} /></dt>
                <dd className="mt-1 text-sm text-muted">{r.text}</dd>
              </div>
            ))}
          </dl>
        </section>
        <p className={`text-xs text-subtle ${studyOnly ? '' : 'sm:col-span-2'}`}>
          Only admins approve or delete a study and add or remove its owners. Admins can open every study, so they are not listed on a study&apos;s team.
        </p>
      </div>
    </details>
  )
}
