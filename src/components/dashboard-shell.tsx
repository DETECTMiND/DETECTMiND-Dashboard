'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { MeProvider, type Me } from '@/lib/access'
import { fetchPendingStudyCount, PENDING_STUDIES_CHANGED_EVENT } from '@/lib/pending-studies'
import { ADMIN_NAV, studyNav, type NavItem } from '@/lib/nav'
import { studyStatusInfo } from '@/lib/status'
import { useDialogFocus } from '@/components/ui/modal'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { Logo } from '@/components/ui/logo'
import { Button } from '@/components/ui/button'
import { Check, ChevronsUpDown, LayoutGrid, Loader2, LogOut, Menu, Plus, ShieldAlert, UserRound, X } from 'lucide-react'

interface Study { id: string; name: string; status: string; approved_at: string | null }

type ResearcherCheck =
  | { status: 'ok'; me: Me }
  | { status: 'missing' | 'inactive' | 'error'; email: string | null; message?: string }

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [studies, setStudies] = useState<Study[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  // null = still checking. Row-level security only returns study data to
  // active researchers, so a signed-in user without (or with a deactivated)
  // researchers row would otherwise see an empty dashboard with no explanation.
  const [researcher, setResearcher] = useState<ResearcherCheck | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { if (!cancelled) setResearcher({ status: 'missing', email: null }); return }
      const { data, error } = await supabase.from('researchers')
        .select('role, active, email, display_name').eq('user_id', user.id).maybeSingle()
      if (cancelled) return
      const email = user.email ?? null
      if (error) setResearcher({ status: 'error', email, message: error.message })
      else if (!data) setResearcher({ status: 'missing', email })
      else if (!data.active) setResearcher({ status: 'inactive', email })
      else setResearcher({
        status: 'ok',
        me: { userId: user.id, email: email ?? data.email, displayName: data.display_name, role: data.role },
      })
    })
    return () => { cancelled = true }
  }, [supabase])
  const isAdmin = researcher?.status === 'ok' && researcher.me.role === 'admin'
  const [pendingCount, setPendingCount] = useState(0)

  // Pending-approval badge for admins; refreshed on navigation and whenever a page reports a change.
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    const refresh = () => { fetchPendingStudyCount(supabase).then(n => { if (!cancelled) setPendingCount(n) }) }
    refresh()
    window.addEventListener(PENDING_STUDIES_CHANGED_EVENT, refresh)
    return () => { cancelled = true; window.removeEventListener(PENDING_STUDIES_CHANGED_EVENT, refresh) }
  }, [isAdmin, supabase, pathname])

  const routeStudy = pathname.match(/^\/studies\/([^/]+)/)?.[1]
  const queryStudy = searchParams.get('study')

  useEffect(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem('pinnedStudyId') } catch { /* private mode */ }
    const load = () => supabase.from('studies').select('id, name, status, approved_at').order('created_at', { ascending: false })
      .then(({ data }) => {
        const list = (data || []) as Study[]
        setStudies(list)
        const requested = routeStudy && routeStudy !== 'new' ? routeStudy : queryStudy
        const next = [requested, saved, list[0]?.id].find(id => id && list.some(s => s.id === id)) || null
        setSelectedId(next)
        try { if (next) localStorage.setItem('pinnedStudyId', next) } catch { /* ignore */ }
      })
    load()
    // Study names and statuses change on approval / edit / delete
    window.addEventListener(PENDING_STUDIES_CHANGED_EVENT, load)
    return () => window.removeEventListener(PENDING_STUDIES_CHANGED_EVENT, load)
  }, [queryStudy, routeStudy, supabase])

  // The drawer closes when a link inside it navigates
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileOpen(false)
  }, [pathname, queryStudy])

  const routeSelectedId = routeStudy && routeStudy !== 'new' ? routeStudy : queryStudy
  const list = studies ?? []
  const effectiveId = routeSelectedId && list.some(s => s.id === routeSelectedId) ? routeSelectedId : selectedId
  const selected = list.find(s => s.id === effectiveId)
  const adminNav = ADMIN_NAV.map(item => item.href === '/admin/approvals' ? { ...item, badge: pendingCount } : item)
  const navigation: NavItem[] = [...studyNav(effectiveId), ...(isAdmin ? adminNav : [])]
  const activeNavigation = navigation.find(item => item.match(pathname))

  const section = pathname === '/studies' ? 'All studies'
    : pathname === '/studies/new' ? 'New study'
    : pathname === '/settings/account' ? 'Account'
    : activeNavigation?.label || 'Dashboard'
  const pageTitle = `${section}${selected && activeNavigation?.group === 'Study' ? ` · ${selected.name}` : ''} | DETECTMiND`

  function switchStudy(id: string) {
    setSelectedId(id)
    try { localStorage.setItem('pinnedStudyId', id) } catch { /* ignore */ }
    const current = navigation.find(item => item.match(pathname))
    if (!current || current.label === 'Overview' || current.group === 'Admin' || !pathname.startsWith('/studies/')) router.push(`/?study=${id}`)
    else router.push(`/studies/${id}${pathname.replace(/^\/studies\/[^/]+/, '')}`)
  }

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  if (!researcher) {
    return <div role="status" className="flex min-h-dvh items-center justify-center bg-page text-sm text-subtle">
      <Loader2 size={18} className="mr-2 animate-spin" aria-hidden="true" /> Checking your access…
    </div>
  }

  if (researcher.status !== 'ok') {
    const who = researcher.email
      ? <>You are signed in as <span className="font-medium text-fg">{researcher.email}</span>, but </>
      : 'This account is signed in, but '
    return <div className="flex min-h-dvh items-center justify-center bg-page px-4">
      <title>Not authorised | DETECTMiND</title>
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-7 text-center">
        <span className="mx-auto mb-3 flex justify-center text-danger"><ShieldAlert size={22} /></span>
        <h1 className="text-lg font-bold text-fg">
          {researcher.status === 'inactive' ? 'Your researcher account has been deactivated'
            : researcher.status === 'error' ? 'Could not check your access'
            : 'Your account is not authorised as a researcher'}
        </h1>
        <p className="mt-2 text-sm text-subtle">
          {researcher.status === 'error'
            ? <>Please try again in a moment. ({researcher.message})</>
            : researcher.status === 'inactive'
              ? <>{who}an administrator has deactivated this account, so no study data is visible. Contact them if you need access again.</>
              : <>{who}it has not been given researcher access, so no study data is visible. Ask an administrator to invite you.</>}
        </p>
        <Button onClick={logout} className="mt-6"><LogOut size={16} />Sign out</Button>
      </div>
    </div>
  }

  const me = researcher.me

  return <div className="flex min-h-dvh bg-page">
    <title>{pageTitle}</title>
    <a href="#main-content" className="sr-only z-[80] rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
    <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
      <Sidebar navigation={navigation} pathname={pathname} me={me} isAdmin={isAdmin} studies={studies} selected={selected} onSwitch={switchStudy} onLogout={logout} />
    </div>
    {mobileOpen && <MobileDrawer onClose={() => setMobileOpen(false)}>
      <Sidebar navigation={navigation} pathname={pathname} me={me} isAdmin={isAdmin} studies={studies} selected={selected} onSwitch={switchStudy} onLogout={logout} onClose={() => setMobileOpen(false)} />
    </MobileDrawer>}
    <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
        <Button variant="secondary" iconOnly size="sm" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={16} /></Button>
        <Link href="/" className="flex min-w-0 items-center gap-2 font-semibold text-fg">
          <Logo size={28} />
          <span className="truncate text-sm">{selected?.name ?? 'DETECTMiND'}</span>
        </Link>
      </header>
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8"><MeProvider me={me}>{children}</MeProvider></div>
      </main>
    </div>
  </div>
}

function Sidebar({ navigation, pathname, me, isAdmin, studies, selected, onSwitch, onLogout, onClose }: {
  navigation: NavItem[]
  pathname: string
  me: Me
  isAdmin: boolean
  studies: Study[] | null
  selected: Study | undefined
  onSwitch: (id: string) => void
  onLogout: () => void
  onClose?: () => void
}) {
  const groups = (['Study', 'Admin'] as const).map(g => ({ group: g, items: navigation.filter(n => n.group === g) })).filter(g => g.items.length)
  const footerLink = (href: string, label: string, icon: React.ReactNode, extra?: React.ReactNode) => {
    const active = pathname === href
    return <Link href={href} aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${active ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-sunken hover:text-fg'}`}>
      {icon}<span className="min-w-0 flex-1 truncate">{label}</span>{extra}
    </Link>
  }
  return (
    <aside className="flex h-full w-64 flex-col border-r border-line bg-surface">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5" aria-label="DETECTMiND home">
          <Logo size={30} />
          <span className="text-sm font-bold tracking-wide text-fg">DETECTMiND</span>
        </Link>
        {onClose && <Button variant="ghost" iconOnly size="sm" onClick={onClose} aria-label="Close menu"><X size={16} /></Button>}
      </div>

      <div className="px-3 pb-2">
        <StudySwitcher studies={studies} selected={selected} onSwitch={onSwitch} />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Main">
        {groups.map(({ group, items }, gi) => (
          <div key={group} className={gi > 0 ? 'mt-6' : ''}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-subtle">{group === 'Study' ? 'Study' : 'Admin'}</p>
            <ul className="space-y-0.5">
              {items.map(item => {
                const active = item.match(pathname)
                return <li key={item.href}>
                  <Link href={item.href} aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken hover:text-fg'}`}>
                    <item.icon size={17} aria-hidden="true" /><span className="min-w-0 flex-1">{item.label}</span>
                    {!!item.badge && <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white" aria-label={`${item.badge} pending`}>{item.badge}</span>}
                  </Link>
                </li>
              })}
            </ul>
          </div>
        ))}
        {studies !== null && studies.length === 0 && (
          <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-subtle">
            No studies yet.
            <Link href="/studies/new" className="mt-2 flex items-center justify-center gap-1 font-medium text-accent hover:underline"><Plus size={13} />Create a study</Link>
          </div>
        )}
      </nav>

      <div className="space-y-0.5 border-t border-line p-3">
        {footerLink('/studies', 'All studies', <LayoutGrid size={17} aria-hidden="true" />)}
        {footerLink('/settings/account', me.displayName || me.email || 'Account', <UserRound size={17} aria-hidden="true" />,
          isAdmin ? <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Admin</span> : undefined)}
        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={onLogout}><LogOut size={15} aria-hidden="true" />Sign out</Button>
        </div>
      </div>
    </aside>
  )
}

/** Study picker at the top of the sidebar: a listbox with arrow keys, Enter and Escape. */
function StudySwitcher({ studies, selected, onSwitch }: { studies: Study[] | null; selected: Study | undefined; onSwitch: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [focusIndex, setFocusIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const list = studies ?? []

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  useEffect(() => { if (open) optionRefs.current[focusIndex]?.focus() }, [open, focusIndex])

  function openList() {
    const i = Math.max(0, list.findIndex(s => s.id === selected?.id))
    setFocusIndex(i)
    setOpen(true)
  }
  function onListKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); buttonRef.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIndex(i => Math.min(list.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIndex(i => Math.max(0, i - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setFocusIndex(0) }
    else if (e.key === 'End') { e.preventDefault(); setFocusIndex(list.length - 1) }
    else if (e.key === 'Tab') setOpen(false)
  }

  if (studies === null) return <div className="h-12 animate-pulse rounded-lg bg-sunken" />
  if (list.length === 0) return null
  const info = selected ? studyStatusInfo(selected) : null
  return (
    <div className="relative" ref={rootRef}>
      <button ref={buttonRef} type="button" onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); openList() } }}
        aria-haspopup="listbox" aria-expanded={open} aria-label={`Study: ${selected?.name ?? 'none selected'}. Change study`}
        className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-left hover:bg-sunken">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg">{selected?.name ?? 'Select a study'}</span>
          {info && <span className="flex items-center gap-1.5 text-xs text-subtle"><span className={`h-1.5 w-1.5 rounded-full ${info.dot}`} aria-hidden="true" />{info.label}</span>}
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-subtle" aria-hidden="true" />
      </button>
      {open && (
        <div role="listbox" aria-label="Studies" onKeyDown={onListKey}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-xl">
          {list.map((study, i) => {
            const s = studyStatusInfo(study)
            const current = study.id === selected?.id
            return (
              <button key={study.id} ref={el => { optionRefs.current[i] = el }} type="button" role="option" aria-selected={current}
                tabIndex={i === focusIndex ? 0 : -1}
                onClick={() => { setOpen(false); onSwitch(study.id) }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-fg hover:bg-sunken focus:bg-sunken focus:outline-none">
                <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} title={s.label} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{study.name}</span>
                {current && <Check size={14} className="text-accent" aria-hidden="true" />}
              </button>
            )
          })}
          <Link href="/studies/new" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 border-t border-line px-2.5 pb-1 pt-2 text-sm font-medium text-accent hover:underline">
            <Plus size={14} aria-hidden="true" />New study
          </Link>
        </div>
      )}
    </div>
  )
}

function MobileDrawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, onClose)
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Menu" className="absolute inset-y-0 left-0 shadow-2xl">{children}</div>
    </div>
  )
}
