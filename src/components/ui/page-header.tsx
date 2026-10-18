/**
 * Top of every page: one h1, a short description, actions on the right and
 * optional tabs underneath. Section layouts (Data, Surveys, Settings) render
 * this once; their tab pages use <SectionHeader> for a toolbar instead of a
 * second h1.
 */
export function PageHeader({ title, description, actions, tabs, eyebrow }: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  tabs?: React.ReactNode
  /** Small text above the title, e.g. the study name */
  eyebrow?: React.ReactNode
}) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 truncate text-xs font-medium text-subtle">{eyebrow}</p>}
          <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-subtle">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-5">{tabs}</div>}
    </header>
  )
}

/** Toolbar row for a tab page inside a section: optional h2 + actions. */
export function SectionHeader({ title, description, actions, className = '' }: {
  title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string
}) {
  if (!title && !description && !actions) return null
  return (
    <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        {title && <h2 className="text-lg font-semibold text-fg">{title}</h2>}
        {description && <p className="mt-0.5 text-sm text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
