'use client'

import { FlaskConical } from 'lucide-react'
import { ThemeToggle } from '@/components/ui'

/** Centred card shared by the sign-in and set-password pages. */
export function AuthCard({ title, description, children, footer }: {
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="relative flex min-h-screen flex-1 items-center justify-center bg-page px-4 py-12">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <main className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-card">
            <FlaskConical size={22} aria-hidden="true" />
          </span>
          <p className="text-xs font-semibold tracking-wide text-subtle">DETECTMiND</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-subtle">{description}</p>}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-7">{children}</div>
        {footer && <div className="mt-4 text-center text-sm text-subtle">{footer}</div>}
      </main>
    </div>
  )
}
