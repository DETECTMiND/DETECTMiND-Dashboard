'use client'

import { useRef } from 'react'
import { Check } from 'lucide-react'

export interface Choice<T extends string> {
  value: T
  label: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
}

/**
 * Pick one of a few options shown as cards. A real radio group: Tab moves to
 * the selected card, arrow keys move between cards, Space/Enter selects.
 */
export function ChoiceCards<T extends string>({ value, onChange, options, label, disabled, columns = 2, size = 'md' }: {
  value: T
  onChange: (next: T) => void
  options: Choice<T>[]
  /** Accessible name of the group */
  label: string
  disabled?: boolean
  columns?: 2 | 3
  size?: 'sm' | 'md'
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.max(0, options.findIndex(o => o.value === value))

  function onKey(e: React.KeyboardEvent, i: number) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
    if (!keys.includes(e.key)) return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
    const next = (i + dir + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-label={label}
      className={`grid grid-cols-1 gap-2 ${columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      {options.map((opt, i) => {
        const on = opt.value === value
        return (
          <button key={opt.value} ref={el => { refs.current[i] = el }} type="button" role="radio" aria-checked={on}
            tabIndex={i === current ? 0 : -1} disabled={disabled}
            onKeyDown={e => onKey(e, i)} onClick={() => onChange(opt.value)}
            className={`flex items-start gap-3 rounded-xl border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${size === 'sm' ? 'px-3 py-2.5' : 'px-4 py-3'} ${on ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line bg-surface hover:bg-sunken'}`}>
            {opt.icon && <span className={`mt-0.5 shrink-0 ${on ? 'text-accent' : 'text-subtle'}`} aria-hidden="true">{opt.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-fg">{opt.label}</span>
              {opt.description && <span className="mt-0.5 block text-xs text-subtle">{opt.description}</span>}
            </span>
            <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong'}`}>
              {on && <Check size={10} strokeWidth={3} />}
            </span>
          </button>
        )
      })}
    </div>
  )
}
