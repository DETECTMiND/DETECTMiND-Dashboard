'use client'

import { ShieldAlert } from 'lucide-react'
import { useMe } from '@/lib/access'

/** Renders children only for admins; everyone else gets a short explanation. */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const me = useMe()
  if (me?.role === 'admin') return <>{children}</>
  return (
    <div className="mx-auto mt-6 max-w-md rounded-2xl border border-line bg-surface p-7 text-center shadow-card">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sunken text-subtle"><ShieldAlert size={22} aria-hidden="true" /></span>
      <h1 className="text-lg font-bold text-fg">Admins only</h1>
      <p className="mt-2 text-sm text-subtle">Only admins can open this page. Ask an admin if you need something changed here.</p>
    </div>
  )
}
