'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Users, Search, X, Check, ChevronDown } from 'lucide-react'
import type { StatusTone } from '@/lib/status'
import { permissionLabel } from '@/lib/sensors'

// Shared participant helpers: names, avatars, sync health and the one
// participant picker used by Data, Processed and Surveys.

export interface Participant {
  id: string
  label: string | null
  device_id: string
}

export function participantName(p: Participant) {
  return p.label || p.device_id
}

export function avatarInitial(name: string) {
  return name.charAt(0).toUpperCase()
}

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700', 'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700',
]

export function avatarColor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function Avatar({ id, name, size = 'md' }: { id: string; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'sm' ? 'h-6 w-6 text-[11px]' : size === 'lg' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs'
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full font-bold ${cls} ${avatarColor(id)}`}>
      {avatarInitial(name)}
    </span>
  )
}

// ── Sync health ──────────────────────────────────────────────────────────────
// Both thresholds follow the study's sync interval (the app enforces a 15 min
// minimum): "late" after 2 missed syncs, "silent" (app probably uninstalled or
// force-stopped) after 12 missed syncs and at least a day.

export const MIN_SYNC_MINUTES = 15

export function syncThresholds(intervalMinutes: number) {
  const interval = Math.max(Number(intervalMinutes) || 30, MIN_SYNC_MINUTES) * 60_000
  return { staleMs: 2 * interval, silentMs: Math.max(12 * interval, 24 * 3_600_000) }
}

export type SyncHealthKey = 'ok' | 'waiting' | 'stale' | 'silent' | 'withdrawn'

export interface SyncHealth {
  key: SyncHealthKey
  label: string
  tone: StatusTone
  /** Longer explanation for a tooltip / the detail drawer */
  description: string
}

export function formatAge(ms: number): string {
  const h = ms / 3_600_000
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`
  if (h < 48) return `${Math.floor(h)} h`
  return `${Math.floor(h / 24)} days`
}

export function syncHealth(
  p: { status: string; last_sync_at: string | null; enrolled_at?: string | null },
  intervalMinutes: number,
  now: number,
): SyncHealth {
  if (p.status !== 'active') return { key: 'withdrawn', label: 'Withdrawn', tone: 'neutral', description: 'Not collecting or uploading.' }
  const { staleMs, silentMs } = syncThresholds(intervalMinutes)
  const interval = Math.max(Number(intervalMinutes) || 30, MIN_SYNC_MINUTES)
  if (!p.last_sync_at) {
    const since = p.enrolled_at ? now - new Date(p.enrolled_at).getTime() : Infinity
    if (since > silentMs) return { key: 'silent', label: 'Never synced', tone: 'red', description: `Enrolled ${Number.isFinite(since) ? `${formatAge(since)} ago` : 'a while ago'} and has not uploaded anything. The app may have been uninstalled.` }
    if (since > staleMs) return { key: 'stale', label: 'First sync overdue', tone: 'amber', description: `Enrolled ${formatAge(since)} ago; the first upload is overdue.` }
    return { key: 'waiting', label: 'Waiting for first sync', tone: 'blue', description: 'Recently enrolled; the first upload has not arrived yet.' }
  }
  const since = now - new Date(p.last_sync_at).getTime()
  if (since > silentMs) return { key: 'silent', label: `Silent for ${formatAge(since)}`, tone: 'red', description: `Expected a sync every ${interval} min. The app may have been uninstalled or stopped.` }
  if (since > staleMs) return { key: 'stale', label: `Late by ${formatAge(since)}`, tone: 'amber', description: `Expected a sync every ${interval} min; the last one was ${formatAge(since)} ago.` }
  return { key: 'ok', label: 'Syncing', tone: 'green', description: `Synced within the expected ${interval} min interval.` }
}

/** True when the sync is late or silent (for "needs attention" lists). */
export const isSyncOverdue = (h: SyncHealth) => h.key === 'stale' || h.key === 'silent'

/** Permissions the phone reports as off; null when the phone never reported them. */
export function missingPermissions(permissions: Record<string, boolean> | null | undefined): string[] | null {
  if (!permissions || Object.keys(permissions).length === 0) return null
  return Object.entries(permissions).filter(([, v]) => v === false).map(([k]) => k)
}

export function hasPermissionIssue(permissions: Record<string, boolean> | null | undefined): boolean {
  const missing = missingPermissions(permissions)
  return missing === null || missing.length > 0
}

/** Short summary such as "Location (all the time) off" or "3 permissions off"; null when all are on. */
export function permissionSummary(permissions: Record<string, boolean> | null | undefined): string | null {
  const missing = missingPermissions(permissions)
  if (missing === null) return 'Permissions not reported'
  if (missing.length === 0) return null
  return missing.length === 1 ? `${permissionLabel(missing[0])} off` : `${missing.length} permissions off`
}

// ── Picker ───────────────────────────────────────────────────────────────────

/**
 * Searchable participant selector. `value` of 'all' means every participant.
 * Shared by Data → Raw, Data → Processed and Surveys → Responses.
 */
export function ParticipantPicker({
  participants, value, onChange, allLabel = 'All participants',
}: {
  participants: Participant[]
  value: string
  onChange: (v: string) => void
  allLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    inputRef.current?.focus()
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function close() {
    setOpen(false)
    setQuery('')
    buttonRef.current?.focus()
  }

  function pick(id: string) {
    onChange(id)
    close()
  }

  const q = query.trim().toLowerCase()
  const filtered = participants.filter(p =>
    participantName(p).toLowerCase().includes(q) || p.device_id.toLowerCase().includes(q),
  )
  const selected = participants.find(p => p.id === value)
  const label = selected ? participantName(selected) : allLabel

  function focusOption(delta: number) {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = i < 0 ? (delta > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, i + delta))
    items[next].focus()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusOption(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusOption(-1) }
  }

  const option = (id: string, content: React.ReactNode, active: boolean) => (
    <button key={id} type="button" role="option" aria-selected={active} onClick={() => pick(id)}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-sunken focus:bg-sunken focus:outline-none ${active ? 'bg-accent-soft' : ''}`}>
      {content}
      {active && <Check size={13} className="shrink-0 text-accent" aria-hidden="true" />}
    </button>
  )

  return (
    <div ref={containerRef} className="relative flex max-w-full items-center gap-1" onKeyDown={open ? onKeyDown : undefined}>
      <button ref={buttonRef} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border bg-surface px-3 text-sm shadow-card hover:bg-sunken sm:w-64 ${selected ? 'border-accent' : 'border-line'}`}>
        <span className="sr-only">Participant: </span>
        {selected ? <Avatar id={selected.id} name={label} size="sm" /> : <Users size={14} className="shrink-0 text-subtle" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate text-left font-medium text-fg">{label}</span>
        <ChevronDown size={13} aria-hidden="true" className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {selected && (
        <button type="button" onClick={() => onChange('all')} aria-label={`Clear participant filter (${label})`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-fg">
          <X size={14} />
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-xl sm:left-auto sm:right-0">
          <div className="border-b border-line p-2">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 py-1.5">
              <Search size={12} className="shrink-0 text-subtle" aria-hidden="true" />
              <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} aria-label="Search participants"
                placeholder="Search participants…" className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle" />
            </div>
          </div>
          <div ref={listRef} id={listId} role="listbox" aria-label="Participants" className="max-h-64 overflow-y-auto py-1">
            {!q && option('all', <>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sunken" aria-hidden="true"><Users size={13} className="text-muted" /></span>
              <span className="flex-1 text-sm font-semibold text-fg">{allLabel}</span>
            </>, value === 'all')}
            {filtered.length === 0 ? (
              <p className="px-3 py-5 text-center text-xs text-subtle">No participants match</p>
            ) : filtered.map(p => {
              const name = participantName(p)
              return option(p.id, <>
                <Avatar id={p.id} name={name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{name}</span>
                  {p.label && <span className="block truncate font-mono text-[11px] text-subtle">{p.device_id}</span>}
                </span>
              </>, value === p.id)
            })}
          </div>
        </div>
      )}
    </div>
  )
}
