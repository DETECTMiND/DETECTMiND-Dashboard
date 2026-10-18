'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ArrowRight, ClipboardCheck, FlaskConical, ScrollText, UserCog } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { AdminOnly } from '@/components/admin-only'
import { Notice } from '@/components/feedback'
import { describeAudit, type AuditRow } from '@/lib/audit-format'
import { isPendingApproval } from '@/lib/pending-studies'

type StudyRow = { id: string; name: string; status: string; approved_at: string | null; created_at: string }
type ResearcherSummary = { user_id: string; active: boolean; accepted: boolean; role: string }

const STATUS_ORDER = ['active', 'paused', 'completed', 'draft'] as const
const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-500', paused: 'bg-amber-400', completed: 'bg-blue-500', draft: 'bg-gray-400',
}

function Card({ title, icon, href, linkLabel, children }: {
  title: string; icon: React.ReactNode; href: string; linkLabel: string; children: React.ReactNode
}) {
  return (
    <section className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700">{icon}{title}</h2>
      <div className="mt-3 flex-1">{children}</div>
      <Link href={href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
        {linkLabel} <ArrowRight size={14} />
      </Link>
    </section>
  )
}

function AdminOverview() {
  const supabase = useMemo(() => createClient(), [])
  const [studies, setStudies] = useState<StudyRow[] | null>(null)
  const [researchers, setResearchers] = useState<ResearcherSummary[] | null>(null)
  const [audit, setAudit] = useState<AuditRow[] | null>(null)
  const [people, setPeople] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('studies').select('id, name, status, approved_at, created_at').order('created_at', { ascending: false }),
      supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(10),
      supabase.from('researchers').select('user_id, email, display_name'),
      fetch('/api/admin/researchers').then(async r => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(typeof body.error === 'string' ? body.error : `Could not load researchers (${r.status})`)
        return (body.researchers || []) as ResearcherSummary[]
      }),
    ]).then(([s, a, p, r]) => {
      if (cancelled) return
      const problem = s.error?.message || a.error?.message || p.error?.message
      if (problem) setError(problem)
      setStudies((s.data || []) as StudyRow[])
      setAudit((a.data || []) as AuditRow[])
      setPeople(Object.fromEntries((p.data || []).map(x => [x.user_id as string, (x.display_name as string) || (x.email as string) || ''])))
      setResearchers(r)
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the overview') })
    return () => { cancelled = true }
  }, [supabase])

  const pending = (studies || []).filter(isPendingApproval)
  const studyNames = Object.fromEntries((studies || []).map(s => [s.id, s.name]))
  const byStatus = STATUS_ORDER.map(status => ({
    status,
    count: (studies || []).filter(s => s.status === status && !isPendingApproval(s)).length,
  }))
  const active = (researchers || []).filter(r => r.active && r.accepted).length
  const invited = (researchers || []).filter(r => r.active && !r.accepted).length
  const deactivated = (researchers || []).filter(r => !r.active).length
  const admins = (researchers || []).filter(r => r.active && r.role === 'admin').length
  const dash = (v: unknown) => (v === null ? '…' : null)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin overview</h1>
        <p className="mt-0.5 text-sm text-gray-500">Studies waiting for approval, researcher accounts and recent sensitive actions.</p>
      </div>

      {error && <Notice notice={{ tone: 'error', text: error }} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card title="Pending approval" icon={<ClipboardCheck size={16} className="text-orange-500" />} href="/admin/studies?filter=pending" linkLabel="Review pending studies">
          <p className="text-3xl font-bold tabular-nums text-gray-900">{dash(studies) ?? pending.length}</p>
          <p className="text-xs text-gray-500">{pending.length === 1 ? 'study is' : 'studies are'} waiting for an admin. Participants cannot join until approved.</p>
          {pending.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {pending.slice(0, 4).map(s => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/studies/${s.id}`} className="min-w-0 truncate font-medium text-gray-800 hover:text-blue-600">{s.name}</Link>
                  <span className="shrink-0 text-xs text-gray-400">{formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}</span>
                </li>
              ))}
              {pending.length > 4 && <li className="text-xs text-gray-400">and {pending.length - 4} more</li>}
            </ul>
          )}
        </Card>

        <Card title="Researchers" icon={<UserCog size={16} className="text-violet-500" />} href="/admin/researchers" linkLabel="Manage researchers">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Active', value: active, cls: 'text-emerald-700' },
              { label: 'Invited', value: invited, cls: 'text-orange-600' },
              { label: 'Deactivated', value: deactivated, cls: 'text-gray-500' },
            ].map(x => (
              <div key={x.label} className="rounded-lg bg-gray-50 px-2 py-3">
                <dd className={`text-2xl font-bold tabular-nums ${x.cls}`}>{dash(researchers) ?? x.value}</dd>
                <dt className="text-[11px] font-medium text-gray-500">{x.label}</dt>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-gray-500">{researchers ? `${admins} active admin${admins === 1 ? '' : 's'}. Invited means they have not signed in yet.` : ' '}</p>
        </Card>

        <Card title="Studies by status" icon={<FlaskConical size={16} className="text-blue-500" />} href="/admin/studies" linkLabel="All studies">
          <ul className="space-y-2">
            {byStatus.map(({ status, count }) => (
              <li key={status} className="flex items-center gap-2 text-sm">
                <span className={`h-2 w-2 rounded-full ${STATUS_STYLE[status]}`} />
                <span className="flex-1 capitalize text-gray-700">{status === 'draft' ? 'Draft (approved, parked)' : status}</span>
                <span className="font-semibold tabular-nums text-gray-900">{dash(studies) ?? count}</span>
              </li>
            ))}
            <li className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-orange-500" />
              <span className="flex-1 text-gray-700">Pending approval</span>
              <span className="font-semibold tabular-nums text-gray-900">{dash(studies) ?? pending.length}</span>
            </li>
          </ul>
        </Card>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700"><ScrollText size={16} className="text-gray-400" />Recent activity</h2>
          <Link href="/admin/audit" className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">Full audit log <ArrowRight size={14} /></Link>
        </div>
        {audit === null ? (
          <p className="px-5 py-6 text-sm text-gray-500">Loading…</p>
        ) : audit.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-500">No activity recorded yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {audit.map(row => {
              const d = describeAudit(row, { people, studies: studyNames })
              return (
                <li key={row.id} className="flex flex-col gap-0.5 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                  <span className="shrink-0 text-xs tabular-nums text-gray-400 sm:w-32" title={row.at}>{formatDistanceToNow(new Date(row.at), { addSuffix: true })}</span>
                  <span className="min-w-0 break-words text-sm text-gray-700">
                    {d.sentence}
                    {d.studyId && <> · <Link href={`/studies/${d.studyId}`} className="text-blue-600 hover:underline">Open study</Link></>}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

export default function AdminOverviewPage() {
  return <AdminOnly><AdminOverview /></AdminOnly>
}
