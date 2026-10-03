'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import {
  LayoutDashboard, FlaskConical, LogOut, Users, Database,
  ClipboardList, Settings, List, MessageSquare, LayoutGrid,
} from 'lucide-react'

interface Study {
  id: string
  name: string
  status: string
}

const STUDY_MAIN_PAGES = [
  { suffix: '',               label: 'Overview',      icon: LayoutDashboard },
  { suffix: '/participants',  label: 'Participants',   icon: Users },
  { suffix: '/data',          label: 'Sensor Data',    icon: Database },
  { suffix: '/processed',     label: 'Processed Data', icon: LayoutGrid },
  { suffix: '/esm-responses', label: 'ESM Responses',  icon: MessageSquare },
]

const STUDY_CONFIG_PAGES = [
  { suffix: '/esm',    label: 'ESM / EMA Config', icon: ClipboardList },
  { suffix: '/config', label: 'Sensor Config',    icon: Settings },
]


export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [studies, setStudies] = useState<Study[]>([])
  const [pinnedStudyId, setPinnedStudyId] = useState<string | null>(null)

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

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

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

  const overviewActive = pathname === '/'
  const studiesActive = pathname === '/studies'

  return (
    <aside className="w-56 bg-white flex flex-col h-screen sticky top-0 border-r border-gray-200 shrink-0">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <FlaskConical size={14} className="text-white" />
          </div>
          <span className="text-sm font-bold text-gray-900 tracking-tight">DETECTMiND</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto min-h-0 space-y-0.5">
        <Link
          href="/"
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            overviewActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          <LayoutDashboard size={15} className={overviewActive ? 'text-blue-600' : 'text-gray-400'} />
          Dashboard
        </Link>

        {effectiveStudyId && STUDY_MAIN_PAGES.map(sub => {
          const href = `/studies/${effectiveStudyId}${sub.suffix}`
          const active = sub.suffix === ''
            ? pathname === `/studies/${effectiveStudyId}`
            : pathname.startsWith(href)
          return (
            <Link
              key={sub.suffix || 'overview'}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <sub.icon size={15} className={active ? 'text-blue-600' : 'text-gray-400'} />
              {sub.label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-3 border-t border-gray-100 space-y-0.5 shrink-0">
        {/* Config pages */}
        {effectiveStudyId && STUDY_CONFIG_PAGES.map(sub => {
          const href = `/studies/${effectiveStudyId}${sub.suffix}`
          const active = pathname.startsWith(href)
          return (
            <Link
              key={sub.suffix}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                active ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
              }`}
            >
              <sub.icon size={15} className={active ? 'text-blue-600' : 'text-gray-400'} />
              {sub.label}
            </Link>
          )
        })}

        <div className="h-px bg-gray-100 my-1" />

        <Link
          href="/studies"
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium w-full transition-all ${
            studiesActive ? 'bg-gray-100 text-gray-800' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
          }`}
        >
          <List size={15} className={studiesActive ? 'text-gray-600' : 'text-gray-400'} />
          All Studies
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
