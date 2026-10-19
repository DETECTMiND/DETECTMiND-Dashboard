'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { ArrowRight, FlaskConical, RefreshCw, Search, Settings, UsersRound } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { AdminOnly } from '@/components/admin-only'
import {
  Button, EmptyState, ErrorState, FilterPills, Input, PageHeader, SkeletonRows, StatusPill, errorText,
  ActionMenu,
} from '@/components/ui'
import { isPendingApproval } from '@/lib/pending-studies'
import { studyPaths } from '@/lib/nav'

type StudyRow = { id: string; name: string; status: string; created_at: string; approved_at: string | null }
type MemberRow = { study_id: string; user_id: string; role: 'owner' | 'editor' | 'viewer' }
type ResearcherRow = { user_id: string; email: string | null; display_name: string | null }

type StudyView = StudyRow & {
  pending: boolean
  owners: string[]
  participantCount: number | null
}

const FILTERS = ['all', 'pending', 'active', 'paused', 'completed'] as const
type Filter = (typeof FILTERS)[number]
const FILTER_LABEL: Record<Filter, string> = { all: 'All', pending: 'Pending approval', active: 'Active', paused: 'Paused', completed: 'Completed' }

// Fixed tracks shared by the header and rows so columns line up
const COLS = 'xl:grid-cols-[minmax(0,2fr)_9.5rem_minmax(0,1.5fr)_6.5rem_7rem_2.5rem]'

function matchesFilter(st: StudyView, f: Filter) {
  if (f === 'all') return true
  if (f === 'pending') return st.pending
  return !st.pending && st.status === f
}

function AdminStudies() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const raw = params.get('filter')
  const filter: Filter = (FILTERS as readonly string[]).includes(raw ?? '') ? raw as Filter : 'all'
  const [studies, setStudies] = useState<StudyView[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const fetchAll = useCallback(async (): Promise<{ rows: StudyView[]; error: string | null }> => {
    const [s, m, r] = await Promise.all([
      supabase.from('studies').select('id, name, status, created_at, approved_at').order('created_at', { ascending: false }),
      supabase.from('study_members').select('study_id, user_id, role').eq('role', 'owner'),
      supabase.from('researchers').select('user_id, email, display_name'),
    ])
    const error = s.error ?? m.error ?? r.error
    if (error) return { rows: [], error: errorText(error) }
    const studyRows = (s.data || []) as StudyRow[]
    const owners = (m.data || []) as MemberRow[]
    const nameOf = new Map(((r.data || []) as ResearcherRow[]).map(x => [x.user_id, x.display_name || x.email || 'Unknown']))

    const counts = await Promise.all(studyRows.map(st =>
      supabase.from('participants').select('id', { count: 'exact', head: true }).eq('study_id', st.id)
        .then(res => (res.error ? null : res.count ?? 0))))

    const rows = studyRows.map((st, i): StudyView => ({
      ...st,
      pending: isPendingApproval(st),
      owners: owners.filter(x => x.study_id === st.id).map(x => nameOf.get(x.user_id) ?? 'Unknown').sort((a, b) => a.localeCompare(b)),
      participantCount: counts[i],
    }))
    rows.sort((a, b) => Number(b.pending) - Number(a.pending) || b.created_at.localeCompare(a.created_at))
    return { rows, error: null }
  }, [supabase])

  useEffect(() => {
    let cancelled = false
    fetchAll().then(res => {
      if (cancelled) return
      setStudies(res.rows)
      setLoadError(res.error)
    })
    return () => { cancelled = true }
  }, [fetchAll])

  async function reload() {
    const res = await fetchAll()
    setStudies(res.rows)
    setLoadError(res.error)
  }

  function setFilter(next: Filter) {
    router.replace(next === 'all' ? pathname : `${pathname}?filter=${next}`, { scroll: false })
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (studies || []).filter(st => matchesFilter(st, filter)
      && (!needle || st.name.toLowerCase().includes(needle) || st.owners.some(o => o.toLowerCase().includes(needle))))
  }, [studies, query, filter])

  const count = (f: Filter) => (studies ? studies.filter(st => matchesFilter(st, f)).length : null)

  return (
    <div>
      <PageHeader
        title="Studies"
        description="All studies. Teams and settings are managed inside each study."
        actions={<Button variant="secondary" onClick={() => void reload()}><RefreshCw size={14} aria-hidden="true" /> Refresh</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterPills label="Filter by status" value={filter} onChange={setFilter}
          options={FILTERS.map(f => ({ value: f, label: FILTER_LABEL[f], count: count(f) }))} />
        <div className="relative w-full lg:w-72">
          <label htmlFor="study-search" className="sr-only">Search studies</label>
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <Input id="study-search" type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by study or owner" className="pl-8" />
        </div>
      </div>

      {filter === 'pending' && (count('pending') ?? 0) > 0 && (
        <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-accent-soft px-4 py-3 text-sm text-fg">
          Approve or reject these studies on the Approvals page.
          <Link href="/admin/approvals" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
            Go to approvals <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </p>
      )}

      {loadError ? (
        <ErrorState title="Could not load studies" message={loadError} onRetry={() => void reload()} />
      ) : studies === null ? (
        <SkeletonRows rows={6} />
      ) : visible.length === 0 ? (
        <EmptyState icon={<FlaskConical size={30} aria-hidden="true" />}
          title={studies.length ? 'No studies match' : 'No studies yet'}
          hint={studies.length ? 'Try another status or search.' : 'Studies appear here once a researcher or admin creates one.'} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          {/* Column headings from md up; below md each row is a card. */}
          <div aria-hidden="true" className={`hidden gap-4 border-b border-line bg-sunken px-4 py-2.5 text-xs font-semibold text-subtle xl:grid ${COLS}`}>
            <span>Study</span><span>Status</span><span>Owners</span><span>Participants</span><span>Created</span><span className="sr-only">Actions</span>
          </div>
          <ul className="divide-y divide-line" aria-label="Studies">
            {visible.map(st => (
              <li key={st.id} data-testid="study-row" data-study-id={st.id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-4 py-3.5 xl:items-center ${COLS}`}>
                <div className="min-w-0">
                  <Link href={studyPaths(st.id).overview} className="block truncate text-sm font-medium text-fg hover:text-accent" title={st.name}>{st.name}</Link>
                </div>
                <div className="order-3 xl:order-none"><StatusPill study={st} /></div>
                <div className="order-4 col-span-2 min-w-0 text-sm xl:order-none xl:col-span-1">
                  <span className="mr-1 text-xs text-subtle xl:hidden">Owners:</span>
                  {st.owners.length === 0
                    ? <span className="text-danger">No owner</span>
                    : <span className="break-words text-muted">{st.owners.join(', ')}</span>}
                </div>
                <div className="order-5 col-span-2 flex gap-6 text-sm text-muted xl:order-none xl:col-span-1 xl:contents">
                  <p className="tabular-nums"><span className="mr-1 text-xs text-subtle xl:hidden">Participants:</span>{st.participantCount ?? '—'}</p>
                  <p><span className="mr-1 text-xs text-subtle xl:hidden">Created:</span>{format(new Date(st.created_at), 'd MMM yyyy')}</p>
                </div>
                <div className="order-2 flex justify-end xl:order-none">
                  <ActionMenu label={`Actions for ${st.name}`} items={[
                    { label: 'Open overview', icon: <ArrowRight />, href: studyPaths(st.id).overview },
                    { label: 'Manage team', icon: <UsersRound />, href: studyPaths(st.id).team },
                    { label: 'Settings', icon: <Settings />, href: studyPaths(st.id).settings },
                  ]} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function AdminStudiesPage() {
  return (
    <AdminOnly>
      <Suspense fallback={<SkeletonRows rows={6} />}>
        <AdminStudies />
      </Suspense>
    </AdminOnly>
  )
}
