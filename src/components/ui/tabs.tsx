'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useRef } from 'react'

export interface TabLink {
  label: string
  href: string
  /** Exact path match by default; set prefix to also match sub-paths. */
  prefix?: boolean
  badge?: React.ReactNode
}

/** Route-based tabs (each tab is a page). Keeps ?query params like ?participant= when switching. */
export function TabNav({ tabs, label, keepQuery = ['participant'] }: { tabs: TabLink[]; label: string; keepQuery?: string[] }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const query = new URLSearchParams()
  keepQuery.forEach(k => { const v = params.get(k); if (v) query.set(k, v) })
  const qs = query.toString()
  // Longest matching href wins, so /data does not light up on /data/processed
  const active = [...tabs]
    .filter(t => pathname === t.href || (t.prefix && pathname.startsWith(t.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(tab => {
        const current = tab === active
        return (
          <Link key={tab.href} href={qs ? `${tab.href}?${qs}` : tab.href} aria-current={current ? 'page' : undefined}
            className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${current ? 'border-accent text-accent' : 'border-transparent text-subtle hover:border-line-strong hover:text-fg'}`}>
            {tab.label}{tab.badge}
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * In-page switch between views (e.g. Table | Chart). Arrow keys move between
 * options, as for a radio group.
 */
export function SegmentedControl<T extends string>({ value, onChange, options, label, size = 'md' }: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode }[]
  label: string
  size?: 'sm' | 'md'
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  function onKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
      {options.map((opt, i) => {
        const on = opt.value === value
        return (
          <button key={opt.value} ref={el => { refs.current[i] = el }} type="button" role="radio" aria-checked={on}
            tabIndex={on ? 0 : -1} onKeyDown={e => onKey(e, i)} onClick={() => onChange(opt.value)}
            className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-colors ${size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} ${on ? 'bg-surface text-fg ring-1 ring-line' : 'text-subtle hover:text-fg'}`}>
            {opt.icon}{opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** Pill filters (e.g. which sensor table to show). Scrolls sideways on small screens. */
export function FilterPills<T extends string>({ value, onChange, options, label }: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: React.ReactNode; count?: number | null }[]
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5 overflow-x-auto pb-1">
      {options.map(opt => {
        const on = opt.value === value
        return (
          <button key={opt.value} type="button" aria-pressed={on} onClick={() => onChange(opt.value)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:bg-sunken'}`}>
            {opt.label}
            {opt.count != null && <span className={`rounded-full px-1.5 text-[10px] ${on ? 'bg-accent text-accent-fg' : 'bg-sunken text-subtle'}`}>{opt.count.toLocaleString()}</span>}
          </button>
        )
      })}
    </div>
  )
}
