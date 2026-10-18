/** Surface container. `padded={false}` for tables and lists that run edge to edge. */
export function Card({ children, className = '', padded = true, as: Tag = 'section', ...rest }: {
  children: React.ReactNode; className?: string; padded?: boolean; as?: 'section' | 'div' | 'article'
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={`rounded-xl border border-line bg-surface shadow-card ${padded ? 'p-5' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

/** Title row inside a card: title + optional description on the left, actions on the right. */
export function CardHeader({ title, description, actions, icon, className = '' }: {
  title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode; className?: string
}) {
  return (
    <div className={`mb-4 flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-subtle">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Label/value pairs, e.g. on review and detail screens. */
export function DescriptionList({ items, className = '' }: {
  items: { label: React.ReactNode; value: React.ReactNode }[]; className?: string
}) {
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 ${className}`}>
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium text-subtle">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
