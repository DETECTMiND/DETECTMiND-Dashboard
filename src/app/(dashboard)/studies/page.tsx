'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FlaskConical, Users, ChevronRight, Plus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Study {
  id: string
  name: string
  description: string | null
  status: string
  created_at: string
  participant_count?: number
}

const STATUS_STYLES: Record<string, { pill: string; border: string; dot: string }> = {
  draft:     { pill: 'bg-gray-100 text-gray-600 border-gray-200',        border: 'border-l-gray-300',    dot: 'bg-gray-400' },
  active:    { pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', border: 'border-l-emerald-500', dot: 'bg-emerald-500' },
  paused:    { pill: 'bg-amber-50 text-amber-700 border-amber-200',       border: 'border-l-amber-400',   dot: 'bg-amber-400' },
  completed: { pill: 'bg-blue-50 text-blue-700 border-blue-200',          border: 'border-l-blue-400',    dot: 'bg-blue-400' },
  archived:  { pill: 'bg-gray-100 text-gray-400 border-gray-200',         border: 'border-l-gray-200',    dot: 'bg-gray-300' },
}

export default function StudiesPage() {
  const supabase = createClient()
  const [studies, setStudies] = useState<Study[]>([])

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('studies').select('*').order('created_at', { ascending: false })
      if (!data) return
      const { data: counts } = await supabase.from('participants').select('study_id')
      const countMap: Record<string, number> = {}
      ;(counts || []).forEach(p => { countMap[p.study_id] = (countMap[p.study_id] || 0) + 1 })
      setStudies(data.map(s => ({ ...s, participant_count: countMap[s.id] || 0 })))
    }
    load()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Studies</h1>
          <p className="text-gray-500 text-sm mt-0.5">{studies.length} {studies.length === 1 ? 'study' : 'studies'}</p>
        </div>
        <Link
          href="/studies/new"
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
        >
          <Plus size={14} /> New Study
        </Link>
      </div>

      {studies.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <FlaskConical size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No studies yet</p>
          <p className="text-gray-400 text-sm mt-1">Create your first study to get started</p>
          <Link
            href="/studies/new"
            className="mt-4 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            <Plus size={14} /> Create Study
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {studies.map(study => {
            const style = STATUS_STYLES[study.status] || STATUS_STYLES.draft
            return (
              <Link
                key={study.id}
                href={`/studies/${study.id}`}
                className={`bg-white rounded-xl border border-gray-200 border-l-4 ${style.border} hover:shadow-sm hover:border-gray-300 transition-all flex items-center px-5 py-4 gap-4 group`}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{study.name}</p>
                  {study.description && (
                    <p className="text-gray-400 text-xs mt-0.5 truncate">{study.description}</p>
                  )}
                  <p className="text-gray-400 text-xs mt-1">
                    Created {formatDistanceToNow(new Date(study.created_at), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Users size={13} /> {study.participant_count}
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${style.pill}`}>
                    {study.status}
                  </span>
                  <ChevronRight size={15} className="text-gray-300 group-hover:text-gray-400 transition-colors" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
