import { Clock, Crown, Eye, PenLine, ShieldCheck, UserRound, UserX } from 'lucide-react'

export type BadgeRole = 'admin' | 'owner' | 'editor' | 'viewer' | 'researcher' | 'pending' | 'deactivated'

const STYLE: Record<BadgeRole, { label: string; className: string; icon: typeof Crown }> = {
  admin: { label: 'Admin', className: 'bg-violet-50 text-violet-700 ring-violet-200', icon: ShieldCheck },
  owner: { label: 'Owner', className: 'bg-amber-50 text-amber-800 ring-amber-200', icon: Crown },
  editor: { label: 'Editor', className: 'bg-blue-50 text-blue-700 ring-blue-200', icon: PenLine },
  viewer: { label: 'Viewer', className: 'bg-slate-100 text-slate-700 ring-slate-200', icon: Eye },
  researcher: { label: 'Researcher', className: 'bg-slate-50 text-slate-700 ring-slate-200', icon: UserRound },
  pending: { label: 'Invite pending', className: 'bg-orange-50 text-orange-700 ring-orange-200', icon: Clock },
  deactivated: { label: 'Deactivated', className: 'bg-gray-100 text-gray-500 ring-gray-200', icon: UserX },
}

/** Small pill for a dashboard or study role, or an account state. */
export function RoleBadge({ role, label, className = '' }: { role: BadgeRole; label?: string; className?: string }) {
  const s = STYLE[role] ?? STYLE.researcher
  const Icon = s.icon
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${s.className} ${className}`}>
      <Icon size={11} aria-hidden="true" />
      {label ?? s.label}
    </span>
  )
}
