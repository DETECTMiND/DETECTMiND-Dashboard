'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState } from 'react'
import { Plus, FlaskConical, Pencil, X, Check } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Study {
  id: string
  name: string
  description: string | null
  app_description: string | null
  status: string
  created_at: string
}

const STATUS_OPTIONS = ['draft', 'active', 'paused', 'completed', 'archived']

const STATUS_STYLES: Record<string, { pill: string; dot: string }> = {
  draft:     { pill: 'bg-gray-100 text-gray-600 border-gray-200',       dot: 'bg-gray-400' },
  active:    { pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  paused:    { pill: 'bg-amber-50 text-amber-700 border-amber-200',      dot: 'bg-amber-400' },
  completed: { pill: 'bg-blue-50 text-blue-700 border-blue-200',         dot: 'bg-blue-400' },
  archived:  { pill: 'bg-gray-100 text-gray-400 border-gray-200',        dot: 'bg-gray-300' },
}

const BLANK = { name: '', description: '', appDescription: '' }

export default function SettingsPage() {
  const supabase = createClient()
  const [studies, setStudies] = useState<Study[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')

  async function load() {
    const { data } = await supabase.from('studies').select('*').order('created_at', { ascending: false })
    setStudies((data || []) as Study[])
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    await supabase.from('studies').insert({
      name: form.name,
      description: form.description || null,
      app_description: form.appDescription || null,
    })
    setForm(BLANK)
    setShowCreate(false)
    setCreating(false)
    load()
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('studies').update({ status }).eq('id', id)
    load()
  }

  async function saveEdit(id: string) {
    await supabase.from('studies').update({ name: editName, description: editDesc || null }).eq('id', id)
    setEditingId(null)
    load()
  }

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage studies and account settings</p>
      </div>

      {/* Studies section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Studies</h2>
            <p className="text-gray-400 text-xs mt-0.5">
              {studies.length} {studies.length === 1 ? 'study' : 'studies'}
            </p>
          </div>
          {!showCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
            >
              <Plus size={14} /> New Study
            </button>
          )}
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden mb-3">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-blue-50/40">
              <h3 className="font-semibold text-sm text-gray-800">New Study</h3>
              <button onClick={() => { setShowCreate(false); setForm(BLANK) }} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="px-5 py-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Study Name *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  required
                  autoFocus
                  placeholder="e.g. Sleep Pattern Study 2025"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Description <span className="text-gray-400 font-normal">(internal notes)</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  placeholder="Internal notes about this study…"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  App Description <span className="text-gray-400 font-normal">(shown to participants)</span>
                </label>
                <textarea
                  value={form.appDescription}
                  onChange={e => setForm(f => ({ ...f, appDescription: e.target.value }))}
                  rows={2}
                  placeholder="What participants will see in the mobile app…"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all resize-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={creating}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                >
                  {creating ? 'Creating…' : 'Create Study'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setForm(BLANK) }}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Study list */}
        {studies.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 py-14 text-center">
            <FlaskConical size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium text-sm">No studies yet</p>
            <p className="text-gray-400 text-xs mt-1">Create your first study to get started</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              <Plus size={14} /> New Study
            </button>
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
                      <div className="min-w-0">
                        {editingId === study.id ? (
                          <div className="space-y-1.5 mb-1 pr-1">
                            <input
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              className="w-full px-2.5 py-1.5 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                              onKeyDown={e => { if (e.key === 'Escape') setEditingId(null) }}
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
                              <button
                                onClick={() => { setEditingId(study.id); setEditName(study.name); setEditDesc(study.description || '') }}
                                className="text-gray-300 hover:text-gray-500 transition-colors"
                              >
                                <Pencil size={11} />
                              </button>
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
                    <select
                      value={study.status}
                      onChange={e => updateStatus(study.id, e.target.value)}
                      className={`shrink-0 text-xs px-2.5 py-1.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all ${style.pill}`}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
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
