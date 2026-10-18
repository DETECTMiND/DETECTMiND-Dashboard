'use client'

import { useId } from 'react'

/**
 * Accessible on/off switch (role="switch"). Always labelled: pass `label`, or
 * `aria-label` when the label is shown elsewhere.
 */
export function Toggle({ checked, onChange, label, description, disabled, size = 'md', className = '', ...aria }: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}) {
  const id = useId()
  const descId = `${id}-desc`
  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'
  const knob = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  const shift = size === 'sm' ? 'translate-x-4' : 'translate-x-5'
  const button = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : aria['aria-label']}
      aria-labelledby={label ? `${id}-label` : undefined}
      aria-describedby={description ? descId : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex ${track} shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-raised'}`}
    >
      <span className={`${knob} rounded-full bg-white shadow transition-transform ${checked ? shift : 'translate-x-0'}`} />
    </button>
  )
  if (!label) return <span className={className}>{button}</span>
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <span id={`${id}-label`} className="text-sm font-medium text-fg" onClick={() => !disabled && onChange(!checked)}>{label}</span>
        {description && <p id={descId} className="mt-0.5 text-xs text-subtle">{description}</p>}
      </div>
      {button}
    </div>
  )
}
