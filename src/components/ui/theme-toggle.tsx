'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemeChoice } from '@/lib/theme'

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/** Light / Dark / System switch (radio group with icons). */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { choice, setChoice } = useTheme()
  return (
    <div role="radiogroup" aria-label="Theme" className={`inline-flex rounded-lg border border-line bg-sunken p-0.5 ${className}`}>
      {OPTIONS.map(opt => {
        const on = choice === opt.value
        const Icon = opt.icon
        return (
          <button key={opt.value} type="button" role="radio" aria-checked={on} aria-label={opt.label} title={opt.label}
            onClick={() => setChoice(opt.value)}
            className={`inline-flex h-7 w-8 items-center justify-center rounded-md transition-colors ${on ? 'bg-surface text-fg shadow-card' : 'text-subtle hover:text-fg'}`}>
            <Icon size={14} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
