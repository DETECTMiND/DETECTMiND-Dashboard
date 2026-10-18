'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from './button'

/**
 * Warns before leaving a page with unsaved changes: browser close/reload
 * (beforeunload) and in-app link clicks (asks in a dialog, then navigates).
 * Render the returned `dialog` once.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const dirtyRef = useRef(dirty)
  useEffect(() => { dirtyRef.current = dirty })

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    function onClick(e: MouseEvent) {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download') || a.dataset.skipUnsaved !== undefined) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      e.preventDefault()
      e.stopPropagation()
      setPendingHref(url.pathname + url.search + url.hash)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  const dialog = (
    <ConfirmDialog
      open={pendingHref !== null}
      title="Leave without saving?"
      body="You have changes on this page that are not saved yet. They will be lost if you leave."
      confirmLabel="Leave page"
      cancelLabel="Stay"
      tone="danger"
      onCancel={() => setPendingHref(null)}
      onConfirm={() => {
        const href = pendingHref
        dirtyRef.current = false
        setPendingHref(null)
        if (href) router.push(href)
      }}
    />
  )
  return { dialog }
}

/** Sticky bar at the bottom of a settings form while it has unsaved changes. */
export function SaveBar({ dirty, saving, onSave, onDiscard, saveLabel = 'Save changes', disabled = false, message }: {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onDiscard?: () => void
  saveLabel?: string
  disabled?: boolean
  message?: React.ReactNode
}) {
  if (!dirty && !saving) return null
  return (
    <div className="sticky bottom-4 z-20 mt-6">
      <div role="region" aria-label="Unsaved changes" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-lg">
        <p className="text-sm text-muted">{message ?? 'You have unsaved changes.'}</p>
        <div className="flex gap-2">
          {onDiscard && <Button variant="ghost" onClick={onDiscard} disabled={saving}>Discard</Button>}
          <Button onClick={onSave} loading={saving} disabled={disabled}>{saveLabel}</Button>
        </div>
      </div>
    </div>
  )
}
