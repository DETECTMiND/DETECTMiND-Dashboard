'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Users, Database, ClipboardList, Settings, Edit2, Trash2, ChevronRight } from 'lucide-react'

interface Study {
  id: string
  name: string
  description: string | null
  app_description: string | null
  status: string
  sync_interval_minutes: number
  created_at: string
}

const STATUS_STYLES: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600 border border-gray-200',
  active:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  paused:    'bg-amber-50 text-amber-700 border border-amber-200',
  completed: 'bg-blue-50 text-blue-700 border border-blue-200',
}

const statusOptions = ['draft', 'active', 'paused', 'completed']

export default function StudyDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const supabase = createClient()
  const [study, setStudy] = useState<Study | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Partial<Study>>({})
  const [participantCount, setParticipantCount] = useState(0)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('studies').select('*').eq('id', id).single()
      if (data) { setStudy(data); setForm(data) }
      const { count } = await supabase.from('participants').select('*', { count: 'exact', head: true }).eq('study_id', id)
      setParticipantCount(count || 0)
    }
    load()
  }, [id])

  async function handleSave() {
    if (!study) return
    const { error } = await supabase.from('studies').update({
      name: form.name || study.name,
      description: form.description ?? study.description,
      app_description: form.app_description ?? study.app_description,
      status: form.status || study.status,
      sync_interval_minutes: form.sync_interval_minutes ?? study.sync_interval_minutes,
    }).eq('id', id)
    if (!error) { setStudy({ ...study, ...form } as Study); setEditing(false) }
  }

  async function handleDelete() {
    if (!confirm('Delete this study and all its data? This cannot be undone.')) return
    await supabase.from('studies').delete().eq('id', id)
    router.push('/studies')
  }

  if (!study) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-24" />
        <div className="h-36 bg-gray-200 rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
        </div>
      </div>
    )
  }

  const tabs = [
    { href: `/studies/${id}/participants`, label: 'Participants', icon: Users, description: `${participantCount} enrolled` },
    { href: `/studies/${id}/data`, label: 'Sensor Data', icon: Database, description: 'Browse & export' },
    { href: `/studies/${id}/esm`, label: 'ESM / EMA', icon: ClipboardList, description: 'Survey schedules' },
    { href: `/studies/${id}/config`, label: 'Sensor Config', icon: Settings, description: 'Collection settings' },
  ]

  return (
    <div className="space-y-6">
      <Link href="/studies" className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors">
        <ArrowLeft size={15} /> Back to Studies
      </Link>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {editing ? (
          <div className="px-6 py-5 space-y-4">
            <h2 className="font-semibold text-gray-800 mb-4">Edit Study</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Name</label>
              <input
                value={form.name || ''}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Description <span className="text-gray-400 font-normal">(internal)</span></label>
              <textarea
                value={form.description || ''}
                onChange={e => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">App Description <span className="text-gray-400 font-normal">(shown to participants)</span></label>
              <textarea
                value={form.app_description || ''}
                onChange={e => setForm({ ...form, app_description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
                <select
                  value={form.status}
                  onChange={e => setForm({ ...form, status: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                >
                  {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Sync Interval (minutes)</label>
                <input
                  type="number"
                  value={form.sync_interval_minutes || 30}
                  onChange={e => setForm({ ...form, sync_interval_minutes: parseInt(e.target.value) })}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors">
                Save Changes
              </button>
              <button onClick={() => { setEditing(false); setForm(study) }} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleDelete} className="ml-auto flex items-center gap-1.5 px-4 py-2 text-red-500 hover:bg-red-50 border border-red-200 rounded-lg text-sm transition-colors">
                <Trash2 size={14} /> Delete Study
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl font-bold text-gray-900">{study.name}</h1>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[study.status] || STATUS_STYLES.draft}`}>
                    {study.status}
                  </span>
                </div>
                {study.description && <p className="text-gray-500 text-sm mt-1.5">{study.description}</p>}
                {study.app_description && (
                  <p className="text-gray-400 text-xs mt-1">
                    <span className="font-medium text-gray-500">App: </span>{study.app_description}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                  <span>{participantCount} participants</span>
                  <span>Sync every {study.sync_interval_minutes} min</span>
                </div>
              </div>
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors shrink-0"
              >
                <Edit2 size={13} /> Edit
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tabs.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className="bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all px-4 py-4 flex items-center gap-3 group"
          >
            <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center group-hover:bg-blue-50 transition-colors shrink-0">
              <tab.icon size={16} className="text-gray-500 group-hover:text-blue-500 transition-colors" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">{tab.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{tab.description}</p>
            </div>
            <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-400 ml-auto shrink-0 transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  )
}
