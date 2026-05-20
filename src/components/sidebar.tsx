'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import {
  LayoutDashboard, FlaskConical, LogOut, Users, Database,
  ClipboardList, Settings, ChevronsUpDown, Check,
} from 'lucide-react'

interface Study {
  id: string
  name: string
  status: string
}

const STUDY_SUB_PAGES = [
  { suffix: '',              label: 'Overview',      icon: LayoutDashboard },
  { suffix: '/participants', label: 'Participants',  icon: Users },
  { suffix: '/data',         label: 'Sensor Data',   icon: Database },
  { suffix: '/esm',          label: 'ESM / EMA',     icon: ClipboardList },
  { suffix: '/config',       label: 'Sensor Config', icon: Settings },
]

const STATUS_DOT: Record<string, string> = {
  active:    'bg-emerald-500',
  draft:     'bg-gray-400',
  paused:    'bg-amber-400',
  completed: 'bg-blue-400',
  archived:  'bg-gray-300',
}

export default function Sidebar() {
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
      .then(({ data }) => {
        const list = (data || []) as Study[]
        setStudies(list)
        if (saved && list.some(s => s.id === saved)) {
          setPinnedStudyId(saved)
        } else {
          localStorage.removeItem('pinnedStudyId')
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

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const studyIdMatch = pathname.match(/^\/studies\/([^/]+)/)
  const activeStudyId = studyIdMatch ? studyIdMatch[1] : null

  useEffect(() => {
    if (activeStudyId) {
      setPinnedStudyId(activeStudyId)
      localStorage.setItem('pinnedStudyId', activeStudyId)
    }
  }, [activeStudyId])

  const effectiveStudyId = activeStudyId ?? pinnedStudyId ?? (studies.length > 0 ? studies[0].id : null)
  const selectedStudy = studies.find(s => s.id === effectiveStudyId)

  function switchStudy(newId: string) {
    setPinnedStudyId(newId)
    localStorage.setItem('pinnedStudyId', newId)
    setDropdownOpen(false)
    if (activeStudyId) {
      const subPath = pathname.replace(`/studies/${activeStudyId}`, '') || ''
      router.push(`/studies/${newId}${subPath}`)
    } else {
      router.push(`/studies/${newId}`)
    }
  }

  const overviewActive = pathname === '/'
  const settingsActive = pathname === '/settings'

  return (
    <aside className="w-60 bg-white flex flex-col min-h-screen border-r border-gray-200 shrink-0">
      {/* Brand */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <FlaskConical size={14} className="text-white" />
          </div>
          <span className="text-sm font-bold text-gray-900 tracking-tight">Research Dashboard</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        {/* Global Overview */}
        <Link
          href="/"
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            overviewActive
              ? 'bg-blue-50 text-blue-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <LayoutDashboard size={15} className={overviewActive ? 'text-blue-600' : 'text-gray-400'} />
          Overview
        </Link>

        {/* Study section */}
        <div className="mt-4">
          <p className="px-3 mb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Study</p>

          {/* Study switcher */}
          <div ref={dropdownRef} className="relative mb-1.5">
            <button
              onClick={() => studies.length > 1 && setDropdownOpen(!dropdownOpen)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                studies.length > 1
                  ? 'bg-gray-50 hover:bg-gray-100 cursor-pointer'
                  : 'bg-gray-50 cursor-default'
              }`}
            >
              {selectedStudy ? (
                <>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[selectedStudy.status] || STATUS_DOT.draft}`} />
                  <span className="flex-1 text-left truncate text-xs text-gray-700 font-semibold">{selectedStudy.name}</span>
                </>
              ) : (
                <>
                  <FlaskConical size={13} className="text-gray-400 shrink-0" />
                  <span className="flex-1 text-left text-xs text-gray-400">No studies</span>
                </>
              )}
              {studies.length > 1 && (
                <ChevronsUpDown size={12} className="text-gray-400 shrink-0" />
              )}
            </button>

            {dropdownOpen && studies.length > 1 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-lg z-50 overflow-hidden">
                {studies.map(s => (
                  <button
                    key={s.id}
                    onClick={() => switchStudy(s.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left hover:bg-gray-50 transition-colors ${
                      effectiveStudyId === s.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[s.status] || STATUS_DOT.draft}`} />
                    <span className="flex-1 truncate font-medium">{s.name}</span>
                    {effectiveStudyId === s.id && <Check size={11} className="text-blue-600 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Study sub-pages */}
          {effectiveStudyId && (
            <div className="space-y-0.5">
              {STUDY_SUB_PAGES.map(sub => {
                const href = `/studies/${effectiveStudyId}${sub.suffix}`
                const active = sub.suffix === ''
                  ? pathname === `/studies/${effectiveStudyId}`
                  : pathname.startsWith(href)
                return (
                  <Link
                    key={sub.suffix || 'overview'}
                    href={href}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      active
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                    }`}
                  >
                    <sub.icon size={13} className={active ? 'text-blue-500' : 'text-gray-400'} />
                    {sub.label}
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Bottom */}
      <div className="px-3 py-3 border-t border-gray-100 space-y-0.5">
        <Link
          href="/settings"
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium w-full transition-all ${
            settingsActive
              ? 'bg-gray-100 text-gray-800'
              : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
          }`}
        >
          <Settings size={15} className={settingsActive ? 'text-gray-600' : 'text-gray-400'} />
          Settings
        </Link>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 w-full transition-all font-medium"
        >
          <LogOut size={15} className="text-gray-400" />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
