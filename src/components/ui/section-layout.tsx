'use client'

import { useParams } from 'next/navigation'
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
  const copy = COPY[section]
  return (
    <>
      <PageHeader title={copy.title}
        tabs={<TabNav label={`${copy.title} sections`} tabs={sectionTabs(id)[section]} />} />
      {children}
    </>
  )
}
