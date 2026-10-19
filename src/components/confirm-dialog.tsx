'use client'

import { useId, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

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

/** Accessible replacement for window.confirm, built on <Modal>. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null
  return <ConfirmDialogInner {...props} />
}

function ConfirmDialogInner({
  title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'default',
  requireText, onConfirm, onCancel, busy = false, error, children,
}: ConfirmDialogProps) {
  const inputId = useId()
  const formId = useId()
  const [typed, setTyped] = useState('')
  const danger = tone === 'danger'
  const blocked = busy || (requireText !== undefined && typed.trim() !== requireText)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!blocked) void onConfirm()
  }

  return (
    <Modal open onClose={onCancel} dismissible={!busy} size="sm" title={title}
      icon={danger ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" /> : undefined}
      footer={<>
        <Button variant="secondary" onClick={onCancel} disabled={busy} data-autofocus={danger && requireText === undefined ? '' : undefined}>{cancelLabel}</Button>
        <Button type="submit" form={formId} variant={danger ? 'danger' : 'primary'} disabled={blocked} loading={busy}
          data-autofocus={!danger && requireText === undefined ? '' : undefined}>{confirmLabel}</Button>
      </>}>
      <form id={formId} onSubmit={submit} className="space-y-4">
        {body && <div className="space-y-2 text-sm text-muted">{body}</div>}
        {children}
        {requireText !== undefined && (
          <div>
            <label htmlFor={inputId} className="block text-sm font-medium text-fg">
              Type <code className="rounded bg-sunken px-1 font-mono text-xs break-all">{requireText}</code> to confirm
            </label>
            <input id={inputId} data-autofocus="" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
              className="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25" />
          </div>
        )}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </form>
    </Modal>
  )
}

/**
 * Small helper for the common "ask, then run" flow. Hold one request at a
 * time; render {dialog} once.
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
