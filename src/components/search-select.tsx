'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { Check, Search, X } from 'lucide-react'

export interface SearchOption {
  value: string
  /** Main text, e.g. the email. */
  label: string
  /** Secondary text, e.g. the display name. */
  hint?: string | null
}

export interface SearchSelectProps {
  /** Visible label; also the input's accessible name. */
  label: string
  options: SearchOption[]
  value: string | null
  onChange: (value: string | null, option: SearchOption | null) => void
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  /** Hide the visible label (it stays as the accessible name). */
  hideLabel?: boolean
  className?: string
  maxResults?: number
  /**
   * Turns what was typed into an extra option when nothing in `options` is an
   * exact match (e.g. "Invite new@person.org"). Return null to offer nothing.
   */
  customOption?: (query: string) => SearchOption | null
  /** Hint under the field. */
  hint?: React.ReactNode
}

/** Searchable combobox (ARIA 1.2 pattern) for picking one item, e.g. a researcher by email or name. */
export function SearchSelect({
  label, options, value, onChange, placeholder = 'Type to search…', emptyText = 'No matches',
  disabled, hideLabel, className = '', maxResults = 50, customOption, hint,
}: SearchSelectProps) {
  const inputId = useId()
  const listId = useId()
  const hintId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  // A picked custom option is not in `options`, so remember it for display.
  const [picked, setPicked] = useState<SearchOption | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const selected = options.find(o => o.value === value) ?? (picked && picked.value === value ? picked : null)

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = needle
      ? options.filter(o => o.label.toLowerCase().includes(needle) || (o.hint ?? '').toLowerCase().includes(needle))
      : options
    const shown = list.slice(0, maxResults)
    const exact = options.some(o => o.label.toLowerCase() === needle)
    const custom = needle && !exact && customOption ? customOption(query.trim()) : null
    return custom ? [...shown, custom] : shown
  }, [options, query, maxResults, customOption])

  const shownText = open ? query : selected ? selected.label : query
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1))

  function pick(option: SearchOption) {
    setPicked(option)
    onChange(option.value, option)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setActive(Math.min(activeIndex + 1, matches.length - 1))
      scrollTo(activeIndex + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(activeIndex - 1, 0))
      scrollTo(activeIndex - 1)
    } else if (e.key === 'Enter') {
      if (open && matches[activeIndex]) { e.preventDefault(); pick(matches[activeIndex]) }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false) }
    }
  }

  function scrollTo(index: number) {
    const el = listRef.current?.children[index] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className={`relative ${className}`}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'mb-1.5 block text-sm font-medium text-fg'}>{label}</label>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={hint ? hintId : undefined}
          aria-activedescendant={open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={shownText}
          placeholder={selected && open ? selected.label : placeholder}
          onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); if (value) onChange(null, null) }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-8 text-sm text-fg shadow-card placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-subtle"
        />
        {(value || query) && !disabled && (
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(null, null); setQuery('') }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-subtle hover:bg-sunken hover:text-fg" aria-label={`Clear ${label}`}>
            <X size={14} />
          </button>
        )}
      </div>
      {hint && <p id={hintId} className="mt-1.5 text-xs text-subtle">{hint}</p>}
      {open && (
        <ul ref={listRef} id={listId} role="listbox" aria-label={label}
          className="absolute left-0 right-0 z-40 mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-subtle" role="presentation">{emptyText}</li>
          ) : matches.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${i === activeIndex ? 'bg-accent-soft text-accent' : 'text-fg'}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{o.label}</span>
                {o.hint && <span className="block truncate text-xs text-subtle">{o.hint}</span>}
              </span>
              {o.value === value && <Check size={14} className="shrink-0 text-accent" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
