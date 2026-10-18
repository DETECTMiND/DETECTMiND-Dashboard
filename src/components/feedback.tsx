'use client'

import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react'

export type NoticeState = { tone: 'error' | 'success'; text: string } | null

/** Inline banner for the result of a save/delete. */
export function Notice({ notice, onClose }: { notice: NoticeState; onClose?: () => void }) {
  if (!notice) return null
  const error = notice.tone === 'error'
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
        error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
      }`}
    >
      {error ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
      <p className="min-w-0 flex-1 break-words">{notice.text}</p>
      {onClose && (
        <button onClick={onClose} className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100" aria-label="Dismiss">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-14 text-sm text-gray-500">
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  )
}

export function EmptyState({ icon, title, hint, children }: {
  icon?: React.ReactNode
  title: string
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-white py-14 text-center">
      {icon && <div className="mb-3 flex justify-center text-gray-300">{icon}</div>}
      <p className="text-sm font-medium text-gray-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}

export function ReadOnlyBanner({ text = 'You have view-only access to this study.' }: { text?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-medium text-slate-600">
      {text}
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
  return msg
}
