'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useRef, useState, Suspense } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import WorkspaceTabs from '@/components/workspace-tabs'
import {
  ArrowLeft, Download, Users, Search, Check, X, ChevronDown,
  ClipboardList, ChevronRight, ChevronUp, Clock, CheckCircle2, AlertTriangle,
} from 'lucide-react'

interface Participant {
  id: string
  device_id: string
  label: string | null
}

interface Schedule {
  id: string
  name: string
  schedule_type: string
}

interface Question {
  id: string
  schedule_id: string
  question_order: number
  question_text: string
  question_type: string
}

interface ESMResponse {
  id: number
  participant_id: string
  schedule_id: string | null
  triggered_at: string
  responded_at: string | null
  expired: boolean
  responses: Record<string, unknown> | null
  recorded_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function participantName(p: Participant) {
  return p.label || p.device_id
}

function avatarInitial(name: string) { return name.charAt(0).toUpperCase() }

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700', 'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700',
]

function avatarColor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch { return ts }
}

function responseTime(triggered: string, responded: string | null) {
  if (!responded) return null
  const diff = new Date(responded).getTime() - new Date(triggered).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return '< 1 min'
  if (mins < 60) return `${mins} min`
  return `${Math.round(mins / 60)}h ${mins % 60}m`
}

// ─── Participant Picker ───────────────────────────────────────────────────────

function ParticipantPicker({
  participants, value, onChange,
}: {
  participants: Participant[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const filtered = participants.filter(p =>
    participantName(p).toLowerCase().includes(query.toLowerCase()) ||
    p.device_id.toLowerCase().includes(query.toLowerCase())
  )

  const selected = participants.find(p => p.id === value)
  const label = selected ? participantName(selected) : 'All Participants'

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => { setOpen(o => !o); setQuery('') }}
        className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-sm bg-white hover:bg-gray-50 focus:outline-none transition-all min-w-56 ${
          selected ? 'border-blue-300 ring-2 ring-blue-100' : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        {selected ? (
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarColor(selected.id)}`}>
            {avatarInitial(label)}
          </span>
        ) : (
          <Users size={14} className="text-gray-400 shrink-0" />
        )}
        <span className="flex-1 text-left text-gray-700 font-medium truncate">{label}</span>
        {selected && (
          <span
            role="button"
            onClick={e => { e.stopPropagation(); onChange('all'); setOpen(false) }}
            className="text-gray-300 hover:text-gray-500 transition-colors cursor-pointer shrink-0"
          >
            <X size={13} />
          </span>
        )}
        <ChevronDown size={13} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 bg-white rounded-xl border border-gray-200 shadow-xl z-50 w-72 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
              <Search size={12} className="text-gray-400 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search participants…"
                className="flex-1 text-xs bg-transparent outline-none text-gray-700 placeholder-gray-400"
              />
              {query && <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600"><X size={11} /></button>}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {!query && (
              <button
                onClick={() => { onChange('all'); setOpen(false); setQuery('') }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${value === 'all' ? 'bg-blue-50' : ''}`}
              >
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <Users size={13} className="text-gray-500" />
                </div>
                <span className={`text-sm font-semibold flex-1 ${value === 'all' ? 'text-blue-700' : 'text-gray-700'}`}>All Participants</span>
                {value === 'all' && <Check size={13} className="text-blue-600 shrink-0" />}
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-5 text-xs text-gray-400 text-center">No participants match</p>
            ) : filtered.map(p => {
              const name = participantName(p)
              const active = value === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => { onChange(p.id); setOpen(false); setQuery('') }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${active ? 'bg-blue-50' : ''}`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarColor(p.id)}`}>
                    {avatarInitial(name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${active ? 'text-blue-700' : 'text-gray-700'}`}>{name}</p>
                    {p.label && <p className="text-[11px] text-gray-400 truncate font-mono">{p.device_id}</p>}
                  </div>
                  {active && <Check size={13} className="text-blue-600 shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Schedule Filter ──────────────────────────────────────────────────────────

function SchedulePicker({
  schedules, value, onChange,
}: {
  schedules: Schedule[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const selected = schedules.find(s => s.id === value)
  const label = selected ? selected.name : 'All Schedules'

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-sm bg-white hover:bg-gray-50 focus:outline-none transition-all min-w-44 ${
          selected ? 'border-violet-300 ring-2 ring-violet-100' : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <ClipboardList size={14} className={selected ? 'text-violet-500 shrink-0' : 'text-gray-400 shrink-0'} />
        <span className="flex-1 text-left text-gray-700 font-medium truncate">{label}</span>
        {selected && (
          <span
            role="button"
            onClick={e => { e.stopPropagation(); onChange('all'); setOpen(false) }}
            className="text-gray-300 hover:text-gray-500 transition-colors cursor-pointer shrink-0"
          >
            <X size={13} />
          </span>
        )}
        <ChevronDown size={13} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 bg-white rounded-xl border border-gray-200 shadow-xl z-50 w-56 overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            <button
              onClick={() => { onChange('all'); setOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${value === 'all' ? 'bg-violet-50' : ''}`}
            >
              <span className={`text-sm font-semibold flex-1 ${value === 'all' ? 'text-violet-700' : 'text-gray-700'}`}>All Schedules</span>
              {value === 'all' && <Check size={13} className="text-violet-600 shrink-0" />}
            </button>
            {schedules.map(s => {
              const active = value === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => { onChange(s.id); setOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${active ? 'bg-violet-50' : ''}`}
                >
                  <span className={`text-sm font-medium flex-1 truncate ${active ? 'text-violet-700' : 'text-gray-700'}`}>{s.name}</span>
                  {active && <Check size={13} className="text-violet-600 shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Response Row ─────────────────────────────────────────────────────────────

function ResponseRow({
  row, participant, schedule, questions, showParticipant,
}: {
  row: ESMResponse
  participant: Participant | undefined
  schedule: Schedule | undefined
  questions: Question[]
  showParticipant: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const name = participant ? participantName(participant) : row.participant_id
  const responseCount = row.responses ? Object.keys(row.responses).length : 0
  const elapsed = responseTime(row.triggered_at, row.responded_at)

  const scheduleQuestions = questions.filter(q => q.schedule_id === row.schedule_id)
    .sort((a, b) => a.question_order - b.question_order)

  return (
    <>
      <tr
        className={`hover:bg-blue-50/30 transition-colors cursor-pointer ${expanded ? 'bg-blue-50/20' : ''}`}
        onClick={() => { if (responseCount > 0) setExpanded(e => !e) }}
      >
        {showParticipant && (
          <td className="px-4 py-3 whitespace-nowrap">
            <div className="flex items-center gap-2">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${participant ? avatarColor(participant.id) : 'bg-gray-100 text-gray-500'}`}>
                {avatarInitial(name)}
              </span>
              <span className="text-xs text-gray-700 font-medium truncate max-w-28">{name}</span>
            </div>
          </td>
        )}
        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
          {schedule ? (
            <span className="font-medium text-gray-700">{schedule.name}</span>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </td>
        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
          {fmtDate(row.triggered_at)}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          {row.expired ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
              <AlertTriangle size={10} /> Expired
            </span>
          ) : row.responded_at ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
              <CheckCircle2 size={10} /> Responded
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-gray-50 text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full">
              <Clock size={10} /> Pending
            </span>
          )}
        </td>
        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-400">
          {elapsed ?? '—'}
        </td>
        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-400">
          {responseCount > 0 ? (
            <div className="flex items-center gap-1">
              <span>{responseCount} answer{responseCount !== 1 ? 's' : ''}</span>
              <span className="text-gray-300">
                {expanded ? <ChevronUp size={12} /> : <ChevronRight size={12} />}
              </span>
            </div>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </td>
      </tr>

      {expanded && row.responses && responseCount > 0 && (
        <tr className="bg-blue-50/30">
          <td colSpan={showParticipant ? 6 : 5} className="px-4 pb-3 pt-0">
            <div className="ml-2 border-l-2 border-blue-200 pl-4 space-y-2 py-2">
              {scheduleQuestions.length > 0 ? (
                scheduleQuestions.map((q, i) => {
                  const answer = row.responses?.[q.id]
                  return (
                    <div key={q.id} className="flex items-start gap-3">
                      <span className="text-[10px] font-bold text-blue-400 bg-blue-100 rounded px-1.5 py-0.5 shrink-0 mt-0.5">Q{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-500 mb-0.5">{q.question_text}</p>
                        <p className="text-sm font-medium text-gray-800">
                          {answer === null || answer === undefined
                            ? <span className="text-gray-300 font-normal">—</span>
                            : typeof answer === 'object'
                              ? JSON.stringify(answer)
                              : String(answer)}
                        </p>
                      </div>
                    </div>
                  )
                })
              ) : (
                Object.entries(row.responses).map(([qId, answer]) => (
                  <div key={qId} className="flex items-start gap-3">
                    <span className="text-[10px] font-mono text-blue-400 bg-blue-100 rounded px-1.5 py-0.5 shrink-0 mt-0.5 truncate max-w-28">{qId.slice(0, 8)}…</span>
                    <p className="text-sm font-medium text-gray-800">
                      {answer === null || answer === undefined
                        ? <span className="text-gray-300 font-normal">—</span>
                        : typeof answer === 'object'
                          ? JSON.stringify(answer)
                          : String(answer)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Status filter pills ──────────────────────────────────────────────────────

type StatusFilter = 'all' | 'responded' | 'expired' | 'pending'

// ─── Inner page ───────────────────────────────────────────────────────────────

function ESMResponsesInner() {
  const { id: studyId } = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = createClient()

  const [participants, setParticipants] = useState<Participant[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [selectedParticipant, setSelectedParticipant] = useState<string>('all')
  const [selectedSchedule, setSelectedSchedule] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [data, setData] = useState<ESMResponse[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [counts, setCounts] = useState<Record<StatusFilter, number>>({ all: 0, responded: 0, expired: 0, pending: 0 })
  const [countsLoading, setCountsLoading] = useState(true)

  // Load participants, schedules, questions
  useEffect(() => {
    async function load() {
      const [{ data: pData }, { data: sData }, { data: qData }] = await Promise.all([
        supabase.from('participants').select('id, label, device_id').eq('study_id', studyId),
        supabase.from('esm_schedules').select('id, name, schedule_type').eq('study_id', studyId).order('created_at'),
        supabase.from('esm_questions').select('id, schedule_id, question_order, question_text, question_type').order('question_order'),
      ])
      const pList = (pData || []) as Participant[]
      setParticipants(pList)
      setSchedules((sData || []) as Schedule[])
      setQuestions((qData || []) as Question[])

      const urlParticipant = searchParams.get('participant')
      if (urlParticipant && pList.some(p => p.id === urlParticipant)) {
        setSelectedParticipant(urlParticipant)
      }
    }
    load()
  }, [studyId])

  // Load counts per status
  useEffect(() => {
    async function loadCounts() {
      if (participants.length === 0) return
      setCountsLoading(true)
      const pIds = selectedParticipant === 'all' ? participants.map(p => p.id) : [selectedParticipant]
      const schedFilter = selectedSchedule !== 'all'

      function base() {
        let q = supabase.from('data_esm_responses').select('*', { count: 'exact', head: true }).in('participant_id', pIds)
        if (schedFilter) q = q.eq('schedule_id', selectedSchedule)
        return q
      }

      const [allRes, respRes, expRes, pendRes] = await Promise.all([
        base(),
        base().not('responded_at', 'is', null).eq('expired', false),
        base().eq('expired', true),
        base().is('responded_at', null).eq('expired', false),
      ])
      setCounts({
        all: allRes.count ?? 0,
        responded: respRes.count ?? 0,
        expired: expRes.count ?? 0,
        pending: pendRes.count ?? 0,
      })
      setCountsLoading(false)
    }
    loadCounts()
  }, [selectedParticipant, selectedSchedule, participants])

  // Load rows
  useEffect(() => {
    async function loadData() {
      if (participants.length === 0) return
      setLoading(true)
      const pIds = selectedParticipant === 'all' ? participants.map(p => p.id) : [selectedParticipant]

      let q = supabase.from('data_esm_responses').select('*').in('participant_id', pIds)
      if (selectedSchedule !== 'all') q = q.eq('schedule_id', selectedSchedule)
      if (statusFilter === 'responded') q = q.not('responded_at', 'is', null).eq('expired', false)
      else if (statusFilter === 'expired') q = q.eq('expired', true)
      else if (statusFilter === 'pending') q = q.is('responded_at', null).eq('expired', false)

      const [rowsRes, countRes] = await Promise.all([
        q.order('triggered_at', { ascending: false }).limit(100),
        (() => {
          let cq = supabase.from('data_esm_responses').select('*', { count: 'exact', head: true }).in('participant_id', pIds)
          if (selectedSchedule !== 'all') cq = cq.eq('schedule_id', selectedSchedule)
          if (statusFilter === 'responded') cq = cq.not('responded_at', 'is', null).eq('expired', false)
          else if (statusFilter === 'expired') cq = cq.eq('expired', true)
          else if (statusFilter === 'pending') cq = cq.is('responded_at', null).eq('expired', false)
          return cq
        })(),
      ])
      setData((rowsRes.data || []) as ESMResponse[])
      setTotalCount(countRes.count ?? 0)
      setLoading(false)
    }
    loadData()
  }, [selectedParticipant, selectedSchedule, statusFilter, participants])

  function handleParticipantChange(id: string) {
    setSelectedParticipant(id)
    const url = new URL(window.location.href)
    if (id === 'all') url.searchParams.delete('participant')
    else url.searchParams.set('participant', id)
    router.replace(url.pathname + url.search, { scroll: false })
  }

  function buildCSV(rows: ESMResponse[]) {
    if (rows.length === 0) return ''
    const pMap = Object.fromEntries(participants.map(p => [p.id, p]))
    const sMap = Object.fromEntries(schedules.map(s => [s.id, s]))

    const headers = ['participant', 'schedule', 'triggered_at', 'responded_at', 'status', 'response_time_minutes', 'responses']
    const csvRows = rows.map(row => {
      const p = pMap[row.participant_id]
      const s = row.schedule_id ? sMap[row.schedule_id] : null
      const status = row.expired ? 'expired' : row.responded_at ? 'responded' : 'pending'
      const rtMinutes = row.responded_at
        ? Math.round((new Date(row.responded_at).getTime() - new Date(row.triggered_at).getTime()) / 60000)
        : ''
      return [
        JSON.stringify(p ? participantName(p) : row.participant_id),
        JSON.stringify(s?.name ?? ''),
        JSON.stringify(row.triggered_at),
        JSON.stringify(row.responded_at ?? ''),
        JSON.stringify(status),
        JSON.stringify(rtMinutes),
        JSON.stringify(row.responses ? JSON.stringify(row.responses) : ''),
      ].join(',')
    })
    return [headers.join(','), ...csvRows].join('\n')
  }

  function downloadCSV(csv: string, filename: string) {
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  async function exportAll() {
    const pIds = selectedParticipant === 'all' ? participants.map(p => p.id) : [selectedParticipant]
    if (!pIds.length) return
    setExporting(true)
    let q = supabase.from('data_esm_responses').select('*').in('participant_id', pIds)
    if (selectedSchedule !== 'all') q = q.eq('schedule_id', selectedSchedule)
    if (statusFilter === 'responded') q = q.not('responded_at', 'is', null).eq('expired', false)
    else if (statusFilter === 'expired') q = q.eq('expired', true)
    else if (statusFilter === 'pending') q = q.is('responded_at', null).eq('expired', false)
    const { data: allRows } = await q.order('triggered_at', { ascending: false })
    const csv = buildCSV((allRows || []) as ESMResponse[])
    if (csv) downloadCSV(csv, 'esm_responses_export.csv')
    setExporting(false)
  }

  const pMap = Object.fromEntries(participants.map(p => [p.id, p]))
  const sMap = Object.fromEntries(schedules.map(s => [s.id, s]))
  const showParticipantCol = selectedParticipant === 'all'
  const isCapped = (totalCount ?? 0) > 100

  const STATUS_PILLS: { key: StatusFilter; label: string; color: string; activeColor: string }[] = [
    { key: 'all',       label: 'All',       color: 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300',              activeColor: 'bg-blue-600 text-white border border-blue-600' },
    { key: 'responded', label: 'Responded',  color: 'bg-white border border-gray-200 text-gray-600 hover:border-emerald-200',           activeColor: 'bg-emerald-600 text-white border border-emerald-600' },
    { key: 'expired',   label: 'Expired',    color: 'bg-white border border-gray-200 text-gray-600 hover:border-amber-200',             activeColor: 'bg-amber-500 text-white border border-amber-500' },
    { key: 'pending',   label: 'Pending',    color: 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300',              activeColor: 'bg-gray-600 text-white border border-gray-600' },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <Link
          href={`/studies/${studyId}`}
          className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors mb-4"
        >
          <ArrowLeft size={15} /> Back to Study
        </Link>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ESM / EMA Responses</h1>
            <p className="text-gray-500 text-sm mt-0.5">Browse and export survey response data</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ParticipantPicker
              participants={participants}
              value={selectedParticipant}
              onChange={handleParticipantChange}
            />
            <SchedulePicker
              schedules={schedules}
              value={selectedSchedule}
              onChange={setSelectedSchedule}
            />
          </div>
        </div>
      </div>

      <WorkspaceTabs label="Survey sections" items={[{ label: 'Responses', href: `/studies/${studyId}/esm-responses` }, { label: 'Setup', href: `/studies/${studyId}/esm` }]} />

      {/* Status filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_PILLS.map(pill => {
          const active = statusFilter === pill.key
          const count = counts[pill.key]
          return (
            <button
              key={pill.key}
              onClick={() => setStatusFilter(pill.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${active ? pill.activeColor : pill.color}`}
            >
              {pill.label}
              {countsLoading ? (
                <span className="w-5 h-2.5 bg-current opacity-20 rounded animate-pulse" />
              ) : (
                <span className={`tabular-nums ${active ? 'opacity-70' : 'text-gray-400'}`}>{count.toLocaleString()}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {!loading && totalCount !== null && (
          <span className="text-xs text-gray-400">
            {isCapped
              ? `Showing 100 of ${totalCount.toLocaleString()} records`
              : `${totalCount.toLocaleString()} record${totalCount !== 1 ? 's' : ''}`}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <details className="relative">
            <summary className="flex list-none items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"><Download size={12} />{exporting ? 'Exporting…' : 'Export'}<ChevronDown size={12} /></summary>
            <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
              <button onClick={() => { const csv = buildCSV(data); if (csv) downloadCSV(csv, 'esm_responses_page.csv') }} disabled={data.length === 0} className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">Export current view</button>
              <button onClick={exportAll} disabled={participants.length === 0 || exporting || (totalCount ?? 0) === 0} className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">Export filtered dataset{totalCount ? ` (${totalCount.toLocaleString()})` : ''}</button>
            </div>
          </details>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div>
            <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 flex gap-6">
              {[...Array(5)].map((_, i) => (
                <div key={i} className={`h-3 bg-gray-200 rounded animate-pulse ${i === 0 ? 'w-24' : 'w-16'}`} />
              ))}
            </div>
            {[...Array(7)].map((_, i) => (
              <div key={i} className="border-b border-gray-50 px-4 py-3 flex gap-6">
                {[...Array(5)].map((_, j) => (
                  <div
                    key={j}
                    className={`h-3 bg-gray-100 rounded animate-pulse ${j === 0 ? 'w-20' : j === 1 ? 'w-28' : 'w-14'}`}
                    style={{ animationDelay: `${i * 60}ms` }}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <ClipboardList size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-600 font-medium">No ESM responses</p>
            <p className="text-gray-400 text-sm mt-1">
              {statusFilter !== 'all'
                ? `No ${statusFilter} responses for the selected filters`
                : 'No responses collected yet'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-gray-200 bg-gray-50">
                  {showParticipantCol && (
                    <th className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap uppercase tracking-wide text-[11px]">
                      Participant
                    </th>
                  )}
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap uppercase tracking-wide text-[11px]">Schedule</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap uppercase tracking-wide text-[11px]">Triggered</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap uppercase tracking-wide text-[11px]">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap uppercase tracking-wide text-[11px]">Response Time</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap uppercase tracking-wide text-[11px]">Answers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.map(row => (
                  <ResponseRow
                    key={row.id}
                    row={row}
                    participant={pMap[row.participant_id]}
                    schedule={row.schedule_id ? sMap[row.schedule_id] : undefined}
                    questions={questions}
                    showParticipant={showParticipantCol}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isCapped && !loading && (
        <p className="text-xs text-gray-400">
          Showing the 100 most recent records.{' '}
          <button
            onClick={exportAll}
            disabled={exporting}
            className="font-semibold text-blue-600 hover:text-blue-700 transition-colors disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : `Export all ${totalCount?.toLocaleString()}`}
          </button>{' '}
          to get the full dataset.
        </p>
      )}
    </div>
  )
}

export default function ESMResponsesPage() {
  return (
    <Suspense>
      <ESMResponsesInner />
    </Suspense>
  )
}
