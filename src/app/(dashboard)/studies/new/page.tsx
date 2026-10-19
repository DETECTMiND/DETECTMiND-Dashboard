'use client'

import { createClient } from '@/lib/supabase-browser'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, ClipboardList, Info, MinusCircle } from 'lucide-react'
import { useMe } from '@/lib/access'
import { studyPaths } from '@/lib/nav'
import { DEFAULT_BANKING_APPS, SENSORS } from '@/lib/sensors'
import { notifyPendingStudiesChanged } from '@/lib/pending-studies'
import {
  Badge, Button, ButtonLink, Card, CardHeader, DescriptionList, Field, Input, Notice, PageHeader, Select, TextField,
  Textarea, Toggle, errorText, useUnsavedChangesGuard,
} from '@/components/ui'
import { ChoiceCards } from '@/components/study/choice-cards'
import { SensorSettingsEditor, defaultSensorDrafts, rowsFromDrafts, sensorSummary, type SensorDrafts } from '@/components/study/sensor-settings'
import {
  BLANK_SCHEDULE_FORM, ScheduleFormBody, buildSchedulePayload, timingSummary, validateSchedule, type ScheduleForm,
} from '@/components/study/schedule-form'

interface WizardState {
  name: string
  description: string
  appDescription: string
  syncInterval: number
  pin: string
  autoParticipantId: boolean
  guidedPermissions: boolean
  showSyncCounts: boolean
  sensors: SensorDrafts
  bankingPause: boolean
  addSchedule: 'none' | 'add'
  schedule: ScheduleForm
}

const STEPS = ['Basics', 'Sensors', 'Surveys', 'Review'] as const

const SYNC_OPTIONS = [
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Once a day' },
]

function initialState(): WizardState {
  return {
    name: '',
    description: '',
    appDescription: '',
    syncInterval: 30,
    pin: '',
    autoParticipantId: false,
    guidedPermissions: false,
    showSyncCounts: false,
    sensors: defaultSensorDrafts(),
    bankingPause: true,
    addSchedule: 'none',
    schedule: BLANK_SCHEDULE_FORM,
  }
}

function yesNo(on: boolean) {
  return on ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>
}

function StepIndicator({ step }: { step: number }) {
  return (
    <nav aria-label="Steps" className="mb-6">
      <p className="mb-2 text-sm text-subtle sm:hidden">Step {step + 1} of {STEPS.length}: <span className="font-medium text-fg">{STEPS[step]}</span></p>
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => {
          const done = i < step
          const current = i === step
          return (
            <li key={label} aria-current={current ? 'step' : undefined} className="flex min-w-0 flex-1 items-center gap-2">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done || current ? 'bg-accent text-accent-fg' : 'bg-sunken text-subtle'} ${current ? 'ring-4 ring-accent-soft' : ''}`}>
                {done ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : i + 1}
                <span className="sr-only">{done ? ' (done)' : ''}</span>
              </span>
              <span className={`hidden truncate text-sm sm:block ${current ? 'font-semibold text-fg' : 'text-subtle'}`}>{label}</span>
              {i < STEPS.length - 1 && <span aria-hidden="true" className={`h-px flex-1 ${done ? 'bg-accent' : 'bg-line'}`} />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default function NewStudyPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const me = useMe()
  const isAdmin = me?.role === 'admin'
  const [initial] = useState(initialState)
  const [state, setState] = useState<WizardState>(initial)
  const [step, setStep] = useState(0)
  const [showErrors, setShowErrors] = useState(false)
  // Admins may publish straight away; everyone else always gets a pending draft (enforced by the database).
  const [startAs, setStartAs] = useState<'active' | 'draft'>('active')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Set once the study row exists, so a partial failure cannot create it twice.
  const [created, setCreated] = useState<{ id: string; problems: string[] } | null>(null)

  const dirty = !created && JSON.stringify(state) !== JSON.stringify(initial)
  const { dialog } = useUnsavedChangesGuard(dirty)

  const set = (patch: Partial<WizardState>) => setState(s => ({ ...s, ...patch }))

  const nameError = !state.name.trim() ? 'Enter a study name.' : null
  const pinError = state.pin && !/^\d{4}$/.test(state.pin) ? 'The PIN must be exactly 4 digits, or leave it empty.' : null
  const scheduleErrors = state.addSchedule === 'add' ? validateSchedule(state.schedule) : {}
  const stepErrors = [
    !!(nameError || pinError),
    false,
    Object.keys(scheduleErrors).length > 0,
    false,
  ]

  function next() {
    if (stepErrors[step]) { setShowErrors(true); return }
    setShowErrors(false)
    setStep(s => Math.min(STEPS.length - 1, s + 1))
    window.scrollTo({ top: 0 })
  }

  function goTo(i: number) {
    setShowErrors(false)
    setStep(i)
    window.scrollTo({ top: 0 })
  }

  async function finishSetup(studyId: string): Promise<string[]> {
    const problems: string[] = []
    const { error: sensorError } = await supabase.from('sensor_configs').insert(rowsFromDrafts(studyId, state.sensors))
    if (sensorError) problems.push(`the sensor settings were not saved (${errorText(sensorError)})`)
    if (state.pin) {
      const { error } = await supabase.rpc('set_study_pin', { p_study: studyId, p_pin: state.pin })
      if (error) problems.push(`the PIN was not set (${errorText(error)})`)
    }
    if (state.addSchedule === 'add') {
      // Created switched off: it has no questions yet.
      const { error } = await supabase.from('esm_schedules')
        .insert({ study_id: studyId, ...buildSchedulePayload(state.schedule), enabled: false })
      if (error) problems.push(`the survey schedule was not created (${errorText(error)})`)
    }
    return problems
  }

  async function handleCreate() {
    if (stepErrors.some(Boolean)) {
      const first = stepErrors.findIndex(Boolean)
      setShowErrors(true)
      setStep(first)
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      // The id is generated here rather than read back: the creator only becomes
      // the study's owner (and so able to read it) once the insert has finished.
      const studyId = crypto.randomUUID()
      const config: Record<string, unknown> = {
        banking_pause: { enabled: state.bankingPause, apps: [...DEFAULT_BANKING_APPS], reminder_minutes: 30, escalation_minutes: 120 },
      }
      if (state.guidedPermissions) config.guided_permissions = true
      if (state.showSyncCounts) config.show_sync_counts = true
      if (state.autoParticipantId) config.auto_participant_id = true
      const { error } = await supabase.from('studies').insert({
        id: studyId,
        name: state.name.trim(),
        description: state.description.trim() || null,
        app_description: state.appDescription.trim() || null,
        sync_interval_minutes: state.syncInterval,
        config,
        status: isAdmin && startAs === 'active' ? 'active' : 'draft',
      })
      if (error) {
        setSubmitError(`Could not create the study: ${errorText(error)}`)
        setSubmitting(false)
        return
      }
      const problems = await finishSetup(studyId)
      notifyPendingStudiesChanged()
      if (problems.length) {
        setCreated({ id: studyId, problems })
        setSubmitting(false)
        return
      }
      setCreated({ id: studyId, problems: [] })
      router.push(studyPaths(studyId).overview)
    } catch (e) {
      setSubmitError(`Could not create the study: ${e instanceof Error ? e.message : 'unknown error'}`)
      setSubmitting(false)
    }
  }

  const enabledSensors = SENSORS.filter(s => state.sensors[s.key].enabled)
  const syncLabel = SYNC_OPTIONS.find(o => o.value === state.syncInterval)?.label ?? `Every ${state.syncInterval} minutes`

  return (
    <div>
      {dialog}
      <PageHeader title="New study" description="You can change all of this later in the study's settings." />

      {me && !isAdmin && (
        <div role="note" className="mb-6 flex items-start gap-2 rounded-lg border border-line bg-accent-soft px-4 py-3 text-sm text-fg">
          <Info size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <p>An admin will review this study before participants can join. You can set up sensors and surveys in the meantime.</p>
        </div>
      )}

      <StepIndicator step={step} />

      {step === 0 && (
        <Card>
          <CardHeader title="Basics" />
          <div className="space-y-4">
            <TextField label="Study name" required autoFocus value={state.name} maxLength={200}
              onChange={e => set({ name: e.target.value })} placeholder="e.g. Sleep and phone use 2026"
              error={showErrors ? nameError : null} />
            <Field label="Description for your team" hint="Optional. Only researchers see this.">
              {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} value={state.description} onChange={e => set({ description: e.target.value })} />}
            </Field>
            <Field label="Description for participants" hint="Optional. Shown in the app when someone joins.">
              {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} value={state.appDescription} onChange={e => set({ appDescription: e.target.value })} />}
            </Field>
            <Field label="Upload data" hint="How often phones send what they collected.">
              {(id, d) => (
                <Select id={id} aria-describedby={d} value={state.syncInterval} onChange={e => set({ syncInterval: Number(e.target.value) })} className="sm:w-64">
                  {SYNC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Study PIN" hint="Optional. With a PIN, only people you share it with can join." error={showErrors ? pinError : null}>
              {(id, d) => (
                <Input id={id} aria-describedby={d} aria-invalid={showErrors && pinError ? true : undefined} value={state.pin}
                  inputMode="numeric" autoComplete="off" maxLength={4} placeholder="4 digits"
                  onChange={e => set({ pin: e.target.value })} className="w-36 font-mono tracking-widest" />
              )}
            </Field>
            <div className="space-y-4 border-t border-line pt-4">
              <Toggle checked={state.autoParticipantId} onChange={v => set({ autoParticipantId: v })}
                label="Automatic participant IDs"
                description="Give each new participant an ID when they join, instead of asking them to type one." />
              <Toggle checked={state.guidedPermissions} onChange={v => set({ guidedPermissions: v })}
                label="Guided permissions"
                description="Walk participants through each Android permission the first time they open the app." />
              <Toggle checked={state.showSyncCounts} onChange={v => set({ showSyncCounts: v })}
                label="Show 'to sync' counts to participants"
                description="For pilots and testing. Keep off in real studies so participants don't see how much is recorded." />
            </div>
          </div>
        </Card>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Turn on what the phones should record. {enabledSensors.length > 0 ? `${enabledSensors.length} on.` : 'Nothing is on yet.'}
          </p>
          <SensorSettingsEditor value={state.sensors} onChange={sensors => set({ sensors })} />
          <Card>
            <Toggle checked={state.bankingPause} onChange={v => set({ bankingPause: v })}
              label="Banking app pause"
              description="Many banking apps refuse to open while gesture collection is on. When a common banking app opens, the phone offers to pause gestures and reminds the participant to turn them back on. You can edit the app list later." />
          </Card>
        </div>
      )}

      {step === 2 && (
        <Card>
          <CardHeader icon={<ClipboardList size={16} />} title="Surveys"
            description="Short questionnaires sent to participants as phone notifications, at fixed or random times each day." />
          <div className="space-y-5">
            <ChoiceCards label="Survey schedule" value={state.addSchedule} onChange={addSchedule => set({ addSchedule })}
              options={[
                { value: 'none', label: 'No surveys for now', description: 'Add schedules later in Surveys → Setup.', icon: <MinusCircle size={16} /> },
                { value: 'add', label: 'Add a survey schedule', description: 'Choose when it is sent. Add questions after the study is created.', icon: <ClipboardList size={16} /> },
              ]} />
            {state.addSchedule === 'add' && (
              <>
                <ScheduleFormBody form={state.schedule} setForm={schedule => set({ schedule })} errors={showErrors ? scheduleErrors : {}} />
                <Notice notice={{ tone: 'info', text: 'The schedule is created switched off because it has no questions yet. Add questions in Surveys → Setup, then switch it on.' }} />
              </>
            )}
          </div>
        </Card>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Basics" actions={<Button variant="ghost" size="sm" onClick={() => goTo(0)}>Edit</Button>} />
            <DescriptionList items={[
              { label: 'Study name', value: state.name.trim() || <span className="text-danger">Missing</span> },
              { label: 'Upload data', value: syncLabel },
              { label: 'Description for your team', value: state.description.trim() || <span className="text-subtle">None</span> },
              { label: 'Description for participants', value: state.appDescription.trim() || <span className="text-subtle">None</span> },
              { label: 'Study PIN', value: state.pin ? <Badge tone="green">On (4 digits)</Badge> : <Badge>Off: anyone with the app can join</Badge> },
              { label: 'Automatic participant IDs', value: yesNo(state.autoParticipantId) },
              { label: 'Guided permissions', value: yesNo(state.guidedPermissions) },
              { label: "Show 'to sync' counts to participants", value: yesNo(state.showSyncCounts) },
            ]} />
          </Card>
          <Card>
            <CardHeader title="Sensors" description={`${enabledSensors.length} of ${SENSORS.length} on`}
              actions={<Button variant="ghost" size="sm" onClick={() => goTo(1)}>Edit</Button>} />
            {enabledSensors.length === 0
              ? <p className="text-sm text-subtle">No sensors on. You can turn them on later in Settings → Sensors.</p>
              : (
                <ul className="divide-y divide-line">
                  {enabledSensors.map(s => (
                    <li key={s.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-sm">
                      <span className="font-medium text-fg">{s.label}</span>
                      <span className="text-muted">{sensorSummary(s, state.sensors[s.key])}</span>
                    </li>
                  ))}
                </ul>
              )}
            <div className="mt-3 flex items-center justify-between gap-4 border-t border-line pt-3 text-sm">
              <span className="font-medium text-fg">Banking app pause</span>{yesNo(state.bankingPause)}
            </div>
          </Card>
          <Card>
            <CardHeader title="Surveys" actions={<Button variant="ghost" size="sm" onClick={() => goTo(2)}>Edit</Button>} />
            {state.addSchedule === 'add' ? (
              <DescriptionList items={[
                { label: 'Schedule', value: state.schedule.name.trim() || <span className="text-danger">Missing name</span> },
                { label: 'When', value: timingSummary(state.schedule) },
                { label: 'Expires after', value: `${state.schedule.expiry_minutes} min` },
                { label: 'Notification', value: state.schedule.notification_title || '—' },
              ]} />
            ) : <p className="text-sm text-subtle">No survey schedule. Add one later in Surveys → Setup.</p>}
          </Card>
          {isAdmin && (
            <Card>
              <CardHeader title="Status after creating" />
              <ChoiceCards label="Status after creating" value={startAs} onChange={setStartAs}
                options={[
                  { value: 'active', label: 'Active now', description: 'Approved straight away. Participants can join immediately.' },
                  { value: 'draft', label: 'Pending approval', description: 'Participants cannot join until you approve it.' },
                ]} />
            </Card>
          )}
          {submitError && <Notice notice={{ tone: 'error', text: submitError }} onClose={() => setSubmitError(null)} />}
          {created && created.problems.length > 0 && (
            <div className="space-y-3">
              <Notice notice={{ tone: 'error', text: `The study was created, but ${created.problems.join(', and ')}. You can fix this in the study's settings.` }} />
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={studyPaths(created.id).overview}>Go to the study</ButtonLink>
                <ButtonLink variant="secondary" href={studyPaths(created.id).settings}>Open settings</ButtonLink>
              </div>
            </div>
          )}
        </div>
      )}

      {showErrors && stepErrors[step] && (
        <p role="alert" className="mt-4 text-sm font-medium text-danger">Fix the highlighted fields to continue.</p>
      )}

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
        {step === 0
          ? <ButtonLink variant="secondary" href="/studies">Cancel</ButtonLink>
          : <Button variant="secondary" onClick={() => goTo(step - 1)} disabled={submitting}><ArrowLeft size={14} aria-hidden="true" /> Back</Button>}
        {step < STEPS.length - 1 ? (
          <Button onClick={next}>Continue <ArrowRight size={14} aria-hidden="true" /></Button>
        ) : (
          <Button onClick={handleCreate} loading={submitting} disabled={!!created}>
            {!submitting && <Check size={14} aria-hidden="true" />} {submitting ? 'Creating…' : 'Create study'}
          </Button>
        )}
      </div>
    </div>
  )
}
