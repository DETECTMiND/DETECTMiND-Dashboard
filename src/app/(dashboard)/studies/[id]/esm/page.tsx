'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import WorkspaceTabs from '@/components/workspace-tabs'
import {
  ArrowLeft, Plus, Trash2, Clock, Shuffle, AlignLeft,
  Hash, SlidersHorizontal, List, CheckSquare, ToggleLeft,
  Calendar, Bell, ClipboardList, X, Pencil, Save,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Schedule {
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

interface Question {
  id: string
  schedule_id: string
  question_order: number
  question_type: string
  question_text: string
  required: boolean
  options: string[] | null
  config: Record<string, any>
}

type ScheduleForm = {
  name: string
  description: string
  schedule_type: string
  times_of_day: string[]
  random_count: number
  random_window_start: string
  random_window_end: string
  expiry_minutes: number
  notification_title: string
  notification_body: string
}

type QuestionForm = {
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

// ─── Constants ───────────────────────────────────────────────────────────────

const SCHEDULE_TYPES = [
  { key: 'fixed',  label: 'Fixed Times', icon: Clock,   description: 'Specific times each day' },
  { key: 'random', label: 'Random',      icon: Shuffle, description: 'Random within a window' },
]

const QUESTION_TYPES = [
  { key: 'likert',        label: 'Likert Scale',  icon: SlidersHorizontal },
  { key: 'slider',        label: 'Slider',        icon: SlidersHorizontal },
  { key: 'text',          label: 'Open Text',     icon: AlignLeft },
  { key: 'number',        label: 'Number',        icon: Hash },
  { key: 'single_choice', label: 'Single Choice', icon: List },
  { key: 'multi_choice',  label: 'Multi Choice',  icon: CheckSquare },
  { key: 'yes_no',        label: 'Yes / No',      icon: ToggleLeft },
  { key: 'time',          label: 'Time',          icon: Clock },
  { key: 'date',          label: 'Date',          icon: Calendar },
]

const TYPE_BADGE: Record<string, string> = {
  fixed:  'bg-blue-50 text-blue-700 border-blue-100',
  random: 'bg-violet-50 text-violet-700 border-violet-100',
}

const BLANK_SCHEDULE_FORM: ScheduleForm = {
  name: '', description: '', schedule_type: 'fixed',
  times_of_day: ['09:00', '12:00', '18:00'],
  random_count: 5, random_window_start: '08:00', random_window_end: '22:00',
  expiry_minutes: 60,
  notification_title: 'Survey Available',
  notification_body: 'Please take a moment to complete a short survey.',
}

const BLANK_QUESTION_FORM: QuestionForm = {
  question_type: 'likert', question_text: '', required: true,
  options: '', min: 1, max: 7, step: 1,
  label_min: '', label_max: '',
}

const inputCls = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all bg-white placeholder-gray-400'
const smallInputCls = 'w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all bg-white'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scheduleToForm(s: Schedule): ScheduleForm {
  return {
    name: s.name,
    description: s.description || '',
    schedule_type: s.schedule_type === 'event_triggered' ? 'fixed' : s.schedule_type,
    times_of_day: s.times_of_day?.length ? s.times_of_day : ['09:00'],
    random_count: s.random_count ?? 5,
    random_window_start: s.random_window_start ?? '08:00',
    random_window_end: s.random_window_end ?? '22:00',
    expiry_minutes: s.expiry_minutes,
    notification_title: s.notification_title,
    notification_body: s.notification_body,
  }
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

function timingSummary(s: Schedule) {
  if (s.schedule_type === 'fixed') {
    return (s.times_of_day || []).join(' · ') || '—'
  }
  if (s.schedule_type === 'random') {
    return `${s.random_count}× between ${s.random_window_start}–${s.random_window_end}`
  }
  return '—'
}

function buildSchedulePayload(f: ScheduleForm) {
  return {
    name: f.name,
    description: f.description || null,
    schedule_type: f.schedule_type,
    times_of_day: f.schedule_type === 'fixed' ? f.times_of_day.filter(Boolean) : null,
    random_count: f.schedule_type === 'random' ? f.random_count : null,
    random_window_start: f.schedule_type === 'random' ? f.random_window_start : null,
    random_window_end: f.schedule_type === 'random' ? f.random_window_end : null,
    expiry_minutes: f.expiry_minutes,
    notification_title: f.notification_title,
    notification_body: f.notification_body,
  }
}

function buildQuestionPayload(f: QuestionForm, order: number) {
  const opts = ['single_choice', 'multi_choice'].includes(f.question_type) && f.options
    ? f.options.split(',').map(o => o.trim()).filter(Boolean)
    : null
  const cfg = ['likert', 'slider', 'number'].includes(f.question_type)
    ? {
        min: f.min, max: f.max, step: f.step,
        label_min: f.label_min.trim() || null,
        label_max: f.label_max.trim() || null,
      }
    : {}
  return {
    question_type: f.question_type,
    question_text: f.question_text,
    required: f.required,
    options: opts,
    config: cfg,
    question_order: order,
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-blue-500' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  )
}

// Segmented control for schedule type
function ScheduleTypeSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-xl">
      {SCHEDULE_TYPES.map(t => {
        const active = value === t.key
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-lg transition-all text-center ${
              active ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon size={15} className={active ? 'text-blue-600' : 'text-gray-400'} />
            <span className="text-xs font-semibold leading-tight">{t.label}</span>
            <span className="text-[10px] text-gray-400 leading-tight hidden sm:block">{t.description}</span>
          </button>
        )
      })}
    </div>
  )
}

// Individual time pickers with add/remove
function TimePicker({
  times,
  onChange,
}: {
  times: string[]
  onChange: (t: string[]) => void
}) {
  function update(i: number, val: string) {
    const next = [...times]
    next[i] = val
    onChange(next.slice().sort())
  }
  function remove(i: number) {
    onChange(times.filter((_, idx) => idx !== i))
  }
  function add() {
    onChange([...times, '12:00'].sort())
  }

  return (
    <div className="space-y-2">
      {times.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="time"
            value={t}
            onChange={e => update(i, e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all bg-white"
          />
          <span className="text-xs text-gray-400">{formatTime12(t)}</span>
          {times.length > 1 && (
            <button
              type="button"
              onClick={() => remove(i)}
              className="ml-auto text-gray-300 hover:text-red-400 transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-semibold transition-colors mt-1"
      >
        <Plus size={12} /> Add time
      </button>
    </div>
  )
}

function formatTime12(t: string) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// Horizontal pill selector for question types
function QuestionTypePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {QUESTION_TYPES.map(t => {
        const active = value === t.key
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
              active
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <t.icon size={11} />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

// Scale preview (numbered boxes)
function ScalePreview({ min, max, step, labelMin, labelMax }: {
  min: number; max: number; step: number; labelMin?: string; labelMax?: string
}) {
  const values: number[] = []
  for (let v = min; v <= max; v += step) {
    values.push(v)
    if (values.length >= 10) break
  }
  const overflow = Math.ceil((max - min) / step) + 1 > 10

  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {values.map(v => (
          <div
            key={v}
            className="w-8 h-8 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-xs font-semibold text-gray-600"
          >
            {v}
          </div>
        ))}
        {overflow && <span className="text-xs text-gray-400">… {max}</span>}
      </div>
      {(labelMin || labelMax) && (
        <div className="flex justify-between mt-1 px-0.5">
          <span className="text-[11px] text-gray-400">{labelMin || min}</span>
          <span className="text-[11px] text-gray-400">{labelMax || max}</span>
        </div>
      )}
    </div>
  )
}

function ScheduleFormBody({ form, setForm }: { form: ScheduleForm; setForm: (f: ScheduleForm) => void }) {
  const set = (patch: Partial<ScheduleForm>) => setForm({ ...form, ...patch })

  return (
    <div className="space-y-6">
      {/* Name + Description */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Name *</label>
          <input
            value={form.name}
            onChange={e => set({ name: e.target.value })}
            required
            placeholder="e.g. Morning Check-in"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Description</label>
          <input
            value={form.description}
            onChange={e => set({ description: e.target.value })}
            placeholder="Internal notes (optional)"
            className={inputCls}
          />
        </div>
      </div>

      {/* Schedule type */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Trigger</label>
        <ScheduleTypeSelector value={form.schedule_type} onChange={v => set({ schedule_type: v })} />
      </div>

      {/* Type-specific fields */}
      {form.schedule_type === 'fixed' && (
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
            Times of Day
          </label>
          <TimePicker
            times={form.times_of_day}
            onChange={t => set({ times_of_day: t })}
          />
        </div>
      )}

      {form.schedule_type === 'random' && (
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
              Prompts / day
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={form.random_count}
              onChange={e => set({ random_count: parseInt(e.target.value) || 1 })}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
              Window start
            </label>
            <input
              type="time"
              value={form.random_window_start}
              onChange={e => set({ random_window_start: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
              Window end
            </label>
            <input
              type="time"
              value={form.random_window_end}
              onChange={e => set({ random_window_end: e.target.value })}
              className={inputCls}
            />
          </div>
        </div>
      )}

      {/* Expiry */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
            Survey Expiry (minutes)
          </label>
          <input
            type="number"
            min={1}
            value={form.expiry_minutes}
            onChange={e => set({ expiry_minutes: parseInt(e.target.value) || 1 })}
            className={inputCls}
          />
          <p className="text-xs text-gray-400 mt-1">Participant must respond within this window</p>
        </div>
      </div>

      {/* Notification */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
          <Bell size={13} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Push Notification</span>
          <span className="ml-auto text-xs text-gray-400">Shown to participants</span>
        </div>
        <div className="p-4 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Title</label>
            <input
              value={form.notification_title}
              onChange={e => set({ notification_title: e.target.value })}
              className={smallInputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Body</label>
            <input
              value={form.notification_body}
              onChange={e => set({ notification_body: e.target.value })}
              className={smallInputCls}
            />
          </div>
        </div>
        {/* Notification preview */}
        {(form.notification_title || form.notification_body) && (
          <div className="mx-4 mb-4 bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-3 flex items-start gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
              <Bell size={13} className="text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-800 leading-tight">
                {form.notification_title || '—'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5 leading-snug line-clamp-2">
                {form.notification_body || '—'}
              </p>
            </div>
            <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">now</span>
          </div>
        )}
      </div>
    </div>
  )
}

function QuestionFormBody({ form, setForm }: { form: QuestionForm; setForm: (f: QuestionForm) => void }) {
  const set = (patch: Partial<QuestionForm>) => setForm({ ...form, ...patch })
  const isScale = ['likert', 'slider', 'number'].includes(form.question_type)
  const isChoice = ['single_choice', 'multi_choice'].includes(form.question_type)

  return (
    <div className="space-y-4">
      {/* Question type */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Question Type
        </label>
        <QuestionTypePicker value={form.question_type} onChange={v => set({ question_type: v })} />
      </div>

      {/* Question text */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
          Question Text *
        </label>
        <textarea
          value={form.question_text}
          onChange={e => set({ question_text: e.target.value })}
          required
          rows={2}
          placeholder="e.g. How are you feeling right now?"
          className={`${inputCls} resize-none`}
        />
      </div>

      {/* Scale config */}
      {isScale && (
        <div className="space-y-3 rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Scale</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Min</label>
              <input
                type="number"
                value={form.min}
                onChange={e => set({ min: parseInt(e.target.value) || 0 })}
                className={smallInputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Max</label>
              <input
                type="number"
                value={form.max}
                onChange={e => set({ max: parseInt(e.target.value) || 1 })}
                className={smallInputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Step</label>
              <input
                type="number"
                value={form.step}
                min={1}
                onChange={e => set({ step: parseInt(e.target.value) || 1 })}
                className={smallInputCls}
              />
            </div>
          </div>
          {form.question_type !== 'number' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Min label <span className="text-gray-400">(optional)</span></label>
                <input
                  value={form.label_min}
                  onChange={e => set({ label_min: e.target.value })}
                  placeholder="e.g. Not at all"
                  className={smallInputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Max label <span className="text-gray-400">(optional)</span></label>
                <input
                  value={form.label_max}
                  onChange={e => set({ label_max: e.target.value })}
                  placeholder="e.g. Extremely"
                  className={smallInputCls}
                />
              </div>
            </div>
          )}
          <ScalePreview
            min={form.min} max={form.max} step={form.step}
            labelMin={form.label_min} labelMax={form.label_max}
          />
        </div>
      )}

      {/* Choice options */}
      {isChoice && (
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
            Options <span className="font-normal text-gray-400 normal-case">(comma-separated)</span>
          </label>
          <input
            value={form.options}
            onChange={e => set({ options: e.target.value })}
            placeholder="Strongly agree, Agree, Neutral, Disagree, Strongly disagree"
            className={inputCls}
          />
          {form.options && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {form.options.split(',').map(o => o.trim()).filter(Boolean).map((o, i) => (
                <span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2.5 py-1 rounded-full font-medium">
                  {o}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Required toggle */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
        <Toggle checked={form.required} onChange={v => set({ required: v })} />
        <span className="text-sm text-gray-700 font-medium">Required</span>
      </label>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ESMPage() {
  const { id: studyId } = useParams()
  const supabase = createClient()

  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({})

  const [showCreateSchedule, setShowCreateSchedule] = useState(false)
  const [createScheduleForm, setCreateScheduleForm] = useState<ScheduleForm>(BLANK_SCHEDULE_FORM)
  const [editingSchedule, setEditingSchedule] = useState(false)
  const [editScheduleForm, setEditScheduleForm] = useState<ScheduleForm>(BLANK_SCHEDULE_FORM)

  const [showAddQuestion, setShowAddQuestion] = useState(false)
  const [addQuestionForm, setAddQuestionForm] = useState<QuestionForm>(BLANK_QUESTION_FORM)
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
  const [editQuestionForm, setEditQuestionForm] = useState<QuestionForm>(BLANK_QUESTION_FORM)

  // ── Data loading ───────────────────────────────────────────────────────────

  async function loadSchedules() {
    const { data } = await supabase
      .from('esm_schedules').select('*').eq('study_id', studyId).order('created_at')
    const list = (data || []) as Schedule[]
    setSchedules(list)
    if (list.length > 0 && !selectedSchedule) setSelectedSchedule(list[0])
    const counts: Record<string, number> = {}
    await Promise.all(list.map(async s => {
      const { count } = await supabase
        .from('esm_questions').select('*', { count: 'exact', head: true }).eq('schedule_id', s.id)
      counts[s.id] = count || 0
    }))
    setQuestionCounts(counts)
  }

  async function loadQuestions(scheduleId: string) {
    const { data } = await supabase
      .from('esm_questions').select('*').eq('schedule_id', scheduleId).order('question_order')
    setQuestions((data || []) as Question[])
  }

  useEffect(() => { loadSchedules() }, [studyId])
  useEffect(() => {
    if (selectedSchedule) {
      setEditingSchedule(false)
      setShowAddQuestion(false)
      setEditingQuestionId(null)
      loadQuestions(selectedSchedule.id)
    }
  }, [selectedSchedule?.id])

  // ── Schedule actions ───────────────────────────────────────────────────────

  async function createSchedule(e: React.FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.from('esm_schedules')
      .insert({ study_id: studyId, ...buildSchedulePayload(createScheduleForm) })
      .select().single()
    if (!error) {
      setShowCreateSchedule(false)
      setCreateScheduleForm(BLANK_SCHEDULE_FORM)
      await loadSchedules()
      if (data) setSelectedSchedule(data as Schedule)
    }
  }

  async function saveScheduleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedSchedule) return
    const payload = buildSchedulePayload(editScheduleForm)
    const { error } = await supabase.from('esm_schedules').update(payload).eq('id', selectedSchedule.id)
    if (!error) {
      const updated = { ...selectedSchedule, ...payload } as Schedule
      setSchedules(prev => prev.map(s => s.id === updated.id ? updated : s))
      setSelectedSchedule(updated)
      setEditingSchedule(false)
    }
  }

  async function toggleSchedule(s: Schedule) {
    await supabase.from('esm_schedules').update({ enabled: !s.enabled }).eq('id', s.id)
    const updated = { ...s, enabled: !s.enabled }
    setSchedules(prev => prev.map(x => x.id === s.id ? updated : x))
    if (selectedSchedule?.id === s.id) setSelectedSchedule(updated)
  }

  async function deleteSchedule(id: string) {
    if (!confirm('Delete this schedule and all its questions?')) return
    await supabase.from('esm_schedules').delete().eq('id', id)
    const { data } = await supabase
      .from('esm_schedules').select('*').eq('study_id', studyId).order('created_at')
    const list = (data || []) as Schedule[]
    setSchedules(list)
    const next = list[0] ?? null
    setSelectedSchedule(next)
    if (next) loadQuestions(next.id)
    else setQuestions([])
    const counts: Record<string, number> = {}
    await Promise.all(list.map(async s => {
      const { count } = await supabase
        .from('esm_questions').select('*', { count: 'exact', head: true }).eq('schedule_id', s.id)
      counts[s.id] = count || 0
    }))
    setQuestionCounts(counts)
  }

  // ── Question actions ───────────────────────────────────────────────────────

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedSchedule) return
    const nextOrder = questions.length > 0
      ? Math.max(...questions.map(q => q.question_order)) + 1
      : 0
    await supabase.from('esm_questions').insert({
      schedule_id: selectedSchedule.id,
      ...buildQuestionPayload(addQuestionForm, nextOrder),
    })
    setShowAddQuestion(false)
    setAddQuestionForm(BLANK_QUESTION_FORM)
    loadQuestions(selectedSchedule.id)
    setQuestionCounts(c => ({ ...c, [selectedSchedule.id]: (c[selectedSchedule.id] || 0) + 1 }))
  }

  async function saveQuestionEdit(e: React.FormEvent, q: Question) {
    e.preventDefault()
    const scheduleId = selectedSchedule?.id
    if (!scheduleId) return
    await supabase.from('esm_questions')
      .update(buildQuestionPayload(editQuestionForm, q.question_order))
      .eq('id', q.id)
    setEditingQuestionId(null)
    loadQuestions(scheduleId)
  }

  async function deleteQuestion(qId: string) {
    const scheduleId = selectedSchedule?.id
    if (!scheduleId) return
    await supabase.from('esm_questions').delete().eq('id', qId)
    loadQuestions(scheduleId)
    setQuestionCounts(c => ({
      ...c,
      [scheduleId]: Math.max(0, (c[scheduleId] || 1) - 1),
    }))
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <Link
          href={`/studies/${studyId}`}
          className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors mb-4"
        >
          <ArrowLeft size={15} /> Back to Study
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ESM / EMA Config</h1>
            <p className="text-gray-500 text-sm mt-0.5">Experience sampling schedules and survey questions</p>
          </div>
          {!showCreateSchedule && (
            <button
              onClick={() => { setShowCreateSchedule(true); setCreateScheduleForm(BLANK_SCHEDULE_FORM) }}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
            >
              <Plus size={15} /> New Schedule
            </button>
          )}
        </div>
      </div>

      <WorkspaceTabs label="Survey sections" items={[{ label: 'Responses', href: `/studies/${studyId}/esm-responses` }, { label: 'Setup', href: `/studies/${studyId}/esm` }]} />

      {/* Create schedule panel */}
      {showCreateSchedule && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">New Schedule</h2>
            <button
              onClick={() => setShowCreateSchedule(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"
            >
              <X size={18} />
            </button>
          </div>
          <form onSubmit={createSchedule} className="px-6 py-5 space-y-5">
            <ScheduleFormBody form={createScheduleForm} setForm={setCreateScheduleForm} />
            <div className="flex gap-3 pt-2 border-t border-gray-100">
              <button
                type="submit"
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                <Plus size={14} /> Create Schedule
              </button>
              <button
                type="button"
                onClick={() => setShowCreateSchedule(false)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

        {/* Left: schedule list */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">
            Schedules · {schedules.length}
          </p>

          {schedules.length === 0 ? (
            <div className="bg-white border border-dashed border-gray-200 rounded-xl py-10 text-center">
              <ClipboardList size={28} className="mx-auto text-gray-300 mb-2" />
              <p className="text-gray-400 text-sm font-medium">No schedules yet</p>
              <button
                onClick={() => setShowCreateSchedule(true)}
                className="mt-2 text-blue-600 text-sm font-semibold hover:text-blue-700 transition-colors"
              >
                + Create one
              </button>
            </div>
          ) : schedules.map(s => {
            const typeInfo = SCHEDULE_TYPES.find(t => t.key === s.schedule_type)!
            const isSelected = selectedSchedule?.id === s.id
            return (
              <div
                key={s.id}
                onClick={() => { setSelectedSchedule(s); setEditingSchedule(false) }}
                className={`group bg-white rounded-xl border cursor-pointer transition-all overflow-hidden ${
                  isSelected
                    ? 'border-blue-400 ring-1 ring-blue-100 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                }`}
              >
                <div className="px-4 py-3.5">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="font-semibold text-sm text-gray-800 truncate">{s.name}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${TYPE_BADGE[s.schedule_type]}`}>
                          {typeInfo.label}
                        </span>
                        <span className="text-xs text-gray-400 truncate">{timingSummary(s)}</span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        {questionCounts[s.id] ?? 0} {(questionCounts[s.id] ?? 0) === 1 ? 'question' : 'questions'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0 mt-0.5">
                      <Toggle checked={s.enabled} onChange={e => { e; toggleSchedule(s) }} />
                      <button
                        onClick={e => { e.stopPropagation(); deleteSchedule(s.id) }}
                        className="text-gray-200 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
                {isSelected && <div className="h-0.5 bg-blue-500" />}
              </div>
            )
          })}
        </div>

        {/* Right: detail + questions */}
        <div className="lg:col-span-2 space-y-4">

          {!selectedSchedule ? (
            <div className="bg-white border border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center py-24 text-center">
              <ClipboardList size={36} className="text-gray-300 mb-3" />
              <p className="text-gray-500 font-medium">Select a schedule</p>
              <p className="text-gray-400 text-sm mt-1">Choose a schedule on the left to manage its questions</p>
            </div>
          ) : editingSchedule ? (

            /* Edit schedule */
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                  <Pencil size={14} className="text-gray-500" />
                  <h2 className="font-semibold text-gray-900 text-sm">Edit Schedule</h2>
                </div>
                <button
                  onClick={() => setEditingSchedule(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"
                >
                  <X size={16} />
                </button>
              </div>
              <form onSubmit={saveScheduleEdit} className="px-6 py-5 space-y-5">
                <ScheduleFormBody form={editScheduleForm} setForm={setEditScheduleForm} />
                <div className="flex gap-3 pt-2 border-t border-gray-100">
                  <button
                    type="submit"
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
                  >
                    <Save size={14} /> Save Changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingSchedule(false)}
                    className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSchedule(selectedSchedule.id)}
                    className="ml-auto flex items-center gap-1.5 px-4 py-2 text-red-500 hover:bg-red-50 border border-red-200 rounded-lg text-sm transition-colors"
                  >
                    <Trash2 size={13} /> Delete Schedule
                  </button>
                </div>
              </form>
            </div>

          ) : (

            /* Schedule detail card */
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-bold text-gray-900 text-base">{selectedSchedule.name}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${TYPE_BADGE[selectedSchedule.schedule_type]}`}>
                      {SCHEDULE_TYPES.find(t => t.key === selectedSchedule.schedule_type)?.label}
                    </span>
                    <span className={`text-xs font-medium ${selectedSchedule.enabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {selectedSchedule.enabled ? '● Active' : '○ Paused'}
                    </span>
                  </div>
                  {selectedSchedule.description && (
                    <p className="text-gray-400 text-xs mt-1">{selectedSchedule.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Toggle
                    checked={selectedSchedule.enabled}
                    onChange={() => toggleSchedule(selectedSchedule)}
                  />
                  <button
                    onClick={() => {
                      setEditScheduleForm(scheduleToForm(selectedSchedule))
                      setEditingSchedule(true)
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-all"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                </div>
              </div>

              {/* Summary row */}
              <div className="grid grid-cols-3 gap-0 border-t border-gray-100">
                <div className="px-5 py-3 border-r border-gray-100">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Timing</p>
                  <p className="text-sm text-gray-800 font-medium">{timingSummary(selectedSchedule)}</p>
                </div>
                <div className="px-5 py-3 border-r border-gray-100">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Expiry</p>
                  <p className="text-sm text-gray-800 font-medium">{selectedSchedule.expiry_minutes} min</p>
                </div>
                <div className="px-5 py-3">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Questions</p>
                  <p className="text-sm text-gray-800 font-medium">{questions.length}</p>
                </div>
              </div>

              {/* Notification preview */}
              <div className="border-t border-gray-100 px-5 py-3 bg-gray-50 flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
                  <Bell size={13} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 leading-tight truncate">
                    {selectedSchedule.notification_title}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-snug line-clamp-1">
                    {selectedSchedule.notification_body}
                  </p>
                </div>
                <span className="text-[10px] text-gray-400 shrink-0 font-medium">Notification</span>
              </div>
            </div>
          )}

          {/* Questions section */}
          {selectedSchedule && !editingSchedule && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  Questions · {questions.length}
                </p>
                {!showAddQuestion && !editingQuestionId && (
                  <button
                    onClick={() => { setShowAddQuestion(true); setAddQuestionForm(BLANK_QUESTION_FORM) }}
                    className="flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-semibold transition-colors"
                  >
                    <Plus size={14} /> Add Question
                  </button>
                )}
              </div>

              {questions.length === 0 && !showAddQuestion ? (
                <div className="bg-white border border-dashed border-gray-200 rounded-xl py-12 text-center">
                  <ClipboardList size={28} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-gray-500 text-sm font-medium">No questions yet</p>
                  <p className="text-gray-400 text-xs mt-1">Add questions participants will answer</p>
                  <button
                    onClick={() => setShowAddQuestion(true)}
                    className="mt-3 text-blue-600 text-sm font-semibold hover:text-blue-700 transition-colors"
                  >
                    + Add the first question
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {questions.map((q, i) => {
                    const typeInfo = QUESTION_TYPES.find(t => t.key === q.question_type)
                    const isEditing = editingQuestionId === q.id

                    if (isEditing) {
                      return (
                        <div key={q.id} className="bg-white rounded-xl border-2 border-blue-400 shadow-sm overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-blue-50">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 bg-blue-100 rounded-md flex items-center justify-center">
                                <span className="text-xs font-bold text-blue-600">Q{i + 1}</span>
                              </div>
                              <p className="font-semibold text-sm text-blue-900">Edit Question</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setEditingQuestionId(null)}
                              className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                              <X size={16} />
                            </button>
                          </div>
                          <form onSubmit={e => saveQuestionEdit(e, q)} className="px-4 py-4 space-y-4">
                            <QuestionFormBody form={editQuestionForm} setForm={setEditQuestionForm} />
                            <div className="flex gap-2 pt-1 border-t border-gray-100">
                              <button
                                type="submit"
                                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                              >
                                <Save size={13} /> Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingQuestionId(null)}
                                className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => { deleteQuestion(q.id); setEditingQuestionId(null) }}
                                className="ml-auto flex items-center gap-1.5 px-3 py-2 text-red-500 hover:bg-red-50 border border-red-200 rounded-lg text-sm transition-colors"
                              >
                                <Trash2 size={13} /> Delete
                              </button>
                            </div>
                          </form>
                        </div>
                      )
                    }

                    return (
                      <div
                        key={q.id}
                        className="bg-white rounded-xl border border-gray-200 px-4 py-3.5 flex items-start gap-3 group hover:border-gray-300 hover:shadow-sm transition-all"
                      >
                        <div className="w-6 h-6 bg-gray-100 rounded-md flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-xs font-bold text-gray-500">Q{i + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                              {typeInfo && <typeInfo.icon size={10} />}
                              {typeInfo?.label || q.question_type}
                            </span>
                            {q.required && (
                              <span className="text-[11px] text-red-500 font-semibold">Required</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-800 leading-snug">{q.question_text}</p>

                          {/* Scale summary */}
                          {q.config?.min !== undefined && (
                            <div className="mt-2">
                              <div className="flex items-center gap-1 flex-wrap">
                                {Array.from(
                                  { length: Math.min(Math.ceil((q.config.max - q.config.min) / (q.config.step || 1)) + 1, 10) },
                                  (_, idx) => q.config.min + idx * (q.config.step || 1)
                                ).map(v => (
                                  <span key={v} className="w-6 h-6 rounded border border-gray-200 bg-gray-50 flex items-center justify-center text-[10px] font-semibold text-gray-500">
                                    {v}
                                  </span>
                                ))}
                                {Math.ceil((q.config.max - q.config.min) / (q.config.step || 1)) >= 10 && (
                                  <span className="text-[10px] text-gray-400">…{q.config.max}</span>
                                )}
                              </div>
                              {(q.config.label_min || q.config.label_max) && (
                                <div className="flex gap-4 mt-0.5">
                                  {q.config.label_min && (
                                    <span className="text-[11px] text-gray-400">{q.config.label_min}</span>
                                  )}
                                  {q.config.label_max && (
                                    <span className="text-[11px] text-gray-400 ml-auto">{q.config.label_max}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Choice options */}
                          {q.options && (q.options as string[]).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {(q.options as string[]).map((o, j) => (
                                <span key={j} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-0.5 rounded-full font-medium">
                                  {o}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
                          <button
                            onClick={() => {
                              setEditingQuestionId(q.id)
                              setEditQuestionForm(questionToForm(q))
                              setShowAddQuestion(false)
                            }}
                            className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => deleteQuestion(q.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Add question form */}
              {showAddQuestion && (
                <form onSubmit={addQuestion} className="mt-2 bg-white rounded-xl border-2 border-blue-300 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-blue-50">
                    <p className="font-semibold text-sm text-blue-900">New Question</p>
                    <button
                      type="button"
                      onClick={() => setShowAddQuestion(false)}
                      className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="px-4 py-4">
                    <QuestionFormBody form={addQuestionForm} setForm={setAddQuestionForm} />
                  </div>
                  <div className="flex gap-2 px-4 pb-4">
                    <button
                      type="submit"
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
                    >
                      <Plus size={13} /> Add Question
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddQuestion(false)}
                      className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
