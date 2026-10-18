'use client'

import { useState } from 'react'
import { Input } from '@/components/ui'

/**
 * Whole-number input that commits every valid keystroke (no "save on blur"),
 * while still letting the field be cleared and retyped. Out-of-range or empty
 * text is not committed; on blur the field shows the last committed value.
 */
export function NumberInput({ value, onChange, min, max, id, disabled, describedBy, className = 'w-28', invalid, ...rest }: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  id?: string
  disabled?: boolean
  describedBy?: string
  className?: string
  invalid?: boolean
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'type'>) {
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)
  // Follow outside changes (discard, reset) without an effect.
  if (value !== shown) {
    setShown(value)
    setText(String(value))
  }

  function accept(raw: string) {
    setText(raw)
    if (raw.trim() === '') return
    const n = Number(raw)
    if (!Number.isInteger(n)) return
    if (min !== undefined && n < min) return
    if (max !== undefined && n > max) return
    setShown(n)
    onChange(n)
  }

  return (
    <Input id={id} type="number" inputMode="numeric" step={1} min={min} max={max} value={text} disabled={disabled}
      aria-describedby={describedBy} aria-invalid={invalid ? true : undefined}
      onChange={e => accept(e.target.value)}
      onBlur={() => setText(String(shown))}
      className={className} {...rest} />
  )
}
