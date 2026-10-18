'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, HelpCircle, Loader2, X } from 'lucide-react'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  body?: React.ReactNode
  /** Text of the confirm button. Defaults to "Confirm". */
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  /** When set, the confirm button stays disabled until this exact text is typed. */
  requireText?: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  busy?: boolean
  /** Error from the last attempt, shown inside the dialog. */
  error?: string | null
  /** Extra content (e.g. a reason field) rendered below the body. */
  children?: React.ReactNode
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Accessible replacement for window.confirm: role="dialog", aria-modal,
 * focus kept inside while open, Esc / backdrop cancel, focus restored on close.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null
  return <ConfirmDialogInner {...props} />
}

function ConfirmDialogInner({
  title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'default',
  requireText, onConfirm, onCancel, busy = false, error, children,
}: ConfirmDialogProps) {
  const titleId = useId()
  const bodyId = useId()
  const inputId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [typed, setTyped] = useState('')
  const danger = tone === 'danger'
  const blocked = busy || (requireText !== undefined && typed.trim() !== requireText)

  // Latest props for the key handler without re-binding it.
  const state = useRef({ busy, onCancel })
  useEffect(() => { state.current = { busy, onCancel } })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(requireText !== undefined ? 'input' : '[data-autofocus]')
    first?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!state.current.busy) state.current.onCancel()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
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
    // Only on mount/unmount of the open dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!blocked) void onConfirm()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-950/50" aria-hidden="true" onClick={() => !busy && onCancel()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl sm:p-6"
      >
        <form onSubmit={submit}>
          <div className="flex items-start gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${danger ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
              {danger ? <AlertTriangle size={18} /> : <HelpCircle size={18} />}
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-bold text-gray-900">{title}</h2>
              {body && <div id={bodyId} className="mt-1.5 space-y-2 text-sm text-gray-600">{body}</div>}
            </div>
            <button type="button" onClick={onCancel} disabled={busy} className="-mr-1 -mt-1 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Close dialog">
              <X size={16} />
            </button>
          </div>

          {children && <div className="mt-4">{children}</div>}

          {requireText !== undefined && (
            <div className="mt-4">
              <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
                Type <code className="rounded bg-gray-100 px-1 font-mono text-xs break-all">{requireText}</code> to confirm
              </label>
              <input id={inputId} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          )}

          {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onCancel} disabled={busy}
              data-autofocus={danger ? '' : undefined}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {cancelLabel}
            </button>
            <button type="submit" disabled={blocked}
              data-autofocus={danger ? undefined : ''}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * Small helper for the common "ask, then run" flow. Hold one request at a
 * time; render <ConfirmDialog {...dialogProps} /> once.
 */
export interface ConfirmRequest {
  title: string
  body?: React.ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'default'
  requireText?: string
  run: () => Promise<string | null | void>
}

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function ask(next: ConfirmRequest) { setError(null); setBusy(false); setRequest(next) }
  function cancel() { if (!busy) { setRequest(null); setError(null) } }
  async function confirm() {
    if (!request) return
    setBusy(true); setError(null)
    try {
      const problem = await request.run()
      if (problem) setError(problem)
      else setRequest(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const dialog = (
    <ConfirmDialog
      open={request !== null}
      title={request?.title ?? ''}
      body={request?.body}
      confirmLabel={request?.confirmLabel}
      tone={request?.tone}
      requireText={request?.requireText}
      busy={busy}
      error={error}
      onConfirm={confirm}
      onCancel={cancel}
    />
  )
  return { ask, dialog }
}
