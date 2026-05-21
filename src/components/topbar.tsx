'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { ChevronsUpDown, Check, FlaskConical, Plus } from 'lucide-react'
import Link from 'next/link'

interface Study {
  id: string
  name: string
  status: string
}

const STATUS_DOT: Record<string, string> = {
  draft:     'bg-gray-400',
  active:    'bg-emerald-500',
  paused:    'bg-amber-400',
  completed: 'bg-blue-400',
}

export default function Topbar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [studies, setStudies] = useState<Study[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [pinnedStudyId, setPinnedStudyId] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('pinnedStudyId')
    supabase
      .from('studies')
      .select('id, name, status')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { console.error(error); return }
        const list = (data || []) as Study[]
        setStudies(list)
        if (saved && list.some(s => s.id === saved)) {
          setPinnedStudyId(saved)
        } else if (list.length > 0) {
          setPinnedStudyId(list[0].id)
          localStorage.setItem('pinnedStudyId', list[0].id)
        }
      })
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const studyIdMatch = pathname.match(/^\/studies\/([^/]+)/)
  const activeStudyId = studyIdMatch ? studyIdMatch[1] : null

  useEffect(() => {
    if (activeStudyId && activeStudyId !== 'new') {
      setPinnedStudyId(activeStudyId)
      localStorage.setItem('pinnedStudyId', activeStudyId)
    }
  }, [activeStudyId])

  const effectiveStudyId = activeStudyId && activeStudyId !== 'new'
    ? activeStudyId
    : pinnedStudyId ?? (studies.length > 0 ? studies[0].id : null)

  const selectedStudy = studies.find(s => s.id === effectiveStudyId)

  function switchStudy(newId: string) {
    setPinnedStudyId(newId)
    localStorage.setItem('pinnedStudyId', newId)
    setDropdownOpen(false)
    // If currently on a study sub-page, navigate to same sub-page of new study
    if (activeStudyId && activeStudyId !== 'new') {
      const subPath = pathname.replace(`/studies/${activeStudyId}`, '') || ''
      router.push(`/studies/${newId}${subPath}`)
    } else {
      router.push(`/studies/${newId}`)
    }
  }

  // Don't render switcher if no studies
  if (studies.length === 0) return (
    <header className="h-12 border-b border-gray-200 bg-white flex items-center px-6 justify-end shrink-0">
      <Link
        href="/studies/new"
        className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
      >
        <Plus size={13} /> New Study
      </Link>
    </header>
  )

  return (
    <header className="h-12 border-b border-gray-200 bg-white flex items-center px-6 justify-end shrink-0">
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setDropdownOpen(o => !o)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-all text-sm"
        >
          {selectedStudy ? (
            <>
              <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[selectedStudy.status] || STATUS_DOT.draft}`} />
              <span className="font-semibold text-gray-800 max-w-48 truncate">{selectedStudy.name}</span>
            </>
          ) : (
            <>
              <FlaskConical size={13} className="text-gray-400" />
              <span className="text-gray-400">Select study</span>
            </>
          )}
          <ChevronsUpDown size={13} className="text-gray-400 shrink-0" />
        </button>

        {dropdownOpen && (
          <div className="absolute top-full right-0 mt-1.5 bg-white rounded-xl border border-gray-200 shadow-xl z-50 w-72 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Switch Study</p>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {studies.map(s => {
                const active = effectiveStudyId === s.id
                return (
                  <button
                    key={s.id}
                    onClick={() => switchStudy(s.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${active ? 'bg-blue-50' : ''}`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[s.status] || STATUS_DOT.draft}`} />
                    <span className={`flex-1 text-sm font-medium truncate ${active ? 'text-blue-700' : 'text-gray-700'}`}>{s.name}</span>
                    <span className="text-[11px] text-gray-400 capitalize shrink-0">{s.status}</span>
                    {active && <Check size={13} className="text-blue-600 shrink-0" />}
                  </button>
                )
              })}
            </div>
            <div className="border-t border-gray-100 p-2">
              <Link
                href="/studies/new"
                onClick={() => setDropdownOpen(false)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-blue-600 hover:bg-blue-50 font-semibold transition-colors w-full"
              >
                <Plus size={14} /> New Study
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
