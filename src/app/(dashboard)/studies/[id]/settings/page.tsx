'use client'

import { createClient } from '@/lib/supabase-browser'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CheckCircle2, Clock, CreditCard, Download, FileText, KeyRound, ShieldAlert, Trash2, UserPlus } from 'lucide-react'
import { useStudyAccess } from '@/lib/access'
import { isPendingApproval, notifyPendingStudiesChanged, statusOptionsFor } from '@/lib/pending-studies'
import { studyStatusInfo } from '@/lib/status'
import { DEFAULT_BANKING_APPS } from '@/lib/sensors'
import { downloadBlob, exportStudyZip } from '@/lib/export-study'
import { PinLockouts } from '@/components/pin-lockouts'
import { AppListEditor } from '@/components/study/app-list-editor'
import { NumberInput } from '@/components/study/number-input'
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, DescriptionList, ErrorState, Field, Input, Notice, ReadOnlyBanner,
  SaveBar, Skeleton, StatusPill, TextField, Textarea, Toggle, errorText, useConfirm, useUnsavedChangesGuard,
  type NoticeState,
} from '@/components/ui'

interface BankingPause {
  enabled: boolean
  apps: string[]
  reminder_minutes: number
  escalation_minutes: number
}

interface StudyConfig {
  guided_permissions?: boolean
  auto_participant_id?: boolean
  banking_pause?: Partial<BankingPause>
  [key: string]: unknown
}

interface Study {
  id: string
  name: string
  description: string | null
  app_description: string | null
  status: string
  sync_interval_minutes: number
  config: StudyConfig | null
  pin_required?: boolean
  approved_at?: string | null
  created_at: string
}

/** The fields saved together by the save bar. */
interface StudyForm {
  name: string
  description: string
  app_description: string
  /** Text so a value under the minimum can be shown with an error instead of being dropped */
  sync_interval: string
  guided_permissions: boolean
  auto_participant_id: boolean
  banking: BankingPause
}

const MIN_SYNC_MINUTES = 15
const MAX_SYNC_MINUTES = 1440

function formFromStudy(s: Study): StudyForm {
  const bp = s.config?.banking_pause
  return {
    name: s.name,
    description: s.description ?? '',
    app_description: s.app_description ?? '',
    sync_interval: String(s.sync_interval_minutes ?? 30),
    guided_permissions: !!s.config?.guided_permissions,
    auto_participant_id: !!s.config?.auto_participant_id,
    // No banking_pause key means the phones do not pause at all.
    banking: {
      enabled: bp?.enabled ?? false,
      apps: Array.isArray(bp?.apps) ? bp.apps.map(String) : [...DEFAULT_BANKING_APPS],
      reminder_minutes: bp?.reminder_minutes ?? 30,
      escalation_minutes: bp?.escalation_minutes ?? 120,
    },
  }
}

function syncError(text: string): string | null {
  const n = Number(text)
  if (!text.trim() || !Number.isInteger(n)) return 'Enter a whole number of minutes.'
  if (n < MIN_SYNC_MINUTES) return `At least ${MIN_SYNC_MINUTES} minutes: Android does not run background uploads more often.`
  if (n > MAX_SYNC_MINUTES) return 'At most 1,440 minutes (once a day).'
  return null
}

/** What each status button is called and what it does to the phones. */
const STATUS_ACTIONS: Record<string, { label: (from: string) => string; title: string; effect: string; tone?: 'danger' }> = {
  active: {
    label: from => from === 'paused' ? 'Resume' : from === 'completed' ? 'Reopen' : 'Activate',
    title: 'Make this study active?',
    effect: 'Participants can join, and phones start collecting and uploading again at their next sync.',
  },
  paused: {
    label: () => 'Pause',
    title: 'Pause this study?',
    effect: 'Phones stop collecting sensor data and surveys at their next sync. They keep what they already have, and you can resume at any time.',
  },
  completed: {
    label: () => 'Mark completed',
    title: 'Mark this study completed?',
    effect: 'Phones stop collecting at their next sync and new participants cannot join. All data stays available to export.',
  },
  draft: {
    label: () => 'Move back to draft',
    title: 'Move this study back to draft?',
    effect: 'Participants cannot join and phones stop collecting. Only an admin can make it active again.',
    tone: 'danger',
  },
}

export default function StudySettingsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const access = useStudyAccess(id)
  const canEdit = access.canEdit
  const { ask, dialog: confirmDialog } = useConfirm()

  const [study, setStudy] = useState<Study | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [participantCount, setParticipantCount] = useState<number | null>(null)
  const [form, setForm] = useState<StudyForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<NoticeState>(null)
  const [showErrors, setShowErrors] = useState(false)

  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinBusy, setPinBusy] = useState(false)

  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  // Reject (pending) and delete both go through delete_study() with a reason.
  const [removal, setRemoval] = useState<'reject' | 'delete' | null>(null)
  const [reason, setReason] = useState('')
  const [removalError, setRemovalError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const reasonId = useId()

  const fetchStudy = useCallback(async () => {
    const [studyRes, countRes] = await Promise.all([
      supabase.from('studies').select('*').eq('id', id).maybeSingle(),
      supabase.from('participants').select('id', { count: 'exact', head: true }).eq('study_id', id),
    ])
    return { studyRes, count: countRes.error ? null : (countRes.count ?? 0) }
  }, [supabase, id])

  const applyStudy = useCallback((res: Awaited<ReturnType<typeof fetchStudy>>, resetForm: boolean) => {
    const { data, error } = res.studyRes
    if (error || !data) {
      setLoadError(error ? errorText(error) : 'This study does not exist or you do not have access to it.')
      return
    }
    setLoadError(null)
    setStudy(data as Study)
    setParticipantCount(res.count)
    if (resetForm) setForm(formFromStudy(data as Study))
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchStudy().then(res => { if (!cancelled) applyStudy(res, true) })
    return () => { cancelled = true }
  }, [fetchStudy, applyStudy])

  /** Re-reads the study after a status change; keeps unsaved form edits. */
  async function reloadStudy() {
    applyStudy(await fetchStudy(), false)
  }

  const initial = useMemo(() => study ? formFromStudy(study) : null, [study])
  const dirty = !!form && !!initial && JSON.stringify(form) !== JSON.stringify(initial)
  const { dialog: guardDialog } = useUnsavedChangesGuard(dirty || pinInput !== '')

  const nameError = form && !form.name.trim() ? 'Enter a study name.' : null
  const syncProblem = form ? syncError(form.sync_interval) : null
  const bankingProblem = form && form.banking.enabled && form.banking.escalation_minutes <= form.banking.reminder_minutes
    ? 'The second reminder must come after the first.' : null

  function patch(p: Partial<StudyForm>) {
    setForm(f => f ? { ...f, ...p } : f)
  }
  function patchBanking(p: Partial<BankingPause>) {
    setForm(f => f ? { ...f, banking: { ...f.banking, ...p } } : f)
  }

  async function save() {
    if (!study || !form) return
    if (nameError || syncProblem || bankingProblem) { setShowErrors(true); return }
    setSaving(true)
    setNotice(null)
    const config: StudyConfig = { ...(study.config ?? {}) }
    if (form.guided_permissions) config.guided_permissions = true
    else delete config.guided_permissions
    if (form.auto_participant_id) config.auto_participant_id = true
    else delete config.auto_participant_id
    config.banking_pause = { ...form.banking }
    const update = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      app_description: form.app_description.trim() || null,
      sync_interval_minutes: Number(form.sync_interval),
      config,
    }
    const { data, error } = await supabase.from('studies').update(update).eq('id', id).select('id')
    setSaving(false)
    if (error || !data?.length) {
      setNotice({ tone: 'error', text: `Could not save the study: ${error ? errorText(error) : 'you do not have permission to edit it.'}` })
      return
    }
    const next = { ...study, ...update }
    setStudy(next)
    setForm(formFromStudy(next))
    setShowErrors(false)
    setNotice({ tone: 'success', text: 'Settings saved. Phones pick them up at their next sync.' })
    if (update.name !== study.name) notifyPendingStudiesChanged()
  }

  async function applyPin(pin: string | null) {
    setPinBusy(true)
    setPinError(null)
    const { error } = await supabase.rpc('set_study_pin', { p_study: id, p_pin: pin })
    setPinBusy(false)
    if (error) return errorText(error)
    setStudy(s => s ? { ...s, pin_required: pin !== null } : s)
    setPinInput('')
    setNotice({ tone: 'success', text: pin ? 'PIN saved. Share it only with participants who should join.' : 'PIN removed. Anyone with the app can join this study.' })
    return null
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{4}$/.test(pinInput)) { setPinError('Enter exactly 4 digits.'); return }
    const problem = await applyPin(pinInput)
    if (problem) setPinError(problem)
  }

  function removePin() {
    ask({
      title: 'Remove the study PIN?',
      body: <p>Anyone who installs the app can then join this study without a PIN. People already enrolled are not affected.</p>,
      confirmLabel: 'Remove PIN',
      tone: 'danger',
      run: () => applyPin(null),
    })
  }

  function changeStatus(next: string) {
    if (!study) return
    const action = STATUS_ACTIONS[next]
    ask({
      title: action?.title ?? `Change status to ${next}?`,
      body: <p>{action?.effect}</p>,
      confirmLabel: action ? action.label(study.status) : 'Change status',
      tone: action?.tone,
      run: async () => {
        const { data, error } = await supabase.from('studies').update({ status: next }).eq('id', id).select('id')
        if (error || !data?.length) return `Could not change the status: ${error ? errorText(error) : 'you do not have permission.'}`
        await reloadStudy()
        notifyPendingStudiesChanged()
        setNotice({ tone: 'success', text: `Study is now ${studyStatusInfo({ ...study, status: next }).label.toLowerCase()}.` })
      },
    })
  }

  async function approve() {
    if (!study) return
    setApproving(true)
    setNotice(null)
    const { data, error } = await supabase.from('studies').update({ status: 'active' }).eq('id', id).select('id')
    setApproving(false)
    if (error || !data?.length) {
      setNotice({ tone: 'error', text: `Could not approve the study: ${error ? errorText(error) : 'only an admin can approve it.'}` })
      return
    }
    await reloadStudy()
    notifyPendingStudiesChanged()
    setNotice({ tone: 'success', text: `${study.name} is approved and active. Participants can now join.` })
  }

  function openRemoval(kind: 'reject' | 'delete') {
    setReason('')
    setRemovalError(null)
    setRemoval(kind)
  }

  async function confirmRemoval() {
    if (!removal) return
    const text = reason.trim()
    if (!text) { setRemovalError(removal === 'reject' ? 'Enter a reason for rejecting this study.' : 'Enter a reason for deleting this study.'); return }
    setRemoving(true)
    setRemovalError(null)
    const { error } = await supabase.rpc('delete_study', {
      p_study: id,
      p_reason: removal === 'reject' ? `Rejected: ${text}` : text,
    })
    if (error) {
      setRemoving(false)
      setRemovalError(errorText(error))
      return
    }
    notifyPendingStudiesChanged()
    router.push('/studies')
  }

  async function handleExport() {
    if (!study) return
    setNotice(null)
    setExportStatus('Starting…')
    try {
      const { blob, filename, counts } = await exportStudyZip(supabase, study, setExportStatus)
      downloadBlob(blob, filename)
      const rows = Object.entries(counts).filter(([t]) => t.startsWith('data_')).reduce((a, [, n]) => a + n, 0)
      setNotice({ tone: 'success', text: `Exported ${counts.participants ?? 0} participants and ${rows.toLocaleString()} data rows to ${filename}.` })
    } catch (e) {
      setNotice({ tone: 'error', text: `Export failed: ${e instanceof Error ? e.message : 'unknown error'}` })
    } finally {
      setExportStatus(null)
    }
  }

  if (loadError && !study) {
    return <ErrorState title="Could not load this study" message={loadError} onRetry={() => { setLoadError(null); void reloadStudy() }} />
  }

  if (!study || !form) {
    return (
      <div role="status" aria-label="Loading settings" className="space-y-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-lg border border-line bg-surface p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-4 h-9 w-full" />
            <Skeleton className="mt-3 h-9 w-2/3" />
          </div>
        ))}
      </div>
    )
  }

  const pending = isPendingApproval(study)
  const statusInfo = studyStatusInfo(study)
  const statusRule = statusOptionsFor(access.role, study)
  const statusButtons = pending ? [] : statusRule.options.filter(s => s !== study.status)
  const readOnly = !access.loading && !canEdit

  return (
    <div className="space-y-5">
      {guardDialog}
      {confirmDialog}

      {readOnly && <ReadOnlyBanner />}
      <Notice notice={notice} onClose={() => setNotice(null)} />

      {pending && (
        <div role="status" aria-label="Pending approval"
          className="flex flex-col gap-3 rounded-lg border border-line bg-warning-soft px-4 py-3 sm:flex-row sm:items-center">
          <Clock size={18} className="hidden shrink-0 text-warning sm:block" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-fg">Pending approval</p>
            <p className="mt-0.5 text-muted">
              {access.isAdmin
                ? 'Participants cannot join until an admin approves this study. Approving makes it active straight away.'
                : 'Waiting for an admin to approve. You can finish setting up sensors and surveys in the meantime.'}
            </p>
          </div>
          {access.isAdmin && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button onClick={approve} loading={approving}><CheckCircle2 size={14} aria-hidden="true" /> Approve</Button>
              <Button variant="secondary" onClick={() => openRemoval('reject')} disabled={approving}>Reject</Button>
            </div>
          )}
        </div>
      )}

      {/* Study details */}
      <Card>
        <CardHeader icon={<FileText size={16} />} title="Study details"
          />
        {canEdit ? (
          <div className="space-y-4">
            <TextField label="Study name" required value={form.name} onChange={e => patch({ name: e.target.value })}
              error={showErrors ? nameError : null} maxLength={200} />
            <Field label="Description for your team" hint="Only researchers see this.">
              {(fid, d) => <Textarea id={fid} aria-describedby={d} rows={2} value={form.description} onChange={e => patch({ description: e.target.value })} />}
            </Field>
            <Field label="Description for participants" hint="Shown in the app when someone joins. Keep it short and plain.">
              {(fid, d) => <Textarea id={fid} aria-describedby={d} rows={3} value={form.app_description} onChange={e => patch({ app_description: e.target.value })} />}
            </Field>
            <Field label="Upload every" hint={`Minutes. ${MIN_SYNC_MINUTES} minutes is the shortest Android allows.`} error={syncProblem}>
              {(fid, d) => (
                <div className="flex items-center gap-2">
                  <Input id={fid} aria-describedby={d} aria-invalid={syncProblem ? true : undefined} type="number" inputMode="numeric"
                    min={MIN_SYNC_MINUTES} max={MAX_SYNC_MINUTES} step={1} value={form.sync_interval}
                    onChange={e => patch({ sync_interval: e.target.value })} className="w-28" />
                  <span className="text-sm text-subtle">min</span>
                </div>
              )}
            </Field>
          </div>
        ) : (
          <DescriptionList items={[
            { label: 'Study name', value: study.name },
            { label: 'Upload every', value: `${study.sync_interval_minutes} min` },
            { label: 'Description for your team', value: study.description || <span className="text-subtle">None</span> },
            { label: 'Description for participants', value: study.app_description || <span className="text-subtle">None</span> },
          ]} />
        )}
      </Card>

      {/* Joining the study */}
      <Card>
        <CardHeader icon={<UserPlus size={16} />} title="Joining the study"
          />
        <div className="space-y-5">
          <div className="rounded-lg border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound size={15} className="text-subtle" aria-hidden="true" />
                <h3 className="text-sm font-medium text-fg">Study PIN</h3>
                {study.pin_required ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}
              </div>
              {canEdit && study.pin_required && (
                <Button variant="danger-ghost" size="sm" onClick={removePin} disabled={pinBusy}>Remove PIN</Button>
              )}
            </div>
            <p className="mt-1 text-xs text-subtle">
              {study.pin_required
                ? 'Participants must type the 4-digit PIN to join. It is stored hashed, so it cannot be shown again.'
                : 'No PIN: anyone with the app can join. Set one to limit joining to people you give it to.'}
            </p>
            {canEdit && (
              <form onSubmit={submitPin} className="mt-3 flex flex-wrap items-start gap-2" noValidate>
                <Field label={study.pin_required ? 'New PIN' : 'PIN'} error={pinError} className="w-36">
                  {(fid, d) => (
                    <Input id={fid} aria-describedby={d} aria-invalid={pinError ? true : undefined} value={pinInput}
                      inputMode="numeric" autoComplete="off" maxLength={4} placeholder="4 digits"
                      onChange={e => { setPinInput(e.target.value); setPinError(null) }}
                      className="font-mono tracking-widest" />
                  )}
                </Field>
                <Button type="submit" variant="secondary" loading={pinBusy} className="mt-[1.625rem]">
                  {study.pin_required ? 'Change PIN' : 'Set PIN'}
                </Button>
              </form>
            )}
          </div>

          <Toggle checked={form.auto_participant_id} disabled={!canEdit} onChange={v => patch({ auto_participant_id: v })}
            label="Automatic participant IDs"
            description="Give each new participant an ID when they join, instead of asking them to type one." />
          <Toggle checked={form.guided_permissions} disabled={!canEdit} onChange={v => patch({ guided_permissions: v })}
            label="Guided permissions"
            description="Walk participants through each Android permission the first time they open the app." />

          <PinLockouts studyId={id} canEdit={canEdit} />
        </div>
      </Card>

      {/* Banking pause */}
      <Card>
        <CardHeader icon={<CreditCard size={16} />} title="Banking app pause"
          description="Many banking apps refuse to open while gesture collection is on. When a listed app opens, the phone offers to pause gestures and reminds the participant to turn them back on." />
        <div className="space-y-4">
          <Toggle checked={form.banking.enabled} disabled={!canEdit} onChange={v => patchBanking({ enabled: v })}
            label="Offer to pause for banking apps" />
          {form.banking.enabled && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="First reminder after" hint="Minutes paused before a gentle reminder.">
                  {(fid, d) => (
                    <div className="flex items-center gap-2">
                      <NumberInput id={fid} describedBy={d} min={1} max={10080} disabled={!canEdit}
                        value={form.banking.reminder_minutes} onChange={v => patchBanking({ reminder_minutes: v })} />
                      <span className="text-sm text-subtle">min</span>
                    </div>
                  )}
                </Field>
                <Field label="Urgent reminder after" hint="Minutes paused before a high-priority reminder." error={showErrors ? bankingProblem : null}>
                  {(fid, d) => (
                    <div className="flex items-center gap-2">
                      <NumberInput id={fid} describedBy={d} min={1} max={10080} disabled={!canEdit} invalid={showErrors && !!bankingProblem}
                        value={form.banking.escalation_minutes} onChange={v => patchBanking({ escalation_minutes: v })} />
                      <span className="text-sm text-subtle">min</span>
                    </div>
                  )}
                </Field>
              </div>
              <AppListEditor label="Banking apps" apps={form.banking.apps} disabled={!canEdit}
                onChange={apps => patchBanking({ apps })} placeholder="com.example.bank"
                hint="Android package names. Press Enter or Add."
                confirmRemoveBody={app => <p>Phones will no longer offer to pause gestures when {app} opens, once you save.</p>} />
            </>
          )}
        </div>
      </Card>

      {/* Study status */}
      <Card>
        <CardHeader icon={<ShieldAlert size={16} />} title="Study status" />
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill study={study} />
          <p className="text-sm text-muted">{statusInfo.description}</p>
        </div>
        {statusButtons.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {statusButtons.map(s => (
              <Button key={s} variant={STATUS_ACTIONS[s]?.tone === 'danger' ? 'danger-ghost' : 'secondary'} onClick={() => changeStatus(s)}>
                {STATUS_ACTIONS[s]?.label(study.status) ?? s}
              </Button>
            ))}
          </div>
        ) : !pending && statusRule.reason ? (
          <p className="mt-3 text-xs text-subtle">{statusRule.reason}</p>
        ) : null}
      </Card>

      {/* Export */}
      <Card>
        <CardHeader icon={<Download size={16} />} title="Export"
          description="All tables as CSV files in one zip. Phone numbers stay hashed." />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={handleExport} loading={!!exportStatus}>
            {!exportStatus && <Download size={14} aria-hidden="true" />} Export all study data
          </Button>
          <p aria-live="polite" className="text-sm text-subtle">{exportStatus ? `Exporting: ${exportStatus}` : ''}</p>
        </div>
      </Card>

      {/* Danger zone */}
      {access.isAdmin && (
        <section aria-label="Danger zone" className="rounded-lg border border-danger/40 bg-surface p-5">
          <CardHeader icon={<Trash2 size={16} />} title="Danger zone"
            description="Removes the study, its participants and all their data. This cannot be undone." />
          <Button variant="danger" onClick={() => openRemoval('delete')}>
            <Trash2 size={14} aria-hidden="true" /> Delete study
          </Button>
        </section>
      )}

      {canEdit && (
        <SaveBar dirty={dirty} saving={saving} onSave={save}
          onDiscard={() => { setForm(formFromStudy(study)); setShowErrors(false) }}
          message={showErrors && (nameError || syncProblem || bankingProblem) ? 'Fix the highlighted fields to save.' : undefined} />
      )}

      <ConfirmDialog
        open={removal !== null}
        tone="danger"
        title={removal === 'reject' ? `Reject ${study.name}?` : `Delete ${study.name}?`}
        body={removal === 'reject'
          ? <p>Rejecting deletes this pending study and its setup. The reason is kept in the activity log.</p>
          : <p>This permanently deletes the study, its {participantCount ?? 'enrolled'} participant{participantCount === 1 ? '' : 's'} and all collected data. Phones in the study stop uploading.</p>}
        confirmLabel={removal === 'reject' ? 'Reject study' : 'Delete study'}
        requireText={removal === 'delete' ? study.name : undefined}
        busy={removing}
        error={removalError}
        onConfirm={confirmRemoval}
        onCancel={() => { if (!removing) setRemoval(null) }}
      >
        <div>
          <label htmlFor={reasonId} className="block text-sm font-medium text-fg">Reason</label>
          <Textarea id={reasonId} value={reason} onChange={e => { setReason(e.target.value); setRemovalError(null) }}
            rows={2} maxLength={1000} required className="mt-1.5 resize-none"
            placeholder={removal === 'reject' ? 'Why it was not approved' : 'Why it is being deleted'} />
        </div>
      </ConfirmDialog>
    </div>
  )
}
