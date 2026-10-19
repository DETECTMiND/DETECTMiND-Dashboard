'use client'

import { useId } from 'react'
import { Bell, Clock, Plus, Shuffle, X } from 'lucide-react'
import { Button, Field, Input, TextField } from '@/components/ui'
import { ChoiceCards } from './choice-cards'
import { NumberInput } from './number-input'

// Survey schedule form shared by Surveys → Setup and the new-study wizard.

export type KnownScheduleType = 'fixed' | 'random'

export interface Schedule {
  id: string
  name: string
  description: string | null
  schedule_type: string
  times_of_day: string[] | null
  random_count: number | null
  random_window_start: string | null
  random_window_end: string | null
  expiry_minutes: number
  notification_title: string
  notification_body: string
  enabled: boolean
}

export interface ScheduleForm {
  name: string
  description: string
  schedule_type: KnownScheduleType
  times_of_day: string[]
  random_count: number
  random_window_start: string
  random_window_end: string
  expiry_minutes: number
  notification_title: string
  notification_body: string
}

export const SCHEDULE_TYPES: { key: KnownScheduleType; label: string; description: string; icon: typeof Clock }[] = [
  { key: 'fixed', label: 'Fixed times', description: 'The same times every day.', icon: Clock },
  { key: 'random', label: 'Random times', description: 'A set number of times at random within a daily window.', icon: Shuffle },
]

/** Label for any schedule type, including old ones the app no longer runs. */
export function scheduleTypeInfo(type: string): { label: string; known: boolean } {
  const t = SCHEDULE_TYPES.find(x => x.key === type)
  if (t) return { label: t.label, known: true }
  return { label: `Unsupported (${type.replace(/_/g, ' ')})`, known: false }
}

export const BLANK_SCHEDULE_FORM: ScheduleForm = {
  name: '', description: '', schedule_type: 'fixed',
  times_of_day: ['09:00', '12:00', '18:00'],
  random_count: 5, random_window_start: '08:00', random_window_end: '22:00',
  expiry_minutes: 60,
  notification_title: 'Survey available',
  notification_body: 'Please take a moment to complete a short survey.',
}

/** Only for schedules of a known type; unknown types are shown read-only instead. */
export function scheduleToForm(s: Schedule): ScheduleForm {
  return {
    name: s.name,
    description: s.description || '',
    schedule_type: s.schedule_type === 'random' ? 'random' : 'fixed',
    times_of_day: s.times_of_day?.length ? s.times_of_day : ['09:00'],
    random_count: s.random_count ?? 5,
    random_window_start: s.random_window_start ?? '08:00',
    random_window_end: s.random_window_end ?? '22:00',
    expiry_minutes: s.expiry_minutes ?? 60,
    notification_title: s.notification_title ?? '',
    notification_body: s.notification_body ?? '',
  }
}

export function timingSummary(s: Pick<Schedule, 'schedule_type' | 'times_of_day' | 'random_count' | 'random_window_start' | 'random_window_end'>) {
  if (s.schedule_type === 'fixed') return (s.times_of_day || []).join(', ') || 'No times set'
  if (s.schedule_type === 'random') return `${s.random_count ?? 0}× a day between ${s.random_window_start ?? '?'} and ${s.random_window_end ?? '?'}`
  return 'Not run by the app'
}

export function buildSchedulePayload(f: ScheduleForm) {
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    schedule_type: f.schedule_type,
    times_of_day: f.schedule_type === 'fixed' ? [...new Set(f.times_of_day.filter(Boolean))].sort() : null,
    random_count: f.schedule_type === 'random' ? f.random_count : null,
    random_window_start: f.schedule_type === 'random' ? f.random_window_start : null,
    random_window_end: f.schedule_type === 'random' ? f.random_window_end : null,
    expiry_minutes: f.expiry_minutes,
    notification_title: f.notification_title.trim(),
    notification_body: f.notification_body.trim(),
  }
}

export type ScheduleErrors = Partial<Record<'name' | 'times' | 'window' | 'notification_title', string>>

export function validateSchedule(f: ScheduleForm): ScheduleErrors {
  const errors: ScheduleErrors = {}
  if (!f.name.trim()) errors.name = 'Enter a name.'
  if (f.schedule_type === 'fixed' && f.times_of_day.filter(Boolean).length === 0) errors.times = 'Add at least one time.'
  if (f.schedule_type === 'random' && (!f.random_window_start || !f.random_window_end || f.random_window_start >= f.random_window_end)) {
    errors.window = 'The window must end after it starts.'
  }
  if (!f.notification_title.trim()) errors.notification_title = 'Enter a notification title.'
  return errors
}

function TimeList({ times, onChange, error }: { times: string[]; onChange: (t: string[]) => void; error?: string }) {
  const id = useId()
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-fg">Times of day</legend>
      <ul className="space-y-2">
        {times.map((t, i) => (
          <li key={i} className="flex items-center gap-2">
            <label htmlFor={`${id}-${i}`} className="sr-only">Time {i + 1}</label>
            <Input id={`${id}-${i}`} type="time" value={t} className="w-36"
              onChange={e => { const next = [...times]; next[i] = e.target.value; onChange(next) }} />
            {times.length > 1 && (
              <Button variant="ghost" size="sm" iconOnly aria-label={`Remove time ${t || i + 1}`}
                onClick={() => onChange(times.filter((_, idx) => idx !== i))}>
                <X size={14} aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => onChange([...times, '12:00'])}>
        <Plus size={14} aria-hidden="true" /> Add time
      </Button>
      {error && <p role="alert" className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </fieldset>
  )
}

export function ScheduleFormBody({ form, setForm, errors = {} }: {
  form: ScheduleForm; setForm: (f: ScheduleForm) => void; errors?: ScheduleErrors
}) {
  const set = (patch: Partial<ScheduleForm>) => setForm({ ...form, ...patch })
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Name" required value={form.name} error={errors.name}
          onChange={e => set({ name: e.target.value })} placeholder="e.g. Morning check-in" />
        <TextField label="Note for your team" value={form.description}
          onChange={e => set({ description: e.target.value })} placeholder="Optional" hint="Not shown to participants." />
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-fg" aria-hidden="true">When to ask</p>
        <ChoiceCards label="When to ask" value={form.schedule_type} onChange={v => set({ schedule_type: v })}
          options={SCHEDULE_TYPES.map(t => ({ value: t.key, label: t.label, description: t.description, icon: <t.icon size={16} /> }))} />
      </div>

      {form.schedule_type === 'fixed' && (
        <TimeList times={form.times_of_day} onChange={t => set({ times_of_day: t })} error={errors.times} />
      )}

      {form.schedule_type === 'random' && (
        <div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Times a day">
              {(id, d) => <NumberInput id={id} describedBy={d} min={1} max={20} className="w-full" value={form.random_count} onChange={random_count => set({ random_count })} />}
            </Field>
            <Field label="Window starts">
              {(id, d) => <Input id={id} aria-describedby={d} type="time" value={form.random_window_start} onChange={e => set({ random_window_start: e.target.value })} />}
            </Field>
            <Field label="Window ends">
              {(id, d) => <Input id={id} aria-describedby={d} type="time" value={form.random_window_end} aria-invalid={errors.window ? true : undefined} onChange={e => set({ random_window_end: e.target.value })} />}
            </Field>
          </div>
          {errors.window && <p role="alert" className="mt-1.5 text-xs font-medium text-danger">{errors.window}</p>}
          <p className="mt-1.5 text-xs text-subtle">New random times are picked every day.</p>
        </div>
      )}

      <Field label="Expires after" hint="Minutes. Unanswered surveys are recorded as expired after this.">
        {(id, d) => (
          <div className="flex items-center gap-2">
            <NumberInput id={id} describedBy={d} min={1} max={1440} value={form.expiry_minutes} onChange={expiry_minutes => set({ expiry_minutes })} />
            <span className="text-sm text-subtle">min</span>
          </div>
        )}
      </Field>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="flex items-center gap-1.5 px-1 text-sm font-medium text-fg">
          <Bell size={14} aria-hidden="true" /> Notification on the phone
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Title" required value={form.notification_title} error={errors.notification_title}
            onChange={e => set({ notification_title: e.target.value })} />
          <TextField label="Message" value={form.notification_body} onChange={e => set({ notification_body: e.target.value })} />
        </div>
        <NotificationPreview title={form.notification_title} body={form.notification_body} className="mt-4" />
      </fieldset>
    </div>
  )
}

export function NotificationPreview({ title, body, className = '' }: { title: string; body: string; className?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border border-line bg-sunken px-3.5 py-3 ${className}`} aria-label="Notification preview">
      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"><Bell size={14} /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-fg">{title || 'No title'}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted">{body || 'No message'}</p>
      </div>
      <span className="shrink-0 text-[10px] text-subtle">Preview</span>
    </div>
  )
}
