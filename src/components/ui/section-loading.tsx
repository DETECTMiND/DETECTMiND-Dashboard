import { Skeleton } from '@/components/feedback'

/** Content placeholder under a section's header and tabs, which stay on screen. */
export function SectionLoading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <span className="sr-only">Loading…</span>
    </div>
  )
}
