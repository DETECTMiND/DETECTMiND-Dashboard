'use client'

import { createClient } from '@/lib/supabase-browser'
import { Suspense, lazy, useId, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Clock, Download, Users } from 'lucide-react'
import {
  Badge, Button, ButtonLink, EmptyState, ErrorState, FilterPills, Notice, Pagination, SectionHeader, SegmentedControl, Select,
  SkeletonRows, TableWrap, THead, Th, Td, Tr, type NoticeState,
} from '@/components/ui'
import { ParticipantPicker, participantName, type Participant } from '@/components/participant-ui'
import { scopedSelect, stripScope, type DataScope } from '@/components/data/scope'
import { must, mustCount, useAsync } from '@/components/data/use-async'
import { downloadCsv, fetchAll, localDay, safeFileName } from '@/lib/csv'
import { studyPaths } from '@/lib/nav'
import type { EsmResponseRow } from '@/components/charts/types'

const EsmChart = lazy(() => import('@/components/charts/EsmChart'))
const CHART_LIMIT = 2000

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
  expired: boolean | null
  responses: Record<string, unknown> | null
  recorded_at: string
}

type StatusFilter = 'all' | 'responded' | 'expired' | 'pending'
const STATUS_LABELS: Record<StatusFilter, string> = { all: 'All', responded: 'Responded', expired: 'Expired', pending: 'Pending' }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function responseMinutes(triggered: string, responded: string | null): number | null {
  if (!responded) return null
  return Math.round((new Date(responded).getTime() - new Date(triggered).getTime()) / 60000)
}

function fmtResponseTime(mins: number | null) {
  if (mins === null) return '—'
  if (mins < 1) return 'Under 1 min'
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)} h ${mins % 60} min`
}

function statusOf(row: ESMResponse): Exclude<StatusFilter, 'all'> {
  if (row.expired) return 'expired'
  return row.responded_at ? 'responded' : 'pending'
}

function formatAnswer(answer: unknown): string {
  if (answer === null || answer === undefined || answer === '') return '—'
  if (typeof answer === 'boolean') return answer ? 'Yes' : 'No'
  if (Array.isArray(answer)) return answer.map(String).join(', ')
  if (typeof answer === 'object') return JSON.stringify(answer)
  return String(answer)
}

function StatusBadge({ row }: { row: ESMResponse }) {
  const s = statusOf(row)
  if (s === 'expired') return <Badge tone="amber" icon={<AlertTriangle size={10} aria-hidden="true" />}>Expired</Badge>
  if (s === 'responded') return <Badge tone="green" icon={<CheckCircle2 size={10} aria-hidden="true" />}>Responded</Badge>
  return <Badge tone="neutral" icon={<Clock size={10} aria-hidden="true" />}>Pending</Badge>
}

// Builder-agnostic status filter (works on any PostgREST filter builder)
interface Filterable<T> {
  eq(column: string, value: unknown): T
  is(column: string, value: null): T
  not(column: string, operator: string, value: unknown): T
}
function applyStatus<T extends Filterable<T>>(q: T, status: StatusFilter): T {
  if (status === 'responded') return q.not('responded_at', 'is', null).eq('expired', false)
  if (status === 'expired') return q.eq('expired', true)
  if (status === 'pending') return q.is('responded_at', null).eq('expired', false)
  return q
}

// ─── Response row ─────────────────────────────────────────────────────────────

function ResponseRow({ row, participant, schedule, questions, showParticipant, studyId }: {
  row: ESMResponse
  participant: Participant | undefined
  schedule: Schedule | undefined
  questions: Question[]
  showParticipant: boolean
  studyId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()
  const name = participant ? participantName(participant) : row.participant_id.slice(0, 8)
  const answers = row.responses ?? {}
  const answerCount = Object.keys(answers).length
  const scheduleQuestions = questions.filter(q => q.schedule_id === row.schedule_id)
  const known = new Set(scheduleQuestions.map(q => q.id))
  const extra = Object.keys(answers).filter(k => !known.has(k))

  return (
    <>
      <Tr className={expanded ? 'bg-sunken/60' : ''}>
        {showParticipant && (
          <Td className="whitespace-nowrap">
            <Link href={`${studyPaths(studyId).participants}?participant=${row.participant_id}`} className="flex items-center gap-2 font-medium text-fg hover:text-accent">
              <span className="max-w-32 truncate">{name}</span>
            </Link>
          </Td>
        )}
        <Td className="whitespace-nowrap">{schedule ? schedule.name : <span className="text-subtle">—</span>}</Td>
        <Td className="whitespace-nowrap tabular-nums">{fmtDate(row.triggered_at)}</Td>
        <Td className="whitespace-nowrap"><StatusBadge row={row} /></Td>
        <Td className="whitespace-nowrap tabular-nums text-muted">{fmtResponseTime(responseMinutes(row.triggered_at, row.responded_at))}</Td>
        <Td className="whitespace-nowrap">
          {answerCount > 0 ? (
            <button type="button" onClick={() => setExpanded(e => !e)} aria-expanded={expanded} aria-controls={detailId}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium text-accent hover:bg-accent-soft">
              {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              {answerCount} answer{answerCount !== 1 ? 's' : ''}
            </button>
          ) : <span className="text-subtle">—</span>}
        </Td>
      </Tr>
      {expanded && answerCount > 0 && (
        <tr id={detailId} className="bg-sunken/40">
          <td colSpan={showParticipant ? 6 : 5} className="border-b border-line px-4 pb-3 pt-1">
            <dl className="ml-1 space-y-2 border-l-2 border-accent/40 py-1 pl-4">
              {scheduleQuestions.map((q, i) => (
                <div key={q.id} className="flex items-start gap-3">
                  <dt className="mt-0.5 shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent">Q{i + 1}</dt>
                  <dd className="min-w-0 flex-1">
                    <p className="text-xs text-subtle">{q.question_text}</p>
                    <p className="break-words text-sm font-medium text-fg">{formatAnswer(answers[q.id])}</p>
                  </dd>
                </div>
              ))}
              {extra.map(qId => (
                <div key={qId} className="flex items-start gap-3">
                  <dt className="mt-0.5 max-w-28 shrink-0 truncate rounded bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-subtle" title={qId}>
                    {qId.slice(0, 8)}…
                  </dt>
                  <dd className="break-words text-sm font-medium text-fg">{formatAnswer(answers[qId])}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function SurveyResponsesInner() {
  const { id: studyId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])
  const scheduleSelectId = useId()

  const [selectedSchedule, setSelectedSchedule] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<NoticeState>(null)
  const [view, setView] = useState<'list' | 'chart'>('list')

  // Participants, this study's schedules and only their questions
  const meta = useAsync(`meta:${studyId}`, async () => {
    const [participants, schedRes] = await Promise.all([
      fetchAll<Participant>((from, to) => supabase.from('participants').select('id, label, device_id')
        .eq('study_id', studyId).order('enrolled_at', { ascending: false }).order('id').range(from, to)),
      supabase.from('esm_schedules').select('id, name, schedule_type').eq('study_id', studyId).order('created_at'),
    ])
    const schedules = must(schedRes) as Schedule[]
    const questions = schedules.length
      ? must(await supabase.from('esm_questions').select('id, schedule_id, question_order, question_text, question_type')
        .in('schedule_id', schedules.map(s => s.id)).order('question_order')) as Question[]
      : []
    return { participants, schedules, questions }
  })
  const participants = useMemo(() => meta.data?.participants ?? [], [meta.data])
  const schedules = useMemo(() => meta.data?.schedules ?? [], [meta.data])
  const questions = useMemo(() => meta.data?.questions ?? [], [meta.data])
  const pMap = useMemo(() => Object.fromEntries(participants.map(p => [p.id, p])), [participants])
  const sMap = useMemo(() => Object.fromEntries(schedules.map(s => [s.id, s])), [schedules])

  const requested = searchParams.get('participant')
  const participant = requested && (!meta.data || pMap[requested]) ? requested : 'all'
  const scope: DataScope = { studyId, participant }
  const hasParticipants = participants.length > 0
  const filterKey = `${studyId}|${participant}|${selectedSchedule}`

  function base(columns = '*', options?: { count: 'exact'; head?: boolean }) {
    let q = scopedSelect(supabase, 'data_esm_responses', scope, columns, options)
    if (selectedSchedule !== 'all') q = q.eq('schedule_id', selectedSchedule)
    return q
  }

  const counts = useAsync(hasParticipants ? `counts:${filterKey}` : null, async () => {
    const keys: StatusFilter[] = ['all', 'responded', 'expired', 'pending']
    const values = await Promise.all(keys.map(k => applyStatus(base('id', { count: 'exact', head: true }), k).then(mustCount)))
    return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<StatusFilter, number>
  })
  const countMap = counts.data ?? counts.previous

  const rows = useAsync(hasParticipants ? `rows:${filterKey}|${statusFilter}|${page}|${pageSize}` : null, async () => {
    const from = page * pageSize
    const res = await applyStatus(base('*', { count: 'exact' }), statusFilter)
      .order('triggered_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + pageSize - 1)
    return { rows: stripScope(must(res) as unknown as Record<string, unknown>[]) as unknown as ESMResponse[], total: res.count ?? 0 }
  })
  const rowsData = rows.data ?? rows.previous

  // Chart: the latest 2,000 prompts for these filters, oldest first for plotting
  const chart = useAsync(hasParticipants && view === 'chart' ? `chart:${filterKey}` : null, async () => {
    const res = await base('participant_id, schedule_id, triggered_at, responded_at, expired, responses')
      .order('triggered_at', { ascending: false }).limit(CHART_LIMIT)
    return (stripScope(must(res) as unknown as Record<string, unknown>[]) as unknown as EsmResponseRow[]).reverse()
  })
  const data = rowsData?.rows ?? []
  const total = rowsData?.total ?? 0

  function changeParticipant(id: string) {
    setPage(0)
    const params = new URLSearchParams(searchParams.toString())
    if (id === 'all') params.delete('participant')
    else params.set('participant', id)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function toCsvRows(list: ESMResponse[]) {
    // One column per question when a single schedule is chosen
    const qs = selectedSchedule !== 'all' ? questions.filter(q => q.schedule_id === selectedSchedule) : []
    return list.map(row => {
      const p = pMap[row.participant_id]
      const out: Record<string, unknown> = {
        participant_id: row.participant_id,
        participant: p ? participantName(p) : '',
        device_id: p?.device_id ?? '',
        schedule: row.schedule_id ? sMap[row.schedule_id]?.name ?? '' : '',
        schedule_id: row.schedule_id ?? '',
        triggered_at: row.triggered_at,
        responded_at: row.responded_at ?? '',
        status: statusOf(row),
        response_time_minutes: responseMinutes(row.triggered_at, row.responded_at) ?? '',
      }
      qs.forEach((q, i) => { out[`q${i + 1}_${q.question_text}`] = row.responses?.[q.id] ?? '' })
      out.responses = row.responses ?? ''
      return out
    })
  }

  const who = participant === 'all' ? 'all' : safeFileName(pMap[participant] ? participantName(pMap[participant]) : participant)
  const fileBase = `survey_responses_${who}_${localDay(new Date())}`

  async function exportAll() {
    setExporting(true)
    setNotice(null)
    try {
      const all = await fetchAll<ESMResponse>((from, to) => applyStatus(base('*'), statusFilter)
        .order('triggered_at', { ascending: false }).order('id', { ascending: false })
        .range(from, to) as unknown as PromiseLike<{ data: ESMResponse[] | null; error: { message: string } | null }>)
      const clean = stripScope(all as unknown as Record<string, unknown>[]) as unknown as ESMResponse[]
      if (!clean.length) setNotice({ tone: 'info', text: 'There are no responses to export.' })
      else {
        downloadCsv(toCsvRows(clean), fileBase)
        setNotice({ tone: 'success', text: `Exported ${clean.length.toLocaleString()} responses.` })
      }
    } catch (e) {
      setNotice({ tone: 'error', text: `Export failed: ${e instanceof Error ? e.message : 'unknown error'}` })
    } finally {
      setExporting(false)
    }
  }

  const showParticipantCol = participant === 'all'

  if (meta.error) return <ErrorState message={meta.error} onRetry={meta.retry} />
  if (meta.loading) return <SkeletonRows rows={8} />
  if (!hasParticipants) {
    return (
      <EmptyState icon={<Users size={28} />} title="No participants yet"
        hint="Survey answers appear here once participants join and respond on their phones." />
    )
  }
  if (schedules.length === 0) {
    return (
      <EmptyState icon={<ClipboardList size={28} />} title="No surveys set up"
        hint="Add a survey schedule and its questions; answers will show up here.">
        <ButtonLink href={studyPaths(studyId).surveySetup} variant="secondary">Set up surveys</ButtonLink>
      </EmptyState>
    )
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Responses"
        description="Newest first. Open a row to see the answers."
        actions={
          <>
            <ParticipantPicker participants={participants} value={participant} onChange={changeParticipant} />
            <div className="flex items-center gap-2">
              <label htmlFor={scheduleSelectId} className="sr-only">Survey</label>
              <Select id={scheduleSelectId} value={selectedSchedule} className="w-full sm:w-52"
                onChange={e => { setSelectedSchedule(e.target.value); setPage(0) }}>
                <option value="all">All surveys</option>
                {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterPills label="Response status" value={statusFilter} onChange={v => { setStatusFilter(v); setPage(0) }}
          options={(Object.keys(STATUS_LABELS) as StatusFilter[]).map(k => ({ value: k, label: STATUS_LABELS[k], count: countMap ? countMap[k] : null }))} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SegmentedControl label="View" size="sm" value={view} onChange={setView}
            options={[{ value: 'list', label: 'List' }, { value: 'chart', label: 'Chart' }]} />
          <Button variant="secondary" size="sm" disabled={data.length === 0} onClick={() => downloadCsv(toCsvRows(data), `${fileBase}_page${page + 1}`)}>
            <Download size={13} aria-hidden="true" /> Export this page
          </Button>
          <Button size="sm" onClick={exportAll} loading={exporting} disabled={exporting || total === 0}>
            {!exporting && <Download size={13} aria-hidden="true" />}
            {exporting ? 'Exporting…' : `Export all${total ? ` (${total.toLocaleString()})` : ''}`}
          </Button>
        </div>
      </div>
      {counts.error && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          Could not load the counts: {counts.error}
          <Button variant="ghost" size="sm" onClick={counts.retry}>Try again</Button>
        </p>
      )}

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {view === 'chart' ? (
        chart.error ? <ErrorState message={chart.error} onRetry={chart.retry} />
          : !chart.data ? <SkeletonRows rows={6} />
          : (
            <Suspense fallback={<SkeletonRows rows={6} />}>
              <EsmChart data={chart.data} participants={participants} showParticipant={participant === 'all'} />
              {chart.data.length >= CHART_LIMIT && <p className="mt-2 text-xs text-subtle">Showing the latest {CHART_LIMIT.toLocaleString()} prompts.</p>}
            </Suspense>
          )
      ) : rows.error ? (
        <ErrorState message={rows.error} onRetry={rows.retry} />
      ) : !rowsData ? (
        <SkeletonRows rows={8} />
      ) : data.length === 0 ? (
        <EmptyState icon={<ClipboardList size={28} />} title="No responses"
          hint={statusFilter !== 'all' ? `No ${STATUS_LABELS[statusFilter].toLowerCase()} responses for these filters.` : 'No survey prompts have been recorded yet.'} />
      ) : (
        <>
          <div className={rows.loading ? 'opacity-60 transition-opacity' : ''} aria-busy={rows.loading}>
            <TableWrap maxHeight="70vh">
              <THead>
                <tr>
                  {showParticipantCol && <Th>Participant</Th>}
                  <Th>Survey</Th>
                  <Th>Sent</Th>
                  <Th>Status</Th>
                  <Th>Response time</Th>
                  <Th>Answers</Th>
                </tr>
              </THead>
              <tbody>
                {data.map(row => (
                  <ResponseRow key={row.id} row={row} participant={pMap[row.participant_id]}
                    schedule={row.schedule_id ? sMap[row.schedule_id] : undefined}
                    questions={questions} showParticipant={showParticipantCol} studyId={studyId} />
                ))}
              </tbody>
            </TableWrap>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage}
            onPageSize={size => { setPageSize(size); setPage(0) }} />
        </>
      )}
    </div>
  )
}

export default function SurveyResponsesPage() {
  return (
    <Suspense>
      <SurveyResponsesInner />
    </Suspense>
  )
}
