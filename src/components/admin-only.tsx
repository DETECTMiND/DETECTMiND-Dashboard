'use client'

import { ShieldAlert } from 'lucide-react'
import { useMe } from '@/lib/access'

/** Renders children only for admins; everyone else gets a short explanation. */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const me = useMe()
  if (me?.role === 'admin') return <>{children}</>
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><ShieldAlert size={22} /></span>
      <h1 className="text-lg font-bold text-slate-900">Admins only</h1>
      <p className="mt-2 text-sm text-slate-500">Only admins can open this page. Ask an admin if you need something changed here.</p>
    </div>
  )
}
