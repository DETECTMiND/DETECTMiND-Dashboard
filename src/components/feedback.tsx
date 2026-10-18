'use client'

import { AlertCircle, CheckCircle2, Info, Loader2, RefreshCw, X } from 'lucide-react'

export type NoticeState = { tone: 'error' | 'success' | 'info'; text: string } | null

/** Inline banner for the result of a save/delete. */
export function Notice({ notice, onClose }: { notice: NoticeState; onClose?: () => void }) {
  if (!notice) return null
  const style = {
    error: { cls: 'border-red-200 bg-red-50 text-red-700', icon: <AlertCircle size={16} className="mt-0.5 shrink-0" /> },
    success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> },
    info: { cls: 'border-blue-200 bg-blue-50 text-blue-800', icon: <Info size={16} className="mt-0.5 shrink-0" /> },
  }[notice.tone]
  return (
    <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${style.cls}`}>
      {style.icon}
      <p className="min-w-0 flex-1 break-words">{notice.text}</p>
      {onClose && (
        <button onClick={onClose} className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100" aria-label="Dismiss">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

/** Centred spinner block for a section that is loading. */
export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface py-14 text-sm text-subtle">
      <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {label}
    </div>
  )
}
export const LoadingState = LoadingBlock

/** Grey placeholder bar while content loads. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-md bg-sunken ${className}`} />
}

/** Placeholder rows for a table or list that is loading. */
export function SkeletonRows({ rows = 5, className = '' }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={`space-y-2 ${className}`}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  )
}

export function EmptyState({ icon, title, hint, children }: {
  icon?: React.ReactNode
  title: string
  hint?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
      {icon && <div className="mb-3 flex justify-center text-subtle">{icon}</div>}
      <p className="text-sm font-semibold text-fg">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-subtle">{hint}</p>}
      {children && <div className="mt-5 flex justify-center gap-2">{children}</div>}
    </div>
  )
}

/** A query failed: say so and offer a retry, instead of showing an empty page. */
export function ErrorState({ title = 'Could not load this data', message, onRetry }: {
  title?: string; message?: string | null; onRetry?: () => void
}) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center">
      <AlertCircle size={22} className="mx-auto mb-2 text-red-600" aria-hidden="true" />
      <p className="text-sm font-semibold text-red-800">{title}</p>
      {message && <p className="mx-auto mt-1 max-w-lg break-words text-sm text-red-700">{message}</p>}
      {onRetry && (
        <button onClick={onRetry} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-surface px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
          <RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  )
}

export function ReadOnlyBanner({ text = 'You have view-only access to this study.' }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-sunken px-4 py-2.5 text-xs font-medium text-muted">
      <Info size={14} aria-hidden="true" /> {text}
    </div>
  )
}

/** Turns a Supabase/PostgREST error into a readable sentence. */
export function errorText(error: { message?: string; details?: string | null; hint?: string | null } | null | undefined, fallback = 'Something went wrong') {
  if (!error) return fallback
  const msg = error.message || fallback
  if (/row-level security|permission denied/i.test(msg)) {
    return 'You do not have permission to make this change.'
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  return msg
}
