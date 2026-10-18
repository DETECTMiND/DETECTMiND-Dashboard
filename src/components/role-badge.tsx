import { CheckCircle2, Clock, Crown, Eye, PenLine, ShieldCheck, UserRound, UserX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { StatusTone } from '@/lib/status'

export type BadgeRole = 'admin' | 'owner' | 'editor' | 'viewer' | 'researcher' | 'pending' | 'active' | 'deactivated'

const STYLE: Record<BadgeRole, { label: string; tone: StatusTone; icon: typeof Crown }> = {
  admin: { label: 'Admin', tone: 'violet', icon: ShieldCheck },
  owner: { label: 'Owner', tone: 'amber', icon: Crown },
  editor: { label: 'Editor', tone: 'blue', icon: PenLine },
  viewer: { label: 'Viewer', tone: 'neutral', icon: Eye },
  researcher: { label: 'Researcher', tone: 'neutral', icon: UserRound },
  // Account states: one word each, the same everywhere.
  pending: { label: 'Invited', tone: 'orange', icon: Clock },
  active: { label: 'Active', tone: 'green', icon: CheckCircle2 },
  deactivated: { label: 'Deactivated', tone: 'neutral', icon: UserX },
}

/** Small pill for a dashboard or study role, or an account state (Invited / Active / Deactivated). */
export function RoleBadge({ role, label, className = '' }: { role: BadgeRole; label?: string; className?: string }) {
  const s = STYLE[role] ?? STYLE.researcher
  const Icon = s.icon
  return (
    <Badge tone={s.tone} className={className} icon={<Icon size={11} aria-hidden="true" />}>
      {label ?? s.label}
    </Badge>
  )
}
