'use client'

import { useId, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, Input, useConfirm } from '@/components/ui'

const PACKAGE_RE = /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/

/**
 * Editable list of Android package names shown as chips. Removing an app asks
 * for confirmation; adding validates the package name format.
 */
export function AppListEditor({ apps, onChange, label, hint, disabled, placeholder = 'com.example.app', confirmRemoveBody }: {
  apps: string[]
  onChange: (next: string[]) => void
  label: string
  hint?: React.ReactNode
  disabled?: boolean
  placeholder?: string
  confirmRemoveBody?: (app: string) => React.ReactNode
}) {
  const inputId = useId()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { ask, dialog } = useConfirm()

  function add() {
    const value = draft.trim()
    if (!value) return
    if (!PACKAGE_RE.test(value)) { setError('Enter a package name such as com.example.app.'); return }
    if (apps.includes(value)) { setError('That app is already in the list.'); return }
    onChange([...apps, value])
    setDraft('')
    setError(null)
  }

  function remove(app: string) {
    ask({
      title: `Remove ${app}?`,
      body: confirmRemoveBody?.(app) ?? <p>It is removed from the list when you save your changes.</p>,
      confirmLabel: 'Remove app',
      tone: 'danger',
      run: async () => { onChange(apps.filter(a => a !== app)) },
    })
  }

  return (
    <div>
      {dialog}
      <p className="mb-1.5 text-sm font-medium text-fg">{label}</p>
      {apps.length === 0
        ? <p className="mb-2 text-sm text-subtle">No apps in the list.</p>
        : (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={label}>
            {apps.map(app => (
              <li key={app} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-sunken py-0.5 pl-2.5 pr-1 font-mono text-xs text-fg">
                <span className="truncate">{app}</span>
                {!disabled && (
                  <button type="button" onClick={() => remove(app)} aria-label={`Remove ${app}`}
                    className="rounded-full p-1 text-subtle hover:bg-danger-soft hover:text-danger">
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      {!disabled && (
        <>
          <label htmlFor={inputId} className="sr-only">Add an app to {label.toLowerCase()}</label>
          <div className="flex gap-2">
            <Input id={inputId} value={draft} placeholder={placeholder} spellCheck={false} autoCapitalize="off"
              aria-invalid={error ? true : undefined} aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
              onChange={e => { setDraft(e.target.value); setError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
              className="min-w-0 flex-1 font-mono text-xs" />
            <Button variant="secondary" onClick={add} disabled={!draft.trim()}><Plus size={14} aria-hidden="true" /> Add</Button>
          </div>
          {error
            ? <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-xs font-medium text-danger">{error}</p>
            : hint && <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-subtle">{hint}</p>}
        </>
      )}
    </div>
  )
}
