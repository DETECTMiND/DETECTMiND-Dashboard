'use client'

import { Eye, EyeOff, Lock } from 'lucide-react'
import { useState } from 'react'
import { inputClass } from '@/components/ui/field'

export const MIN_PASSWORD_LENGTH = 10

/** Returns a problem with the new password, or null when it is acceptable. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (password !== confirm) return 'The two passwords do not match.'
  return null
}

export function PasswordInput({ id, label, value, onChange, autoComplete, hint }: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: 'current-password' | 'new-password'
  hint?: string
}) {
  const [show, setShow] = useState(false)
  const hintId = `${id}-hint`
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg">{label}</label>
      <div className="relative">
        <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={e => onChange(e.target.value)}
          aria-describedby={hint ? hintId : undefined}
          required
          className={`${inputClass} pl-9 pr-10`}
        />
        <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-subtle hover:bg-sunken hover:text-fg">
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {hint && <p id={hintId} className="mt-1.5 text-xs text-subtle">{hint}</p>}
    </div>
  )
}
