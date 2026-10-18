'use client'

import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Focus handling shared by every dialog and drawer: focus moves inside on open
 * (to [data-autofocus] or the first field), Tab stays inside, Escape closes,
 * page scroll is locked and focus returns to the opener on close.
 */
export function useDialogFocus(panelRef: React.RefObject<HTMLElement | null>, onEscape: () => void, active = true) {
  const escape = useRef(onEscape)
  useEffect(() => { escape.current = onEscape })

  useEffect(() => {
    if (!active) return
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>('input, select, textarea') ?? panel?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); escape.current(); return }
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null)
      if (items.length === 0) return
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === firstItem || !panel.contains(document.activeElement))) {
        e.preventDefault(); lastItem.focus()
      } else if (!e.shiftKey && (document.activeElement === lastItem || !panel.contains(document.activeElement))) {
        e.preventDefault(); firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [active, panelRef])
}

const SIZES = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }

/**
 * Accessible dialog. Bottom sheet on phones, centred panel from sm up.
 * `footer` holds the action buttons.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissible = true, icon }: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  size?: keyof typeof SIZES
  /** false while saving, so Escape / backdrop don't close it */
  dismissible?: boolean
  icon?: React.ReactNode
}) {
  if (!open) return null
  return <ModalPanel {...{ onClose, title, description, footer, size, dismissible, icon }}>{children}</ModalPanel>
}

function ModalPanel({ onClose, title, description, children, footer, size, dismissible, icon }: {
  onClose: () => void; title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode
  footer?: React.ReactNode; size: keyof typeof SIZES; dismissible: boolean; icon?: React.ReactNode
}) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogFocus(panelRef, () => { if (dismissible) onClose() })

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-[var(--overlay)]" aria-hidden="true" onClick={() => dismissible && onClose()} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined}
        className={`relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl ${SIZES[size]}`}>
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-fg">{title}</h2>
            {description && <div id={descId} className="mt-1 text-sm text-subtle">{description}</div>}
          </div>
          <button type="button" onClick={onClose} disabled={!dismissible} aria-label="Close dialog"
            className="-mr-1 rounded-lg p-1.5 text-subtle hover:bg-sunken hover:text-fg disabled:opacity-40">
            <X size={16} />
          </button>
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  )
}
