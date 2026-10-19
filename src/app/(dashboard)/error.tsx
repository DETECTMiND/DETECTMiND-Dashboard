'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'
import { ErrorState } from '@/components/feedback'

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="py-6">
      <ErrorState
        title="This page could not be shown"
        message={error.digest
          ? `Something went wrong while loading it. If this keeps happening, contact an admin and mention reference ${error.digest}.`
          : 'Something went wrong while loading it. Try again, and contact an admin if this keeps happening.'}
        onRetry={() => unstable_retry()}
      />
    </div>
  )
}
