'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import {
  BarChart3, Check, ChevronDown, Database, FlaskConical, LayoutDashboard,
  LogOut, Menu, MessageSquare, Plus, Settings, Users, X,
} from 'lucide-react'

interface Study { id: string; name: string; status: string }

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-gray-400', active: 'bg-emerald-500', paused: 'bg-amber-400', completed: 'bg-blue-500',
}

function navFor(studyId: string | null) {
  if (!studyId) return []
  return [
    { label: 'Overview', href: `/?study=${studyId}`, icon: LayoutDashboard, match: (p: string) => p === '/' },
    { label: 'Participants', href: `/studies/${studyId}/participants`, icon: Users, match: (p: string) => p.includes('/participants') },
    { label: 'Data', href: `/studies/${studyId}/data`, icon: Database, match: (p: string) => p.includes('/data') || p.includes('/processed'), children: [
      { label: 'Raw data', href: `/studies/${studyId}/data` },
      { label: 'Processed', href: `/studies/${studyId}/processed` },
    ] },
    { label: 'Surveys', href: `/studies/${studyId}/esm-responses`, icon: MessageSquare, match: (p: string) => p.includes('/esm'), children: [
      { label: 'Responses', href: `/studies/${studyId}/esm-responses` },
      { label: 'Setup', href: `/studies/${studyId}/esm` },
    ] },
    { label: 'Settings', href: `/studies/${studyId}`, icon: Settings, match: (p: string) => p === `/studies/${studyId}` || p.includes('/config'), children: [
      { label: 'General', href: `/studies/${studyId}` },
      { label: 'Sensors', href: `/studies/${studyId}/config` },
    ] },
  ]
}

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [studies, setStudies] = useState<Study[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [studyOpen, setStudyOpen] = useState(false)
  const switcherRef = useRef<HTMLDivElement>(null)

  const routeStudy = pathname.match(/^\/studies\/([^/]+)/)?.[1]
  const queryStudy = searchParams.get('study')

  useEffect(() => {
    const saved = localStorage.getItem('pinnedStudyId')
    supabase.from('studies').select('id, name, status').order('created_at', { ascending: false })
      .then(({ data }) => {
        const list = (data || []) as Study[]
        setStudies(list)
        const requested = routeStudy && routeStudy !== 'new' ? routeStudy : queryStudy
        const next = [requested, saved, list[0]?.id].find(id => id && list.some(s => s.id === id)) || null
        setSelectedId(next)
        if (next) localStorage.setItem('pinnedStudyId', next)
      })
  }, [queryStudy, routeStudy, supabase])

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) setStudyOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const routeSelectedId = routeStudy && routeStudy !== 'new' ? routeStudy : queryStudy
  const effectiveId = routeSelectedId && studies.some(s => s.id === routeSelectedId) ? routeSelectedId : selectedId
  const selected = studies.find(s => s.id === effectiveId)
  const navigation = navFor(effectiveId)

  function switchStudy(id: string) {
    setSelectedId(id)
    setStudyOpen(false)
    localStorage.setItem('pinnedStudyId', id)
    const current = navigation.find(item => item.match(pathname))
    if (!current || current.label === 'Overview') router.push(`/?study=${id}`)
    else {
      const suffix = pathname.replace(/^\/studies\/[^/]+/, '')
      router.push(`/studies/${id}${suffix}`)
    }
  }

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const sidebar = (
    <aside className="flex h-full w-64 flex-col bg-slate-950 text-slate-200">
      <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
        <Link href="/" className="flex items-center gap-2.5" aria-label="DETECTMiND home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500"><FlaskConical size={16} /></span>
          <span className="text-sm font-bold tracking-wide text-white">DETECTMiND</span>
        </Link>
        <button onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 lg:hidden" aria-label="Close navigation"><X size={18} /></button>
      </div>

      <div className="border-b border-white/10 p-3" ref={switcherRef}>
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Current study</p>
        <button onClick={() => setStudyOpen(v => !v)} aria-expanded={studyOpen} className="flex w-full items-center gap-2 rounded-xl bg-white/8 px-3 py-2.5 text-left hover:bg-white/12">
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[selected?.status || 'draft']}`} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{selected?.name || 'Select a study'}</span>
          <ChevronDown size={14} className={`text-slate-400 transition-transform ${studyOpen ? 'rotate-180' : ''}`} />
        </button>
        {studyOpen && (
          <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-xl">
            <div className="max-h-52 overflow-y-auto p-1.5">
              {studies.map(study => <button key={study.id} onClick={() => switchStudy(study.id)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-white/10">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[study.status] || STATUS_DOT.draft}`} />
                <span className="min-w-0 flex-1 truncate">{study.name}</span>
                {study.id === effectiveId && <Check size={14} className="text-blue-400" />}
              </button>)}
            </div>
            <Link href="/studies/new" className="flex items-center gap-2 border-t border-white/10 px-3 py-2.5 text-xs font-semibold text-blue-300 hover:bg-white/10"><Plus size={14} />New study</Link>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-3" aria-label="Study navigation">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace</p>
        <div className="space-y-1">
          {navigation.map(item => {
            const active = item.match(pathname)
            return <div key={item.label}>
              <Link href={item.href} aria-current={active ? 'page' : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${active ? 'bg-blue-500/15 text-blue-200' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
                <item.icon size={17} /><span>{item.label}</span>
              </Link>
              {active && item.children && <div className="ml-8 mt-1 space-y-0.5 border-l border-white/10 pl-3">
                {item.children.map(child => <Link key={child.href} href={child.href} className={`block rounded-md px-2 py-1.5 text-xs ${pathname === child.href ? 'font-semibold text-white' : 'text-slate-500 hover:text-slate-200'}`}>{child.label}</Link>)}
              </div>}
            </div>
          })}
        </div>
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link href="/studies" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white"><BarChart3 size={17} />All studies</Link>
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white"><LogOut size={17} />Sign out</button>
      </div>
    </aside>
  )

  return <div className="flex min-h-dvh bg-slate-50">
    <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</div>
    {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-slate-950/55" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" /><div className="absolute inset-y-0 left-0">{sidebar}</div></div>}
    <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
        <button onClick={() => setMobileOpen(true)} className="rounded-lg border border-slate-200 p-2 text-slate-600 lg:hidden" aria-label="Open navigation"><Menu size={18} /></button>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900">{selected?.name || 'Research dashboard'}</p><p className="hidden text-xs capitalize text-slate-500 sm:block">{pathname === '/' ? 'Overview' : pathname.split('/').filter(Boolean).at(-1)?.replace('-', ' ')}</p></div>
        <Link href="/studies/new" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"><Plus size={14} /><span className="hidden sm:inline">New study</span></Link>
      </header>
      <main id="main-content" className="min-w-0 flex-1"><div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div></main>
    </div>
  </div>
}
