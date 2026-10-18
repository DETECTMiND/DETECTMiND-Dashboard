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
  onChange: (value: string | null) => void
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  /** Hide the visible label (it stays as the accessible name). */
  hideLabel?: boolean
  className?: string
  maxResults?: number
}

/** Searchable combobox (ARIA 1.2 pattern) for picking one item, e.g. a researcher by email or name. */
export function SearchSelect({
  label, options, value, onChange, placeholder = 'Type to search…', emptyText = 'No matches',
  disabled, hideLabel, className = '', maxResults = 50,
}: SearchSelectProps) {
  const inputId = useId()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const selected = options.find(o => o.value === value) ?? null

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = needle
      ? options.filter(o => o.label.toLowerCase().includes(needle) || (o.hint ?? '').toLowerCase().includes(needle))
      : options
    return list.slice(0, maxResults)
  }, [options, query, maxResults])

  const shownText = open ? query : selected ? selected.label : query
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1))

  function pick(option: SearchOption) {
    onChange(option.value)
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
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'block text-sm font-medium text-gray-700'}>{label}</label>
      <div className={`relative ${hideLabel ? '' : 'mt-1.5'}`}>
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={shownText}
          placeholder={selected && open ? selected.label : placeholder}
          onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); if (value) onChange(null) }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-8 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60"
        />
        {(value || query) && !disabled && (
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(null); setQuery('') }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label={`Clear ${label}`}>
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <ul ref={listRef} id={listId} role="listbox" aria-label={label}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500" role="presentation">{emptyText}</li>
          ) : matches.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${i === activeIndex ? 'bg-blue-50 text-blue-800' : 'text-gray-700'}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{o.label}</span>
                {o.hint && <span className="block truncate text-xs text-gray-500">{o.hint}</span>}
              </span>
              {o.value === value && <Check size={14} className="shrink-0 text-blue-600" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
