'use client'

import { createClient } from '@/lib/supabase-browser'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react'
import { useStudyAccess } from '@/lib/access'
import {
  Badge, Button, Card, CardHeader, DescriptionList, EmptyState, ErrorState, Field, Input, Notice, ReadOnlyBanner,
  SectionHeader, Select, Skeleton, SkeletonRows, Textarea, Toggle, errorText, useConfirm, useUnsavedChangesGuard,
  type NoticeState,
} from '@/components/ui'
import { NumberInput } from '@/components/study/number-input'
import {
  BLANK_SCHEDULE_FORM, NotificationPreview, ScheduleFormBody, buildSchedulePayload, scheduleToForm, scheduleTypeInfo,
  timingSummary, validateSchedule, type Schedule, type ScheduleForm,
} from '@/components/study/schedule-form'

// ─── Questions ───────────────────────────────────────────────────────────────

interface QuestionConfig {
  min?: number
  max?: number
  step?: number
  label_min?: string | null
  label_max?: string | null
  [key: string]: unknown
}

interface Question {
  id: string
  schedule_id: string
  question_order: number
  question_type: string
  question_text: string
  required: boolean
  options: string[] | null
  config: QuestionConfig | null
}

interface QuestionForm {
  question_type: string
  question_text: string
  required: boolean
  options: string
  min: number
  max: number
  step: number
  label_min: string
  label_max: string
}

const QUESTION_TYPES: { key: string; label: string }[] = [
  { key: 'likert', label: 'Rating scale (Likert)' },
  { key: 'slider', label: 'Slider' },
  { key: 'text', label: 'Free text' },
  { key: 'number', label: 'Number' },
  { key: 'single_choice', label: 'Single choice' },
  { key: 'multi_choice', label: 'Multiple choice' },
  { key: 'yes_no', label: 'Yes or no' },
  { key: 'time', label: 'Time of day' },
  { key: 'date', label: 'Date' },
]

const SCALE_TYPES = ['likert', 'slider', 'number']
const CHOICE_TYPES = ['single_choice', 'multi_choice']

const BLANK_QUESTION_FORM: QuestionForm = {
  question_type: 'likert', question_text: '', required: true,
  options: '', min: 1, max: 7, step: 1, label_min: '', label_max: '',
}

function questionTypeLabel(type: string) {
  return QUESTION_TYPES.find(t => t.key === type)?.label ?? type.replace(/_/g, ' ')
}

function questionToForm(q: Question): QuestionForm {
  return {
    question_type: q.question_type,
    question_text: q.question_text,
    required: q.required,
    options: (q.options || []).join(', '),
    min: q.config?.min ?? 1,
    max: q.config?.max ?? 7,
    step: q.config?.step ?? 1,
    label_min: q.config?.label_min ?? '',
    label_max: q.config?.label_max ?? '',
  }
}

function splitOptions(text: string) {
  return text.split(',').map(o => o.trim()).filter(Boolean)
}

type QuestionErrors = Partial<Record<'text' | 'options' | 'scale', string>>

function validateQuestion(f: QuestionForm): QuestionErrors {
  const e: QuestionErrors = {}
  if (!f.question_text.trim()) e.text = 'Enter the question.'
  if (CHOICE_TYPES.includes(f.question_type) && splitOptions(f.options).length < 2) e.options = 'Add at least two options, separated by commas.'
  if (SCALE_TYPES.includes(f.question_type) && (f.min >= f.max || f.step <= 0)) e.scale = 'The highest value must be above the lowest, and the step at least 1.'
  return e
}

function buildQuestionPayload(f: QuestionForm, order: number) {
  return {
    question_type: f.question_type,
    question_text: f.question_text.trim(),
    required: f.required,
    options: CHOICE_TYPES.includes(f.question_type) ? splitOptions(f.options) : null,
    config: SCALE_TYPES.includes(f.question_type)
      ? { min: f.min, max: f.max, step: f.step, label_min: f.label_min.trim() || null, label_max: f.label_max.trim() || null }
      : {},
    question_order: order,
  }
}

function scaleValues(min: number, max: number, step: number) {
  const values: number[] = []
  if (step <= 0 || max < min) return { values, more: false }
  for (let v = min; v <= max && values.length < 11; v += step) values.push(v)
  return { values, more: Math.floor((max - min) / step) + 1 > values.length }
}

function ScalePreview({ min, max, step, labelMin, labelMax }: { min: number; max: number; step: number; labelMin?: string | null; labelMax?: string | null }) {
  const { values, more } = scaleValues(min, max, step)
  if (!values.length) return null
  return (
    <div aria-label="Scale preview">
      <div className="flex flex-wrap items-center gap-1">
        {values.map(v => (
          <span key={v} className="flex h-7 min-w-7 items-center justify-center rounded-md border border-line bg-sunken px-1 text-[11px] font-semibold text-muted">{v}</span>
        ))}
        {more && <span className="text-xs text-subtle">… {max}</span>}
      </div>
      {(labelMin || labelMax) && (
        <div className="mt-1 flex justify-between gap-4 text-[11px] text-subtle">
          <span>{labelMin}</span><span>{labelMax}</span>
        </div>
      )}
    </div>
  )
}

function QuestionFormBody({ form, setForm, errors }: { form: QuestionForm; setForm: (f: QuestionForm) => void; errors: QuestionErrors }) {
  const set = (p: Partial<QuestionForm>) => setForm({ ...form, ...p })
  const isScale = SCALE_TYPES.includes(form.question_type)
  const isChoice = CHOICE_TYPES.includes(form.question_type)
  return (
    <div className="space-y-4">
      <Field label="Answer type">
        {(id, d) => (
          <Select id={id} aria-describedby={d} value={form.question_type} onChange={e => set({ question_type: e.target.value })} className="sm:w-72">
            {QUESTION_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Question" required error={errors.text}>
        {(id, d) => (
          <Textarea id={id} aria-describedby={d} aria-invalid={errors.text ? true : undefined} rows={2} value={form.question_text}
            onChange={e => set({ question_text: e.target.value })} placeholder="e.g. How are you feeling right now?" />
        )}
      </Field>
      {isScale && (
        <fieldset className="space-y-3 rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-medium text-fg">Scale</legend>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Lowest">{(id, d) => <NumberInput id={id} describedBy={d} className="w-full" value={form.min} onChange={min => set({ min })} />}</Field>
            <Field label="Highest">{(id, d) => <NumberInput id={id} describedBy={d} className="w-full" value={form.max} onChange={max => set({ max })} />}</Field>
            <Field label="Step">{(id, d) => <NumberInput id={id} describedBy={d} className="w-full" min={1} value={form.step} onChange={step => set({ step })} />}</Field>
          </div>
          {form.question_type !== 'number' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Label for lowest" hint="Optional">
                {(id, d) => <Input id={id} aria-describedby={d} value={form.label_min} onChange={e => set({ label_min: e.target.value })} placeholder="e.g. Not at all" />}
              </Field>
              <Field label="Label for highest" hint="Optional">
                {(id, d) => <Input id={id} aria-describedby={d} value={form.label_max} onChange={e => set({ label_max: e.target.value })} placeholder="e.g. Extremely" />}
              </Field>
            </div>
          )}
          {errors.scale && <p role="alert" className="text-xs font-medium text-danger">{errors.scale}</p>}
          <ScalePreview min={form.min} max={form.max} step={form.step} labelMin={form.label_min} labelMax={form.label_max} />
        </fieldset>
      )}
      {isChoice && (
        <Field label="Options" hint="Separate options with commas." error={errors.options}>
          {(id, d) => (
            <div>
              <Input id={id} aria-describedby={d} aria-invalid={errors.options ? true : undefined} value={form.options}
                onChange={e => set({ options: e.target.value })} placeholder="Very good, Good, Neutral, Bad, Very bad" />
              {splitOptions(form.options).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {splitOptions(form.options).map((o, i) => <Badge key={i} tone="blue">{o}</Badge>)}
                </div>
              )}
            </div>
          )}
        </Field>
      )}
      <Toggle size="sm" checked={form.required} onChange={required => set({ required })}
        label="Answer required" description="Participants cannot submit the survey without answering." />
    </div>
  )
}

function QuestionSummary({ q }: { q: Question }) {
  const cfg = q.config ?? {}
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <Badge>{questionTypeLabel(q.question_type)}</Badge>
        {q.required && <Badge tone="amber">Required</Badge>}
      </div>
      <p className="break-words text-sm text-fg">{q.question_text}</p>
      {SCALE_TYPES.includes(q.question_type) && cfg.min !== undefined && cfg.max !== undefined && (
        <div className="mt-2"><ScalePreview min={cfg.min} max={cfg.max} step={cfg.step || 1} labelMin={cfg.label_min} labelMax={cfg.label_max} /></div>
      )}
      {q.options && q.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {q.options.map((o, j) => <Badge key={j}>{o}</Badge>)}
        </div>
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

type Counts = Record<string, number | null>

export default function SurveySetupPage() {
  const { id: studyId } = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const access = useStudyAccess(studyId)
  const canEdit = access.canEdit
  const { ask, dialog: confirmDialog } = useConfirm()
  const [notice, setNotice] = useState<NoticeState>(null)

  const [schedules, setSchedules] = useState<Schedule[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [questionCounts, setQuestionCounts] = useState<Counts>({})
  const [responseCounts, setResponseCounts] = useState<Counts>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [questions, setQuestions] = useState<{ scheduleId: string; list: Question[] } | null>(null)
  const [questionsError, setQuestionsError] = useState<string | null>(null)

  const [scheduleMode, setScheduleMode] = useState<'create' | 'edit' | null>(null)
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm>(BLANK_SCHEDULE_FORM)
  const [scheduleShowErrors, setScheduleShowErrors] = useState(false)
  const [scheduleSaving, setScheduleSaving] = useState(false)

  // 'new' while adding, a question id while editing one
  const [questionEditing, setQuestionEditing] = useState<string | null>(null)
  const [questionForm, setQuestionForm] = useState<QuestionForm>(BLANK_QUESTION_FORM)
  const [questionShowErrors, setQuestionShowErrors] = useState(false)
  const [questionSaving, setQuestionSaving] = useState(false)

  const selected = schedules?.find(s => s.id === selectedId) ?? null
  const selectedKnown = selected ? scheduleTypeInfo(selected.schedule_type).known : true
  const questionList = questions && questions.scheduleId === selectedId ? questions.list : null

  // ── Loading ──────────────────────────────────────────────────────────────

  const fetchSchedules = useCallback(async () => {
    const { data, error } = await supabase.from('esm_schedules').select('*').eq('study_id', studyId).order('created_at')
    if (error) return { error: errorText(error), list: [] as Schedule[], qCounts: {}, rCounts: {} }
    const list = (data || []) as Schedule[]
    const ids = list.map(s => s.id)
    const qCounts: Counts = Object.fromEntries(ids.map(i => [i, 0]))
    const rCounts: Counts = {}
    if (ids.length) {
      // One query for every question count, and the response counts in parallel.
      const [qRes, ...rRes] = await Promise.all([
        supabase.from('esm_questions').select('schedule_id').in('schedule_id', ids),
        ...ids.map(i => supabase.from('data_esm_responses').select('id', { count: 'exact', head: true }).eq('schedule_id', i)),
      ])
      if (qRes.error) ids.forEach(i => { qCounts[i] = null })
      else for (const row of (qRes.data || []) as { schedule_id: string }[]) qCounts[row.schedule_id] = (qCounts[row.schedule_id] ?? 0) + 1
      ids.forEach((i, n) => { rCounts[i] = rRes[n].error ? null : (rRes[n].count ?? 0) })
    }
    return { error: null, list, qCounts, rCounts }
  }, [supabase, studyId])

  const applySchedules = useCallback((res: Awaited<ReturnType<typeof fetchSchedules>>) => {
    setLoadError(res.error)
    if (res.error) return
    setSchedules(res.list)
    setQuestionCounts(res.qCounts)
    setResponseCounts(res.rCounts)
    setSelectedId(cur => (cur && res.list.some(s => s.id === cur)) ? cur : res.list[0]?.id ?? null)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchSchedules().then(res => { if (!cancelled) applySchedules(res) })
    return () => { cancelled = true }
  }, [fetchSchedules, applySchedules])

  const fetchQuestions = useCallback(async (scheduleId: string) => {
    const { data, error } = await supabase.from('esm_questions').select('*').eq('schedule_id', scheduleId).order('question_order')
    return { scheduleId, list: (data || []) as Question[], error: error ? errorText(error) : null }
  }, [supabase])

  const applyQuestions = useCallback((res: Awaited<ReturnType<typeof fetchQuestions>>) => {
    setQuestionsError(res.error)
    setQuestions({ scheduleId: res.scheduleId, list: res.list })
    if (!res.error) setQuestionCounts(c => ({ ...c, [res.scheduleId]: res.list.length }))
  }, [])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    fetchQuestions(selectedId).then(res => { if (!cancelled) applyQuestions(res) })
    return () => { cancelled = true }
  }, [selectedId, fetchQuestions, applyQuestions])

  // ── Unsaved changes ──────────────────────────────────────────────────────

  const editingQuestion = questionEditing && questionEditing !== 'new' ? questionList?.find(q => q.id === questionEditing) : null
  const scheduleDirty = scheduleMode === 'create'
    ? JSON.stringify(scheduleForm) !== JSON.stringify(BLANK_SCHEDULE_FORM)
    : scheduleMode === 'edit' && !!selected && JSON.stringify(scheduleForm) !== JSON.stringify(scheduleToForm(selected))
  const questionDirty = questionEditing === 'new'
    ? JSON.stringify(questionForm) !== JSON.stringify(BLANK_QUESTION_FORM)
    : !!editingQuestion && JSON.stringify(questionForm) !== JSON.stringify(questionToForm(editingQuestion))
  const dirty = scheduleDirty || questionDirty
  const { dialog: guardDialog } = useUnsavedChangesGuard(dirty)

  /** Runs `action` now, or after the researcher agrees to drop unsaved changes. */
  function whenClean(action: () => void) {
    if (!dirty) { action(); return }
    ask({
      title: 'Discard unsaved changes?',
      body: <p>The form you have open has changes that are not saved.</p>,
      confirmLabel: 'Discard changes',
      tone: 'danger',
      run: async () => { action() },
    })
  }

  function closeForms() {
    setScheduleMode(null)
    setScheduleShowErrors(false)
    setQuestionEditing(null)
    setQuestionShowErrors(false)
  }

  function selectSchedule(id: string) {
    if (id === selectedId) return
    whenClean(() => { closeForms(); setSelectedId(id) })
  }

  /** Shows an error for a failed write; RLS-blocked writes return no rows. */
  function failed(error: { message: string } | null, rows: unknown[] | null | undefined, what: string): string | null {
    if (!error && rows && rows.length > 0) return null
    return `Could not ${what}: ${error ? errorText(error) : 'you do not have permission to edit this study.'}`
  }

  // ── Schedules ────────────────────────────────────────────────────────────

  function openCreateSchedule() {
    whenClean(() => { closeForms(); setScheduleForm(BLANK_SCHEDULE_FORM); setScheduleMode('create') })
  }

  function openEditSchedule() {
    if (!selected) return
    whenClean(() => { closeForms(); setScheduleForm(scheduleToForm(selected)); setScheduleMode('edit') })
  }

  async function submitSchedule(e: React.FormEvent) {
    e.preventDefault()
    if (Object.keys(validateSchedule(scheduleForm)).length) { setScheduleShowErrors(true); return }
    setScheduleSaving(true)
    setNotice(null)
    const payload = buildSchedulePayload(scheduleForm)
    if (scheduleMode === 'create') {
      // New schedules start switched off: they have no questions yet.
      const { data, error } = await supabase.from('esm_schedules').insert({ study_id: studyId, ...payload, enabled: false }).select()
      setScheduleSaving(false)
      const problem = failed(error, data, 'create the schedule')
      if (problem) { setNotice({ tone: 'error', text: problem }); return }
      const createdSchedule = data![0] as Schedule
      setSchedules(list => [...(list ?? []), createdSchedule])
      setQuestionCounts(c => ({ ...c, [createdSchedule.id]: 0 }))
      setResponseCounts(c => ({ ...c, [createdSchedule.id]: 0 }))
      closeForms()
      setSelectedId(createdSchedule.id)
      setNotice({ tone: 'success', text: 'Schedule created. Add its questions, then switch it on.' })
    } else if (selected) {
      const { data, error } = await supabase.from('esm_schedules').update(payload).eq('id', selected.id).select('id')
      setScheduleSaving(false)
      const problem = failed(error, data, 'save the schedule')
      if (problem) { setNotice({ tone: 'error', text: problem }); return }
      setSchedules(list => (list ?? []).map(s => s.id === selected.id ? { ...s, ...payload } : s))
      closeForms()
      setNotice({ tone: 'success', text: 'Schedule saved. Phones pick it up at their next sync.' })
    }
  }

  async function toggleSchedule(s: Schedule, enabled: boolean) {
    setNotice(null)
    if (enabled && (questionCounts[s.id] ?? 0) === 0) {
      setNotice({ tone: 'error', text: 'Add at least one question before switching this schedule on.' })
      return
    }
    const { data, error } = await supabase.from('esm_schedules').update({ enabled }).eq('id', s.id).select('id')
    const problem = failed(error, data, enabled ? 'switch the schedule on' : 'switch the schedule off')
    if (problem) { setNotice({ tone: 'error', text: problem }); return }
    setSchedules(list => (list ?? []).map(x => x.id === s.id ? { ...x, enabled } : x))
  }

  function deleteSchedule(s: Schedule) {
    const responses = responseCounts[s.id]
    ask({
      title: `Delete “${s.name}”?`,
      tone: 'danger',
      confirmLabel: 'Delete schedule',
      body: <>
        <p>This deletes the schedule and its {questionCounts[s.id] ?? 0} question{questionCounts[s.id] === 1 ? '' : 's'}. Phones stop sending it at their next sync.</p>
        {!!responses && <p>The {responses.toLocaleString()} response{responses === 1 ? '' : 's'} already collected are kept, but will no longer be linked to a schedule.</p>}
      </>,
      run: async () => {
        const { data, error } = await supabase.from('esm_schedules').delete().eq('id', s.id).select('id')
        const problem = failed(error, data, 'delete the schedule')
        if (problem) return problem
        closeForms()
        applySchedules(await fetchSchedules())
        setNotice({ tone: 'success', text: `Deleted “${s.name}”.` })
      },
    })
  }

  // ── Questions ────────────────────────────────────────────────────────────

  function openAddQuestion() {
    whenClean(() => { closeForms(); setQuestionForm(BLANK_QUESTION_FORM); setQuestionEditing('new') })
  }

  function openEditQuestion(q: Question) {
    whenClean(() => { closeForms(); setQuestionForm(questionToForm(q)); setQuestionEditing(q.id) })
  }

  async function submitQuestion(e: React.FormEvent) {
    e.preventDefault()
    if (!selected || !questionEditing) return
    if (Object.keys(validateQuestion(questionForm)).length) { setQuestionShowErrors(true); return }
    setQuestionSaving(true)
    setNotice(null)
    let problem: string | null
    if (questionEditing === 'new') {
      const list = questionList ?? []
      const order = list.length ? Math.max(...list.map(q => q.question_order)) + 1 : 0
      const { data, error } = await supabase.from('esm_questions')
        .insert({ schedule_id: selected.id, ...buildQuestionPayload(questionForm, order) }).select('id')
      problem = failed(error, data, 'add the question')
    } else {
      const order = editingQuestion?.question_order ?? 0
      const { data, error } = await supabase.from('esm_questions')
        .update(buildQuestionPayload(questionForm, order)).eq('id', questionEditing).select('id')
      problem = failed(error, data, 'save the question')
    }
    setQuestionSaving(false)
    if (problem) { setNotice({ tone: 'error', text: problem }); return }
    closeForms()
    applyQuestions(await fetchQuestions(selected.id))
  }

  function deleteQuestion(q: Question, index: number) {
    if (!selected) return
    ask({
      title: `Delete question ${index + 1}?`,
      tone: 'danger',
      confirmLabel: 'Delete question',
      body: <p>“{q.question_text}” is removed from the survey at the phones&apos; next sync. Answers already collected are kept.</p>,
      run: async () => {
        const { data, error } = await supabase.from('esm_questions').delete().eq('id', q.id).select('id')
        const problem = failed(error, data, 'delete the question')
        if (problem) return problem
        if (questionEditing === q.id) closeForms()
        applyQuestions(await fetchQuestions(selected.id))
      },
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const scheduleErrors = scheduleShowErrors ? validateSchedule(scheduleForm) : {}
  const questionErrors = questionShowErrors ? validateQuestion(questionForm) : {}

  const scheduleFormCard = (
    <Card>
      <CardHeader title={scheduleMode === 'create' ? 'New schedule' : 'Edit schedule'}
        description={scheduleMode === 'create' ? 'It starts switched off. Add questions, then switch it on.' : undefined} />
      <form onSubmit={submitSchedule} noValidate>
        <ScheduleFormBody form={scheduleForm} setForm={setScheduleForm} errors={scheduleErrors} />
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          <Button type="submit" loading={scheduleSaving}>{scheduleMode === 'create' ? 'Create schedule' : 'Save schedule'}</Button>
          <Button variant="secondary" onClick={closeForms} disabled={scheduleSaving}>Cancel</Button>
        </div>
      </form>
    </Card>
  )

  const questionFormCard = (title: string) => (
    <form onSubmit={submitQuestion} noValidate className="rounded-xl border border-accent bg-surface p-4 shadow-card">
      <h4 className="mb-3 text-sm font-semibold text-fg">{title}</h4>
      <QuestionFormBody form={questionForm} setForm={setQuestionForm} errors={questionErrors} />
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        <Button type="submit" loading={questionSaving}>{questionEditing === 'new' ? 'Add question' : 'Save question'}</Button>
        <Button variant="secondary" onClick={closeForms} disabled={questionSaving}>Cancel</Button>
      </div>
    </form>
  )

  return (
    <div>
      {guardDialog}
      {confirmDialog}
      <SectionHeader title="Survey schedules"
        description="When participants are asked, and the questions they answer."
        actions={canEdit && schedules && schedules.length > 0 && scheduleMode !== 'create'
          ? <Button onClick={openCreateSchedule}><Plus size={15} aria-hidden="true" /> New schedule</Button>
          : undefined} />

      <div className="space-y-4">
        {!access.loading && !canEdit && <ReadOnlyBanner />}
        <Notice notice={notice} onClose={() => setNotice(null)} />

        {loadError ? (
          <ErrorState title="Could not load survey schedules" message={loadError}
            onRetry={async () => { setLoadError(null); applySchedules(await fetchSchedules()) }} />
        ) : schedules === null ? (
          <div role="status" aria-label="Loading schedules" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SkeletonRows rows={3} className="[&>span]:h-20" />
            <div className="space-y-3 lg:col-span-2">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        ) : schedules.length === 0 && scheduleMode !== 'create' ? (
          <EmptyState icon={<ClipboardList size={32} aria-hidden="true" />} title="No survey schedules yet"
            hint="A schedule decides when the phone notifies participants to answer a short survey.">
            {canEdit && <Button onClick={openCreateSchedule}><Plus size={15} aria-hidden="true" /> Create a schedule</Button>}
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
            {/* Schedule list */}
            <nav aria-label="Schedules" className="min-w-0">
              <ul className="space-y-2">
                {schedules.map(s => {
                  const info = scheduleTypeInfo(s.schedule_type)
                  const on = s.id === selectedId
                  const qn = questionCounts[s.id]
                  const rn = responseCounts[s.id]
                  return (
                    <li key={s.id}>
                      <button type="button" onClick={() => selectSchedule(s.id)} aria-current={on ? 'true' : undefined}
                        className={`w-full rounded-xl border bg-surface px-4 py-3 text-left shadow-card transition-colors ${on ? 'border-accent ring-1 ring-accent' : 'border-line hover:bg-sunken/60'}`}>
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0 break-words text-sm font-semibold text-fg">{s.name}</span>
                          {s.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone={info.known ? (s.schedule_type === 'random' ? 'violet' : 'blue') : 'red'}>{info.label}</Badge>
                          <span className="text-xs text-subtle">{timingSummary(s)}</span>
                        </span>
                        <span className="mt-1.5 block text-xs text-subtle">
                          {qn == null ? '—' : qn} question{qn === 1 ? '' : 's'} · {rn == null ? '—' : rn.toLocaleString()} response{rn === 1 ? '' : 's'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </nav>

            {/* Detail */}
            <div className="min-w-0 space-y-4 lg:col-span-2">
              {scheduleMode === 'create' ? scheduleFormCard : !selected ? (
                <EmptyState title="Select a schedule" hint="Choose a schedule to see its timing and questions." />
              ) : scheduleMode === 'edit' ? scheduleFormCard : (
                <Card>
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words text-base font-semibold text-fg">{selected.name}</h3>
                      {selected.description && <p className="mt-0.5 text-sm text-subtle">{selected.description}</p>}
                    </div>
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        {selectedKnown && (
                          <Button variant="secondary" size="sm" onClick={openEditSchedule}><Pencil size={13} aria-hidden="true" /> Edit</Button>
                        )}
                        <Button variant="danger-ghost" size="sm" onClick={() => deleteSchedule(selected)}><Trash2 size={13} aria-hidden="true" /> Delete</Button>
                      </div>
                    )}
                  </div>
                  {!selectedKnown && (
                    <div role="note" className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-warning-soft px-4 py-3 text-sm text-fg">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                      <p>This schedule uses a trigger the app no longer runs (“{selected.schedule_type.replace(/_/g, ' ')}”), so phones never send it. It is shown read-only. To keep asking these questions, create a new fixed or random schedule.</p>
                    </div>
                  )}
                  <Toggle checked={selected.enabled} disabled={!canEdit || !selectedKnown} onChange={v => toggleSchedule(selected, v)}
                    label="Send this survey"
                    description={selected.enabled ? 'Phones notify participants on this schedule.' : 'Switched off: phones do not send it.'} />
                  <DescriptionList className="mt-4 border-t border-line pt-4" items={[
                    { label: 'When', value: <><Badge tone={selectedKnown ? 'blue' : 'red'} className="mr-1.5">{scheduleTypeInfo(selected.schedule_type).label}</Badge>{timingSummary(selected)}</> },
                    { label: 'Expires after', value: `${selected.expiry_minutes} min` },
                    { label: 'Questions', value: questionCounts[selected.id] ?? '—' },
                    { label: 'Responses so far', value: responseCounts[selected.id] == null ? '—' : responseCounts[selected.id]!.toLocaleString() },
                  ]} />
                  <NotificationPreview className="mt-4" title={selected.notification_title} body={selected.notification_body} />
                </Card>
              )}

              {selected && scheduleMode === null && (
                <section aria-labelledby="questions-title">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 id="questions-title" className="text-sm font-semibold text-fg">
                      Questions{questionList ? ` (${questionList.length})` : ''}
                    </h3>
                    {canEdit && questionList && questionList.length > 0 && questionEditing !== 'new' && (
                      <Button variant="secondary" size="sm" onClick={openAddQuestion}><Plus size={14} aria-hidden="true" /> Add question</Button>
                    )}
                  </div>
                  {questionsError ? (
                    <ErrorState title="Could not load questions" message={questionsError}
                      onRetry={async () => applyQuestions(await fetchQuestions(selected.id))} />
                  ) : !questionList ? (
                    <SkeletonRows rows={3} />
                  ) : (
                    <div className="space-y-2">
                      {questionList.length === 0 && questionEditing !== 'new' && (
                        <EmptyState title="No questions yet" hint="Add the questions participants answer when this survey arrives.">
                          {canEdit && <Button onClick={openAddQuestion}><Plus size={15} aria-hidden="true" /> Add the first question</Button>}
                        </EmptyState>
                      )}
                      <ol className="space-y-2">
                        {questionList.map((q, i) => questionEditing === q.id ? (
                          <li key={q.id}>{questionFormCard(`Edit question ${i + 1}`)}</li>
                        ) : (
                          <li key={q.id} className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
                            <span aria-hidden="true" className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-sunken px-1 text-xs font-bold text-muted">{i + 1}</span>
                            <span className="sr-only">Question {i + 1}:</span>
                            <QuestionSummary q={q} />
                            {canEdit && (
                              <div className="flex shrink-0 gap-1">
                                <Button variant="ghost" size="sm" iconOnly aria-label={`Edit question ${i + 1}`} onClick={() => openEditQuestion(q)}>
                                  <Pencil size={14} aria-hidden="true" />
                                </Button>
                                <Button variant="danger-ghost" size="sm" iconOnly aria-label={`Delete question ${i + 1}`} onClick={() => deleteQuestion(q, i)}>
                                  <Trash2 size={14} aria-hidden="true" />
                                </Button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ol>
                      {questionEditing === 'new' && questionFormCard('New question')}
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
