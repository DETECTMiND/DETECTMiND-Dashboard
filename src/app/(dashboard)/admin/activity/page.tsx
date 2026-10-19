'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Download, ScrollText } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-browser'
import { AdminOnly } from '@/components/admin-only'
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Pagination, Select, SkeletonRows,
} from '@/components/ui'
import { AUDIT_ACTIONS, AUDIT_ACTION_LABEL, auditTone, describeAudit, type AuditRow, type AuditTone } from '@/lib/audit-format'
import type { StatusTone } from '@/lib/status'
import { studyPaths } from '@/lib/nav'

const PAGE = 50
const EXPORT_CHUNK = 1000
const EXPORT_MAX = 50_000
const SYSTEM = '__system__'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Filters = { action: string; actor: string; study: string; from: string; to: string }
const EMPTY: Filters = { action: '', actor: '', study: '', from: '', to: '' }

const TONE: Record<AuditTone, StatusTone> = { danger: 'red', warning: 'amber', success: 'green', neutral: 'neutral' }

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
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify({ ...filters, page, attempt })

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
  }, [supabase, filters, page, key, attempt])

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
      a.download = `activity-log-${format(new Date(), 'yyyy-MM-dd-HHmm')}.csv`
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
    <div>
      <PageHeader
        title="Activity log"
        description="Approvals, deletions, merges, PIN and access changes across all studies."
        actions={
          <Button variant="secondary" onClick={() => void exportCsv()} loading={exporting} disabled={total === 0}>
            {!exporting && <Download size={14} aria-hidden="true" />} Export CSV
          </Button>
        }
      />

      <Card className="mb-4" aria-label="Filter the activity log">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Action">
            {id => (
              <Select id={id} value={filters.action} onChange={e => set('action', e.target.value)}>
                <option value="">All actions</option>
                {AUDIT_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Done by">
            {id => (
              <Select id={id} value={filters.actor} onChange={e => set('actor', e.target.value)}>
                <option value="">Anyone</option>
                <option value={SYSTEM}>System (seed or service)</option>
                {people.map(p => <option key={p.user_id} value={p.user_id}>{p.email ?? p.user_id}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Study">
            {id => (
              <Select id={id} value={filters.study} onChange={e => set('study', e.target.value)}>
                <option value="">All studies</option>
                {studies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="From">
            {id => <Input id={id} type="date" value={filters.from} onChange={e => set('from', e.target.value)} />}
          </Field>
          <Field label="To">
            {id => <Input id={id} type="date" value={filters.to} onChange={e => set('to', e.target.value)} />}
          </Field>
        </div>
        {filtering && (
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setFilters(EMPTY); setPage(0) }}>Clear filters</Button>
          </div>
        )}
      </Card>

      {exportError && <div className="mb-4"><Notice notice={{ tone: 'error', text: `CSV export failed: ${exportError}` }} onClose={() => setExportError(null)} /></div>}

      {result?.error ? (
        <ErrorState title="Could not load the activity log" message={result.error} onRetry={() => setAttempt(a => a + 1)} />
      ) : loading && !result ? (
        <SkeletonRows rows={8} />
      ) : rows.length === 0 && !loading ? (
        <EmptyState icon={<ScrollText size={30} aria-hidden="true" />} title="No activity found"
          hint={filtering ? 'Try different filters.' : 'Entries appear here as people make changes.'} />
      ) : (
        <div className={`overflow-hidden rounded-lg border border-line bg-surface ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <div className="hidden grid-cols-[9.5rem_11rem_minmax(0,1fr)] gap-4 border-b border-line bg-sunken px-4 py-2.5 text-xs font-semibold text-subtle md:grid" aria-hidden="true">
            <span>When</span><span>Action</span><span>What happened</span>
          </div>
          <ul className="divide-y divide-line" aria-label="Activity">
            {rows.map(r => {
              const d = describeAudit(r, ctx)
              return (
                <li key={r.id} data-testid="audit-row" className="grid grid-cols-1 gap-1.5 px-4 py-3 md:grid-cols-[9.5rem_11rem_minmax(0,1fr)] md:gap-4">
                  <time dateTime={r.at} className="text-xs tabular-nums text-subtle">{format(new Date(r.at), 'd MMM yyyy, HH:mm')}</time>
                  <span><Badge tone={TONE[auditTone(r.action)]}>{AUDIT_ACTION_LABEL[r.action] || r.action}</Badge></span>
                  <div className="min-w-0 text-sm text-fg">
                    <p className="break-words">{d.sentence}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {d.studyId && <Link href={studyPaths(d.studyId).overview} className="font-medium text-accent hover:underline">Open study</Link>}
                      {d.studyId && d.participantId && (
                        <Link href={`${studyPaths(d.studyId).participants}?participant=${d.participantId}`} className="font-medium text-accent hover:underline">Open participant</Link>
                      )}
                      {r.action.startsWith('study_') && r.action !== 'study_deleted' && !d.studyId && (r.target_id || d.studyName) && (
                        <span className="text-subtle">The study no longer exists</span>
                      )}
                    </p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-subtle">Technical details</summary>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-sunken p-2 text-[11px] text-muted">{JSON.stringify({ actor: emailOf(r.actor), target: `${r.target_type}:${r.target_id}`, ...r.details }, null, 2)}</pre>
                    </details>
                  </div>
                </li>
              )
            })}
          </ul>
          <nav className="border-t border-line px-4 py-3" aria-label="Activity log pages">
            <Pagination page={page} pageSize={PAGE} total={total} onPage={p => setPage(Math.max(0, Math.min(pages - 1, p)))} />
          </nav>
        </div>
      )}
    </div>
  )
}

export default function ActivityPage() {
  return <AdminOnly><AuditLog /></AdminOnly>
}
