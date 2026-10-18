'use client'

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Table building blocks with one look: sticky header, row hover, horizontal
 * scroll inside the card (never the page). For phones, pages can render a
 * card list below `md` and the table from `md` up.
 */
export function TableWrap({ children, className = '', maxHeight }: { children: React.ReactNode; className?: string; maxHeight?: string }) {
  return (
    <div className={`overflow-auto rounded-xl border border-line bg-surface shadow-card ${className}`} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  )
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="sticky top-0 z-10 bg-sunken text-xs font-semibold text-subtle">{children}</thead>
}

export function Th({ children, className = '', sort, onSort, align = 'left' }: {
  children: React.ReactNode
  className?: string
  /** Current sort of this column, if sortable */
  sort?: 'asc' | 'desc' | null
  onSort?: () => void
  align?: 'left' | 'right' | 'center'
}) {
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  if (!onSort) return <th scope="col" className={`whitespace-nowrap border-b border-line px-4 py-2.5 ${alignCls} ${className}`}>{children}</th>
  const Icon = sort === 'asc' ? ArrowUp : sort === 'desc' ? ArrowDown : ArrowUpDown
  return (
    <th scope="col" aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none'}
      className={`whitespace-nowrap border-b border-line p-0 ${alignCls} ${className}`}>
      <button type="button" onClick={onSort} className={`inline-flex w-full items-center gap-1 px-4 py-2.5 hover:text-fg ${align === 'right' ? 'justify-end' : ''}`}>
        {children}<Icon size={12} className={sort ? 'text-accent' : 'opacity-50'} aria-hidden="true" />
      </button>
    </th>
  )
}

export function Td({ children, className = '', align = 'left', ...rest }: {
  children?: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center'
} & React.TdHTMLAttributes<HTMLTableCellElement>) {
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
  return <td className={`border-b border-line px-4 py-2.5 align-top text-fg ${alignCls} ${className}`} {...rest}>{children}</td>
}

export function Tr({ children, className = '', ...rest }: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`hover:bg-sunken/60 ${className}`} {...rest}>{children}</tr>
}

/** Page controls: "1–50 of 1,234", page size and previous / next. */
export function Pagination({ page, pageSize, total, onPage, onPageSize, pageSizes = [25, 50, 100, 250], className = '' }: {
  /** zero-based */
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  onPageSize?: (size: number) => void
  pageSizes?: number[]
  className?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 text-sm text-subtle ${className}`}>
      <p aria-live="polite">{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</p>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <label className="flex items-center gap-1.5">
            <span className="sr-only sm:not-sr-only">Rows</span>
            <select value={pageSize} onChange={e => onPageSize(Number(e.target.value))}
              className="h-8 rounded-lg border border-line bg-surface px-2 text-sm text-fg">
              {pageSizes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 0} aria-label="Previous page"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-fg hover:bg-sunken disabled:opacity-40">
          <ChevronLeft size={16} />
        </button>
        <span className="tabular-nums">{page + 1} / {pages}</span>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page + 1 >= pages} aria-label="Next page"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-fg hover:bg-sunken disabled:opacity-40">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
