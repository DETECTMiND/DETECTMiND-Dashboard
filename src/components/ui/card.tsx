/** Surface container. `padded={false}` for tables and lists that run edge to edge. */
export function Card({ children, className = '', padded = true, as: Tag = 'section', ...rest }: {
  children: React.ReactNode; className?: string; padded?: boolean; as?: 'section' | 'div' | 'article'
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={`rounded-lg border border-line bg-surface ${padded ? 'p-5 sm:p-6' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

/** Title row inside a card: title + optional description on the left, actions on the right. */
export function CardHeader({ title, description, actions, icon, className = '' }: {
  title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode; className?: string
}) {
  return (
    <div className={`mb-5 flex flex-wrap items-start justify-between gap-3 ${className}`}>
      {/* `icon` is accepted for compatibility but not drawn: plain titles read cleaner */}
      <div className="min-w-0" data-icon={icon ? '' : undefined}>
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {description && <p className="mt-1 text-sm text-subtle">{description}</p>}
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
