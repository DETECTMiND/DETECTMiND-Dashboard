import { studyStatusInfo, type StatusTone } from '@/lib/status'

const TONES: Record<StatusTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
}

/** Small rounded label. */
export function Badge({ tone = 'neutral', icon, children, className = '', title }: {
  tone?: StatusTone; icon?: React.ReactNode; children: React.ReactNode; className?: string; title?: string
}) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONES[tone]} ${className}`}>
      {icon}
      {children}
    </span>
  )
}

/** A study's status, named and coloured the same everywhere (Pending approval / Active / Paused / Completed). */
export function StatusPill({ study, className = '' }: { study: { status?: string | null; approved_at?: string | null }; className?: string }) {
  const s = studyStatusInfo(study)
  return (
    <Badge tone={s.tone} className={className} title={s.description}
      icon={<span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />}>
      {s.label}
    </Badge>
  )
}

export function StatusDot({ study, className = '' }: { study: { status?: string | null; approved_at?: string | null }; className?: string }) {
  const s = studyStatusInfo(study)
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${s.dot} ${className}`} title={s.label} aria-label={s.label} role="img" />
}
