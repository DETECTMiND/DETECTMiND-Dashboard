'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function WorkspaceTabs({ items, label }: { items: { label: string; href: string }[]; label: string }) {
  const pathname = usePathname()
  return <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b border-slate-200">
    {items.map(item => {
      const active = pathname === item.href
      return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}>{item.label}</Link>
    })}
  </nav>
}
