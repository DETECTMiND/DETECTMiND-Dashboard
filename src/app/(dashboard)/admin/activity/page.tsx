'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ChevronLeft, ChevronRight, Download, Loader2, ScrollText } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-browser'
import { AdminOnly } from '@/components/admin-only'
import { EmptyState, LoadingBlock, Notice } from '@/components/feedback'
import { AUDIT_ACTIONS, AUDIT_ACTION_LABEL, auditTone, describeAudit, type AuditRow } from '@/lib/audit-format'

const PAGE = 50
const EXPORT_CHUNK = 1000
const EXPORT_MAX = 50_000
const SYSTEM = '__system__'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Filters = { action: string; actor: string; study: string; from: string; to: string }
const EMPTY: Filters = { action: '', actor: '', study: '', from: '', to: '' }

const TONE: Record<string, string> = {
  danger: 'bg-red-50 text-red-700 ring-red-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  neutral: 'bg-gray-100 text-gray-700 ring-gray-200',
}

const inputCls = 'mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30'

// RFC 4180 cell. A leading = + - @ is prefixed with ' so spreadsheet apps
// do not run audit text (emails, reasons) as a formula.
function csvCell(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows: Record<string, string>[], columns: string[]): string {
  return [columns.join(','), ...rows.map(r => columns.map(c => csvCell(r[c] ?? '')).join(','))].join('\r\n') + '\r\n'
}

const CSV_COLUMNS = ['at', 'actor_email', 'action', 'description', 'study', 'target_type', 'target_id', 'details']

/** Builds the filtered audit query; every filter runs in Postgres. */
function auditQuery(supabase: SupabaseClient, f: Filters, count = false) {
  let q = supabase.from('audit_log').select('*', count ? { count: 'exact' } : undefined)
    .order('at', { ascending: false }).order('id', { ascending: false })
  if (f.action) q = q.eq('action', f.action)
  if (f.actor === SYSTEM) q = q.is('actor', null)
  else if (UUID_RE.test(f.actor)) q = q.eq('actor', f.actor)
  if (UUID_RE.test(f.study)) q = q.or(`target_id.eq.${f.study},details->>study_id.eq.${f.study}`)
  if (f.from) q = q.gte('at', new Date(`${f.from}T00:00:00`).toISOString())
  if (f.to) q = q.lt('at', new Date(new Date(`${f.to}T00:00:00`).getTime() + 86_400_000).toISOString())
  return q
}

function AuditLog() {
  const supabase = useMemo(() => createClient(), [])
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<{ key: string; rows: AuditRow[]; total: number; error: string | null } | null>(null)
  const [people, setPeople] = useState<{ user_id: string; email: string | null; display_name: string | null }[]>([])
  const [studies, setStudies] = useState<{ id: string; name: string }[]>([])
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const key = JSON.stringify({ ...filters, page })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('researchers').select('user_id, email, display_name').order('email'),
      supabase.from('studies').select('id, name').order('name'),
    ]).then(([r, s]) => {
      if (cancelled) return
      setPeople((r.data || []) as typeof people)
      setStudies((s.data || []) as typeof studies)
    })
    return () => { cancelled = true }
  }, [supabase])

  useEffect(() => {
    let cancelled = false
    auditQuery(supabase, filters, true).range(page * PAGE, page * PAGE + PAGE - 1).then(({ data, count, error }) => {
      if (!cancelled) setResult({ key, rows: (data || []) as AuditRow[], total: count ?? 0, error: error?.message ?? null })
    })
    return () => { cancelled = true }
  }, [supabase, filters, page, key])

  const ctx = useMemo(() => ({
    people: Object.fromEntries(people.map(p => [p.user_id, p.display_name || p.email || ''])),
    studies: Object.fromEntries(studies.map(s => [s.id, s.name])),
  }), [people, studies])
  const emailOf = useCallback((id: string | null) => id ? (people.find(p => p.user_id === id)?.email ?? id) : 'system', [people])

  function set<K extends keyof Filters>(k: K, v: Filters[K]) {
    setFilters(f => ({ ...f, [k]: v }))
    setPage(0)
  }

  async function exportCsv() {
    setExporting(true)
    setExportError(null)
    try {
      const all: AuditRow[] = []
      for (let offset = 0; offset < EXPORT_MAX; offset += EXPORT_CHUNK) {
        const { data, error } = await auditQuery(supabase, filters).range(offset, offset + EXPORT_CHUNK - 1)
        if (error) throw new Error(error.message)
        all.push(...((data || []) as AuditRow[]))
        if (!data || data.length < EXPORT_CHUNK) break
      }
      const csv = toCsv(all.map(r => {
        const d = describeAudit(r, ctx)
        return {
          at: r.at,
          actor_email: emailOf(r.actor),
          action: r.action,
          description: d.sentence,
          study: d.studyName ?? '',
          target_type: r.target_type ?? '',
          target_id: r.target_id ?? '',
          details: JSON.stringify(r.details ?? {}),
        }
      }), CSV_COLUMNS)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-log-${format(new Date(), 'yyyy-MM-dd-HHmm')}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const loading = result?.key !== key
  const rows = result?.rows ?? []
  const total = result?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const filtering = Object.values(filters).some(Boolean)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Audit log</h1>
          <p className="mt-0.5 text-sm text-gray-500">Sensitive actions across every study: approvals, deletions, merges, PIN and access changes.</p>
        </div>
        <button onClick={() => void exportCsv()} disabled={exporting || total === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export CSV
        </button>
      </div>

      <section className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end" aria-label="Filter audit log">
        <label className="text-xs font-medium text-gray-600">Action
          <select value={filters.action} onChange={e => set('action', e.target.value)} className={inputCls}>
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">Actor
          <select value={filters.actor} onChange={e => set('actor', e.target.value)} className={inputCls}>
            <option value="">Anyone</option>
            <option value={SYSTEM}>System (seed / service)</option>
            {people.map(p => <option key={p.user_id} value={p.user_id}>{p.email ?? p.user_id}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">Study
          <select value={filters.study} onChange={e => set('study', e.target.value)} className={inputCls}>
            <option value="">All studies</option>
            {studies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">From
          <input type="date" value={filters.from} onChange={e => set('from', e.target.value)} className={inputCls} />
        </label>
        <label className="text-xs font-medium text-gray-600">To
          <input type="date" value={filters.to} onChange={e => set('to', e.target.value)} className={inputCls} />
        </label>
        {filtering ? (
          <button onClick={() => { setFilters(EMPTY); setPage(0) }}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Clear filters</button>
        ) : <span className="hidden lg:block" />}
      </section>

      {exportError && <Notice notice={{ tone: 'error', text: `CSV export failed: ${exportError}` }} onClose={() => setExportError(null)} />}

      {result?.error ? (
        <Notice notice={{ tone: 'error', text: result.error }} />
      ) : loading && !result ? (
        <LoadingBlock label="Loading audit log…" />
      ) : rows.length === 0 && !loading ? (
        <EmptyState icon={<ScrollText size={30} />} title="No audit entries" hint={filtering ? 'Try different filters.' : 'Entries appear here as people make changes.'} />
      ) : (
        <section className={`overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <div className="hidden grid-cols-[9.5rem_10rem_minmax(0,1fr)] gap-4 border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 md:grid" aria-hidden="true">
            <span>When</span><span>Action</span><span>What happened</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {rows.map(r => {
              const d = describeAudit(r, ctx)
              return (
                <li key={r.id} data-testid="audit-row" className="grid grid-cols-1 gap-1.5 px-4 py-3 md:grid-cols-[9.5rem_10rem_minmax(0,1fr)] md:gap-4">
                  <span className="text-xs tabular-nums text-gray-500" title={r.at}>{format(new Date(r.at), 'd MMM yyyy, HH:mm')}</span>
                  <span>
                    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONE[auditTone(r.action)]}`}>
                      {AUDIT_ACTION_LABEL[r.action] || r.action}
                    </span>
                  </span>
                  <div className="min-w-0 text-sm text-gray-700">
                    <p className="break-words">{d.sentence}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {d.studyId && <Link href={`/studies/${d.studyId}`} className="text-blue-600 hover:underline">Open study</Link>}
                      {d.studyId && d.participantId && (
                        <Link href={`/studies/${d.studyId}/participants?participant=${d.participantId}`} className="text-blue-600 hover:underline">Open participant</Link>
                      )}
                      {r.action.startsWith('study_') && r.action !== 'study_deleted' && !d.studyId && (r.target_id || d.studyName) && (
                        <span className="text-gray-400">Study no longer exists</span>
                      )}
                    </p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-gray-400">Raw details</summary>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-2 text-[11px] text-gray-500">{JSON.stringify({ actor: emailOf(r.actor), target: `${r.target_type}:${r.target_id}`, ...r.details }, null, 2)}</pre>
                    </details>
                  </div>
                </li>
              )
            })}
          </ul>
          <nav className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-sm" aria-label="Audit log pages">
            <p className="text-xs text-gray-500" aria-live="polite">
              {total === 0 ? 'No entries' : `${(page * PAGE + 1).toLocaleString()}–${Math.min(total, (page + 1) * PAGE).toLocaleString()} of ${total.toLocaleString()}`}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0 || loading}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                <ChevronLeft size={14} /> Previous
              </button>
              <span className="text-xs text-gray-500">Page {page + 1} of {pages}</span>
              <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1 || loading}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                Next <ChevronRight size={14} />
              </button>
            </div>
          </nav>
        </section>
      )}
    </div>
  )
}

export default function AuditPage() {
  return <AdminOnly><AuditLog /></AdminOnly>
}
