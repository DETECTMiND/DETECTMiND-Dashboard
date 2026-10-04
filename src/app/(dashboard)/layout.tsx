import { Suspense } from 'react'
import DashboardShell from '@/components/dashboard-shell'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-slate-50" />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  )
}
