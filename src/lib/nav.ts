import {
  ClipboardCheck, Database, Inbox, LayoutDashboard, MessageSquare, ScrollText, Settings, UserCog, Users,
  type LucideIcon,
} from 'lucide-react'

// Menu labels and addresses, defined once for the sidebar, the section tabs
// and page titles.

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  group: 'Study' | 'Admin'
  /** Highlights the item for this path (and its sub-pages). */
  match: (pathname: string) => boolean
  badge?: number
}

export const studyPaths = (id: string) => ({
  overview: `/?study=${id}`,
  participants: `/studies/${id}/participants`,
  data: `/studies/${id}/data`,
  processed: `/studies/${id}/data/processed`,
  surveys: `/studies/${id}/surveys`,
  surveySetup: `/studies/${id}/surveys/setup`,
  settings: `/studies/${id}/settings`,
  sensors: `/studies/${id}/settings/sensors`,
  team: `/studies/${id}/settings/team`,
})

const under = (base: string) => (p: string) => p === base || p.startsWith(base + '/')

export function studyNav(id: string | null): NavItem[] {
  if (!id) return []
  const p = studyPaths(id)
  return [
    { label: 'Overview', href: p.overview, icon: LayoutDashboard, group: 'Study', match: path => path === '/' },
    { label: 'Participants', href: p.participants, icon: Users, group: 'Study', match: under(p.participants) },
    { label: 'Data', href: p.data, icon: Database, group: 'Study', match: under(p.data) },
    { label: 'Surveys', href: p.surveys, icon: MessageSquare, group: 'Study', match: under(p.surveys) },
    { label: 'Settings', href: p.settings, icon: Settings, group: 'Study', match: under(p.settings) },
  ]
}

export const ADMIN_NAV: NavItem[] = [
  { label: 'Approvals', href: '/admin/approvals', icon: Inbox, group: 'Admin', match: under('/admin/approvals') },
  { label: 'Studies', href: '/admin/studies', icon: ClipboardCheck, group: 'Admin', match: under('/admin/studies') },
  { label: 'People', href: '/admin/people', icon: UserCog, group: 'Admin', match: under('/admin/people') },
  { label: 'Activity log', href: '/admin/activity', icon: ScrollText, group: 'Admin', match: under('/admin/activity') },
]

/** Tabs inside the Data, Surveys and Settings sections. */
export function sectionTabs(id: string) {
  const p = studyPaths(id)
  return {
    data: [
      { label: 'Raw data', href: p.data },
      { label: 'Processed', href: p.processed },
    ],
    surveys: [
      { label: 'Responses', href: p.surveys },
      { label: 'Setup', href: p.surveySetup },
    ],
    settings: [
      { label: 'General', href: p.settings },
      { label: 'Sensors', href: p.sensors },
      { label: 'Team', href: p.team },
    ],
  }
}
