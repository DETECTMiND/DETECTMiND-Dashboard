'use client'

import { useParams } from 'next/navigation'
import { useStudyAccess } from '@/lib/access'
import { sectionTabs } from '@/lib/nav'
import { PageHeader } from './page-header'
import { TabNav } from './tabs'

const COPY = {
  data: { title: 'Data' },
  surveys: { title: 'Surveys' },
  settings: { title: 'Settings' },
} as const

/** Shared header + tabs for the Data, Surveys and Settings sections. Tab pages render below it. */
export function SectionLayout({ section, children }: { section: keyof typeof COPY; children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>()
  const access = useStudyAccess(id)
  const copy = COPY[section]
  // The Team tab is only for people who manage the team (owners and admins)
  const tabs = sectionTabs(id)[section].filter(t => !t.href.endsWith('/settings/team') || access.canManage)
  return (
    <>
      <PageHeader title={copy.title}
        tabs={<TabNav label={`${copy.title} sections`} tabs={tabs} />} />
      {children}
    </>
  )
}
