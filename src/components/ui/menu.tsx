'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

export type MenuItem =
  | { label: string; icon?: React.ReactNode; href: string; danger?: boolean }
  | { label: string; icon?: React.ReactNode; onSelect: () => void; danger?: boolean }

/**
 * "⋯" button that opens a small action menu (role="menu"). Arrow keys move,
 * Enter selects, Escape and outside clicks close and return focus.
 */
export function ActionMenu({ items, label, align = 'right' }: { items: (MenuItem | false | null | undefined)[]; label: string; align?: 'left' | 'right' }) {
  const list = items.filter(Boolean) as MenuItem[]
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  useEffect(() => { if (open) itemRefs.current[focus]?.focus() }, [open, focus])

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); buttonRef.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(i => (i + 1) % list.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus(i => (i - 1 + list.length) % list.length) }
    else if (e.key === 'Tab') setOpen(false)
  }

  const itemCls = (danger?: boolean) =>
    `flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm focus:outline-none ${danger ? 'text-danger hover:bg-danger-soft focus:bg-danger-soft' : 'text-fg hover:bg-sunken focus:bg-sunken'}`

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button ref={buttonRef} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => { setFocus(0); setOpen(v => !v) }}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setFocus(0); setOpen(true) } }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-sunken hover:text-fg">
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} onKeyDown={onKey}
          className={`absolute top-full z-40 mt-1 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {list.map((item, i) => {
            const content = <>{item.icon && <span className="text-subtle [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">{item.icon}</span>}{item.label}</>
            const common = { role: 'menuitem', tabIndex: i === focus ? 0 : -1, className: itemCls(item.danger) }
            return 'href' in item
              ? <Link key={item.label} href={item.href} ref={el => { itemRefs.current[i] = el }} {...common} onClick={() => setOpen(false)}>{content}</Link>
              : <button key={item.label} type="button" ref={el => { itemRefs.current[i] = el }} {...common}
                  onClick={() => { setOpen(false); item.onSelect() }}>{content}</button>
          })}
        </div>
      )}
    </div>
  )
}
