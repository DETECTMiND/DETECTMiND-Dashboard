import { SectionLayout } from '@/components/ui/section-layout'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionLayout section="data">{children}</SectionLayout>
}
