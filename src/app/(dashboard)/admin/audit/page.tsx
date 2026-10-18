'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ScrollText } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { AdminOnly } from '@/components/admin-only'
import { EmptyState, LoadingBlock, Notice } from '@/components/feedback'

type AuditRow = {
  id: number
  actor: string | null
  action: string
  target_type: string | null
  target_id: string | null
  details: Record<string, unknown> | null
  at: string
}

const ACTIONS: { value: string; label: string }[] = [
  { value: 'participant_deleted', label: 'Participant deleted' },
  { value: 'participant_merged', label: 'Participants merged' },
  { value: 'study_pin_changed', label: 'Study PIN changed' },
  { value: 'study_member_added', label: 'Team member added' },
  { value: 'study_member_changed', label: 'Team role changed' },
  { value: 'study_member_removed', label: 'Team member removed' },
  { value: 'researcher_invited', label: 'Researcher invited' },
  { value: 'researcher_role_changed', label: 'Researcher role changed' },
  { value: 'researcher_deactivated', label: 'Researcher deactivated' },
  { value: 'researcher_reactivated', label: 'Researcher reactivated' },
]
const ACTION_LABEL = Object.fromEntries(ACTIONS.map(a => [a.value, a.label]))
const PAGE = 100

function summarise(row: AuditRow, studies: Record<string, string>): string {
  const d = row.details || {}
  const str = (k: string) => (typeof d[k] === 'string' || typeof d[k] === 'number' ? String(d[k]) : '')
  const study = (id: string) => studies[id] || id.slice(0, 8)
  switch (row.action) {
    case 'participant_deleted': {
      const counts = (d.counts || {}) as Record<string, number>
      const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0)
      return `${str('label') || str('device_id')} in ${study(str('study_id'))} · ${total.toLocaleString()} rows removed`
    }
    case 'participant_merged': return `Duplicate ${str('duplicate').slice(0, 8)} merged into ${row.target_id?.slice(0, 8)} (${study(str('study_id'))})`
    case 'study_pin_changed': return `${study(row.target_id || '')}: PIN ${d.pin_required ? 'set' : 'removed'}`
    case 'study_member_added': return `${str('email') || str('user_id')} added to ${study(row.target_id || '')} as ${str('role')}`
    case 'study_member_changed': return `${str('email') || str('user_id')} in ${study(row.target_id || '')}: ${str('from')} → ${str('to')}`
    case 'study_member_removed': return `${str('email') || str('user_id')} removed from ${study(row.target_id || '')}`
    case 'researcher_invited': return `${str('email')}${d.resend ? ` (${d.kind === 'password_reset' ? 'reset link' : 'invite re-sent'})` : ` as ${str('role')}`}`
    case 'researcher_role_changed': return `${str('email')}: ${str('from')} → ${str('to')}`
    default: return str('email') || JSON.stringify(d)
  }
}

function AuditLog() {
  const supabase = useMemo(() => createClient(), [])
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [result, setResult] = useState<{ key: string; rows: AuditRow[]; error: string | null } | null>(null)
  const [people, setPeople] = useState<Record<string, string>>({})
  const [studies, setStudies] = useState<Record<string, string>>({})
  const key = `${action}|${from}|${to}|${limit}`

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('researchers').select('user_id, email'),
      supabase.from('studies').select('id, name'),
    ]).then(([r, s]) => {
      if (cancelled) return
      setPeople(Object.fromEntries((r.data || []).map(x => [x.user_id as string, (x.email as string) || ''])))
      setStudies(Object.fromEntries((s.data || []).map(x => [x.id as string, x.name as string])))
    })
    return () => { cancelled = true }
  }, [supabase])

  useEffect(() => {
    let cancelled = false
    let q = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(limit)
    if (action) q = q.eq('action', action)
    if (from) q = q.gte('at', new Date(`${from}T00:00:00`).toISOString())
    if (to) q = q.lt('at', new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString())
    q.then(({ data, error }) => {
      if (!cancelled) setResult({ key, rows: (data || []) as AuditRow[], error: error?.message ?? null })
    })
    return () => { cancelled = true }
  }, [supabase, action, from, to, limit, key])

  const loading = result?.key !== key
  const needle = search.trim().toLowerCase()
  const rows = (result?.rows || []).filter(r => !needle
    || (people[r.actor || ''] || '').toLowerCase().includes(needle)
    || (r.target_id || '').toLowerCase().includes(needle)
    || JSON.stringify(r.details || {}).toLowerCase().includes(needle)
    || summarise(r, studies).toLowerCase().includes(needle))

  const resetLimit = () => setLimit(PAGE)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit log</h1>
        <p className="mt-0.5 text-sm text-gray-500">Sensitive actions across every study: deletions, merges, PIN and access changes.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <label className="text-xs font-medium text-gray-600">Action
          <select value={action} onChange={e => { setAction(e.target.value); resetLimit() }}
            className="mt-1 block rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm">
            <option value="">All actions</option>
            {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">From
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); resetLimit() }}
            className="mt-1 block rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-medium text-gray-600">To
          <input type="date" value={to} onChange={e => { setTo(e.target.value); resetLimit() }}
            className="mt-1 block rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="min-w-[14rem] flex-1 text-xs font-medium text-gray-600">Search
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Email, id or detail…"
            className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
        </label>
        {(action || from || to || search) && (
          <button onClick={() => { setAction(''); setFrom(''); setTo(''); setSearch(''); resetLimit() }}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Clear</button>
        )}
      </div>

      {result?.error ? (
        <Notice notice={{ tone: 'error', text: result.error }} />
      ) : loading && !result ? (
        <LoadingBlock label="Loading audit log…" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ScrollText size={30} />} title="No audit entries" hint={action || from || to || search ? 'Try different filters.' : 'Entries appear here as people make changes.'} />
      ) : (
        <section className={`overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm ${loading ? 'opacity-60' : ''}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-4 py-2.5">Who</th>
                  <th className="px-4 py-2.5">Action</th>
                  <th className="px-4 py-2.5">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-gray-500" title={r.at}>{format(new Date(r.at), 'd MMM yyyy, HH:mm')}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-700">{r.actor ? (people[r.actor] || r.actor.slice(0, 8)) : <span className="text-gray-400">system</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2.5"><span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">{ACTION_LABEL[r.action] || r.action}</span></td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">
                      {summarise(r, studies)}
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-gray-400">Raw</summary>
                        <pre className="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-2 text-[11px] text-gray-500">{JSON.stringify({ target: `${r.target_type}:${r.target_id}`, ...r.details }, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(result?.rows.length ?? 0) >= limit && (
            <div className="border-t border-gray-100 p-3 text-center">
              <button onClick={() => setLimit(l => l + PAGE)} className="rounded-lg border border-gray-200 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Load more</button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export default function AuditPage() {
  return <AdminOnly><AuditLog /></AdminOnly>
}
