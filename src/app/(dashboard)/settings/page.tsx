'use client'

import { createClient } from '@/lib/supabase-browser'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { FlaskConical, Pencil, X, Check, ChevronRight, UserRound } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useMyStudyRoles } from '@/lib/access'
import { LoadingBlock, Notice, errorText, type NoticeState } from '@/components/feedback'

interface Study {
  id: string
  name: string
  description: string | null
  app_description: string | null
  status: string
  created_at: string
}

const STATUS_OPTIONS = ['draft', 'active', 'paused', 'completed']

const STATUS_STYLES: Record<string, { pill: string; dot: string }> = {
  draft:     { pill: 'bg-gray-100 text-gray-600 border-gray-200',        dot: 'bg-gray-400' },
  active:    { pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  paused:    { pill: 'bg-amber-50 text-amber-700 border-amber-200',       dot: 'bg-amber-400' },
  completed: { pill: 'bg-blue-50 text-blue-700 border-blue-200',          dot: 'bg-blue-400' },
}

export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), [])
  const { roles, isAdmin } = useMyStudyRoles()
  const [studies, setStudies] = useState<Study[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [notice, setNotice] = useState<NoticeState>(null)
  const canEdit = (id: string) => isAdmin || roles[id] === 'owner' || roles[id] === 'editor'

  const fetchStudies = useCallback(async () => {
    const { data, error } = await supabase.from('studies').select('*').order('created_at', { ascending: false })
    return { rows: (data || []) as Study[], error }
  }, [supabase])

  const apply = useCallback((res: Awaited<ReturnType<typeof fetchStudies>>) => {
    setStudies(res.rows)
    if (res.error) setNotice({ tone: 'error', text: `Could not load studies: ${errorText(res.error)}` })
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchStudies().then(res => { if (!cancelled) apply(res) })
    return () => { cancelled = true }
  }, [fetchStudies, apply])

  async function save(id: string, patch: Partial<Study>, what: string) {
    if (patch.name !== undefined && !patch.name.trim()) {
      setNotice({ tone: 'error', text: 'A study needs a name.' })
      return false
    }
    const { data, error } = await supabase.from('studies').update(patch).eq('id', id).select('id')
    const ok = !error && !!data?.length
    setNotice(ok
      ? { tone: 'success', text: `${what} saved.` }
      : { tone: 'error', text: `Could not save ${what.toLowerCase()}: ${error ? errorText(error) : 'you do not have permission to edit this study.'}` })
    apply(await fetchStudies())
    return ok
  }

  async function updateStatus(id: string, status: string) {
    await save(id, { status }, 'Status')
  }

  async function saveEdit(id: string) {
    if (await save(id, { name: editName.trim(), description: editDesc.trim() || null }, 'Study details')) setEditingId(null)
  }

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage your studies and account</p>
      </div>

      <Link href="/settings/account" className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm hover:border-blue-300">
        <UserRound size={18} className="text-gray-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-800">Account &amp; password</p>
          <p className="text-xs text-gray-400">Your email, role and password</p>
        </div>
        <ChevronRight size={14} className="text-gray-300" />
      </Link>

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {/* Studies section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Studies</h2>
            <p className="text-gray-400 text-xs mt-0.5">
              {studies ? `${studies.length} ${studies.length === 1 ? 'study' : 'studies'}` : 'Loading…'}
            </p>
          </div>
          <Link href="/studies" className="text-sm font-semibold text-blue-600 hover:text-blue-700">View all studies</Link>
        </div>

        {studies === null ? (
          <LoadingBlock label="Loading studies…" />
        ) : studies.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 py-14 text-center">
            <FlaskConical size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium text-sm">No studies yet</p>
            <p className="text-gray-400 text-xs mt-1">Create your first study to get started</p>
            <Link href="/studies" className="mt-4 inline-flex text-sm font-semibold text-blue-600 hover:text-blue-700">Go to All Studies</Link>
          </div>
        ) : (
          <div className="space-y-2">
            {studies.map(study => {
              const style = STATUS_STYLES[study.status] || STATUS_STYLES.draft
              return (
                <div key={study.id} className="bg-white rounded-xl border border-gray-200 shadow-sm">
                  <div className="px-5 py-4 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                      <div className="min-w-0 flex-1">
                        {editingId === study.id ? (
                          <div className="space-y-1.5 mb-1 pr-1">
                            <input
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              className="w-full px-2.5 py-1.5 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveEdit(study.id)
                                if (e.key === 'Escape') setEditingId(null)
                              }}
                              placeholder="Study name"
                              autoFocus
                            />
                            <input
                              value={editDesc}
                              onChange={e => setEditDesc(e.target.value)}
                              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 placeholder-gray-400"
                              placeholder="Description (optional)"
                            />
                            <div className="flex items-center gap-2 pt-0.5">
                              <button onClick={() => saveEdit(study.id)} className="text-blue-600 hover:text-blue-700 transition-colors">
                                <Check size={15} />
                              </button>
                              <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                                <X size={15} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="font-semibold text-gray-900 text-sm">{study.name}</span>
                              {canEdit(study.id) && <button
                                onClick={() => { setEditingId(study.id); setEditName(study.name); setEditDesc(study.description || '') }}
                                className="text-gray-300 hover:text-gray-500 transition-colors"
                              >
                                <Pencil size={11} />
                              </button>}
                            </div>
                            {study.description && (
                              <p className="text-xs text-gray-400 truncate max-w-xs">{study.description}</p>
                            )}
                          </>
                        )}
                        <p className="text-xs text-gray-400 mt-0.5">
                          Created {formatDistanceToNow(new Date(study.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={study.status}
                        disabled={!canEdit(study.id)}
                        onChange={e => updateStatus(study.id, e.target.value)}
                        className={`text-xs px-2.5 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all ${style.pill}`}
                      >
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <Link
                        href={`/studies/${study.id}`}
                        className="p-1.5 text-gray-300 hover:text-gray-500 transition-colors"
                      >
                        <ChevronRight size={14} />
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
