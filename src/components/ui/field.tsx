'use client'

import { forwardRef, useId } from 'react'

const CONTROL = 'w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-subtle aria-[invalid=true]:border-danger'

export const inputClass = `${CONTROL} h-9`

/** A width class passed in (w-28, w-40…) replaces the default full width. */
function withWidth(base: string, className: string) {
  return /(^|\s)w-/.test(className) ? base.replace('w-full ', '') : base
}

/**
 * Label + control + hint/error. Pass a render function to get the generated id:
 * <Field label="Name">{id => <Input id={id} … />}</Field>
 */
export function Field({ label, hint, error, required, children, className = '', labelAction }: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: string | null
  required?: boolean
  children: (id: string, describedBy: string | undefined) => React.ReactNode
  className?: string
  /** Small element shown on the right of the label (e.g. a help link) */
  labelAction?: React.ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-fg">
          {label}{required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
        </label>
        {labelAction}
      </div>
      {children(id, describedBy)}
      {hint && !error && <p id={hintId} className="mt-1.5 text-xs text-subtle">{hint}</p>}
      {error && <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = '', ...rest }, ref,
) {
  return <input ref={ref} className={`${withWidth(inputClass, className)} ${className}`} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = '', children, ...rest }, ref,
) {
  return <select ref={ref} className={`${withWidth(inputClass, className)} ${className}`} {...rest}>{children}</select>
})

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className = '', rows = 3, ...rest }, ref,
) {
  return <textarea ref={ref} rows={rows} className={`${withWidth(CONTROL, className)} py-2 ${className}`} {...rest} />
})

/** Convenience: a labelled text input. */
export function TextField({ label, hint, error, required, className, ...input }: {
  label: React.ReactNode; hint?: React.ReactNode; error?: string | null; required?: boolean; className?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(id, describedBy) => <Input id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} required={required} {...input} />}
    </Field>
  )
}
