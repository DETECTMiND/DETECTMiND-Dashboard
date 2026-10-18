'use client'

import { createClient } from '@/lib/supabase-browser'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, FlaskConical, Plus, Search, Users } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { STUDY_ROLE_LABEL, useMyStudyRoles } from '@/lib/access'
import { studyPaths } from '@/lib/nav'
import {
  Badge, ButtonLink, EmptyState, ErrorState, Input, PageHeader, Skeleton, StatusPill, errorText,
} from '@/components/ui'

interface Study {
  id: string
  name: string
  description: string | null
  status: string
  approved_at: string | null
  created_at: string
}

/** Show the search box once the list is longer than this. */
const SEARCH_AFTER = 6

export default function StudiesPage() {
  const supabase = useMemo(() => createClient(), [])
  const { roles, isAdmin } = useMyStudyRoles()
  const [studies, setStudies] = useState<Study[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const fetchStudies = useCallback(async () => {
    const { data, error } = await supabase.from('studies')
      .select('id, name, description, status, approved_at, created_at')
      .order('created_at', { ascending: false })
    if (error) return { error: errorText(error), list: [] as Study[], counts: {} }
    const list = (data || []) as Study[]
    // One head count per study, in parallel: exact however many participants there are.
    const results = await Promise.all(list.map(s =>
      supabase.from('participants').select('id', { count: 'exact', head: true }).eq('study_id', s.id)))
    const map: Record<string, number | null> = {}
    list.forEach((s, i) => { map[s.id] = results[i].error ? null : (results[i].count ?? 0) })
    return { error: null, list, counts: map }
  }, [supabase])

  const apply = useCallback((res: Awaited<ReturnType<typeof fetchStudies>>) => {
    setLoadError(res.error)
    setStudies(res.error ? null : res.list)
    setCounts(res.counts)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchStudies().then(res => { if (!cancelled) apply(res) })
    return () => { cancelled = true }
  }, [fetchStudies, apply])

  async function retry() {
    setLoadError(null)
    apply(await fetchStudies())
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!studies || !q) return studies ?? []
    return studies.filter(s => s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q))
  }, [studies, query])

  const roleLabel = (id: string) => {
    if (isAdmin) return STUDY_ROLE_LABEL.admin
    const r = roles[id]
    return r ? STUDY_ROLE_LABEL[r] : null
  }

  return (
    <div>
      <PageHeader title="Studies"
        description={studies ? `${studies.length} ${studies.length === 1 ? 'study' : 'studies'} you can open.` : 'Every study you can open.'}
        actions={<ButtonLink href="/studies/new"><Plus size={15} aria-hidden="true" /> New study</ButtonLink>} />

      {loadError ? (
        <ErrorState title="Could not load studies" message={loadError} onRetry={retry} />
      ) : studies === null ? (
        <div role="status" aria-label="Loading studies" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : studies.length === 0 ? (
        <EmptyState icon={<FlaskConical size={36} aria-hidden="true" />} title="No studies yet"
          hint="Create a study to choose what the phones collect and to invite participants.">
          <ButtonLink href="/studies/new"><Plus size={15} aria-hidden="true" /> Create your first study</ButtonLink>
        </EmptyState>
      ) : (
        <>
          {studies.length > SEARCH_AFTER && (
            <div className="relative mb-4 max-w-sm">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden="true" />
              <Input type="search" aria-label="Search studies" placeholder="Search studies" value={query}
                onChange={e => setQuery(e.target.value)} className="pl-9" />
            </div>
          )}
          {filtered.length === 0 ? (
            <EmptyState title="No studies match your search" hint={`Nothing found for “${query.trim()}”.`} />
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filtered.map(study => {
                const role = roleLabel(study.id)
                const count = counts[study.id]
                return (
                  <li key={study.id}>
                    <Link href={studyPaths(study.id).overview}
                      className="group flex h-full flex-col rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:border-line-strong hover:bg-sunken/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="min-w-0 break-words text-sm font-semibold text-fg">{study.name}</h2>
                        <StatusPill study={study} />
                      </div>
                      <p className={`mt-1.5 line-clamp-2 break-words text-sm ${study.description ? 'text-muted' : 'italic text-subtle'}`}>
                        {study.description || 'No description'}
                      </p>
                      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-4 text-xs text-subtle">
                        <span className="inline-flex items-center gap-1.5">
                          <Users size={13} aria-hidden="true" />
                          {count == null ? '—' : count.toLocaleString()} participant{count === 1 ? '' : 's'}
                        </span>
                        {role && <Badge tone={role === 'Viewer' ? 'neutral' : 'blue'}>Your role: {role}</Badge>}
                        <span>Created {formatDistanceToNow(new Date(study.created_at), { addSuffix: true })}</span>
                        <ChevronRight size={15} className="ml-auto text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
