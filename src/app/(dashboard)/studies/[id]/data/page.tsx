'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useRef, useState, Suspense } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download, Database, Users, Search, Check, X, ChevronDown } from 'lucide-react'

const SENSOR_TABLES = [
  { key: 'data_app_usage',          label: 'App Usage',           timeCol: 'start_time'   },
  { key: 'data_notifications',      label: 'Notifications',       timeCol: 'posted_at'    },
  { key: 'data_battery',            label: 'Battery',             timeCol: 'recorded_at'  },
  { key: 'data_calls',              label: 'Calls',               timeCol: 'event_time'   },
  { key: 'data_sms',                label: 'SMS',                 timeCol: 'event_time'   },
  { key: 'data_esm_responses',      label: 'ESM Responses',       timeCol: 'triggered_at' },
  { key: 'data_location',           label: 'Location',            timeCol: 'recorded_at'  },
  { key: 'data_light',              label: 'Light',               timeCol: 'recorded_at'  },
  { key: 'data_screen_state',       label: 'Screen State',        timeCol: 'recorded_at'  },
  { key: 'data_screen_interaction', label: 'Screen Interaction',  timeCol: 'recorded_at'  },
]

interface Participant {
  id: string
  device_id: string
  label: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function participantName(p: Participant) {
  return p.label || p.device_id
}

function formatColHeader(col: string) {
  return col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

function formatCellValue(col: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string') {
    const isTimeCol = col.endsWith('_at') || col.endsWith('_time')
    if (isTimeCol && /^\d{4}-/.test(value)) {
      try {
        return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      } catch { /* fall through */ }
    }
  }
  return String(value)
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

// ─── Inner page (needs useSearchParams) ──────────────────────────────────────

function SensorDataInner() {
  const { id: studyId } = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = createClient()

  const [participants, setParticipants]           = useState<Participant[]>([])
  const [enabledTables, setEnabledTables]         = useState(SENSOR_TABLES)
  const [selectedParticipant, setSelectedParticipant] = useState<string>('all')
  const [selectedTable, setSelectedTable]         = useState(SENSOR_TABLES[0])
  const [data, setData]                           = useState<any[]>([])
  const [counts, setCounts]                       = useState<Record<string, number>>({})
  const [totalCount, setTotalCount]               = useState<number | null>(null)
  const [loading, setLoading]                     = useState(false)
  const [exporting, setExporting]                 = useState(false)
  const [countsLoading, setCountsLoading]         = useState(true)

  // Load participants + enabled sensor configs
  useEffect(() => {
    async function loadParticipants() {
      const [{ data: pData }, { data: cfgData }] = await Promise.all([
        supabase.from('participants').select('id, label, device_id').eq('study_id', studyId),
        supabase.from('sensor_configs').select('sensor_type').eq('study_id', studyId).eq('enabled', true),
      ])
      const pList = (pData || []) as Participant[]
      setParticipants(pList)

      // Filter sensor tabs to only enabled configs; fall back to all if none configured yet
      const enabledTypes = new Set((cfgData || []).map((r: any) => r.sensor_type))
      const filtered = enabledTypes.size > 0
        ? SENSOR_TABLES.filter(t => enabledTypes.has(t.key.replace(/^data_/, '')))
        : SENSOR_TABLES
      setEnabledTables(filtered)
      setSelectedTable(filtered[0] ?? SENSOR_TABLES[0])

      const urlParticipant = searchParams.get('participant')
      if (urlParticipant && pList.some(p => p.id === urlParticipant)) {
        setSelectedParticipant(urlParticipant)
      }
    }
    loadParticipants()
  }, [studyId])

  // Re-fetch per-sensor counts whenever participant changes
  useEffect(() => {
    async function loadCounts() {
      if (participants.length === 0) return
      setCountsLoading(true)
      const pIds = selectedParticipant === 'all'
        ? participants.map(p => p.id)
        : [selectedParticipant]

      const countResults: Record<string, number> = {}
      await Promise.all(
        enabledTables.map(async t => {
          const { count } = await supabase
            .from(t.key)
            .select('*', { count: 'exact', head: true })
            .in('participant_id', pIds)
          countResults[t.key] = count || 0
        })
      )
      setCounts(countResults)
      setCountsLoading(false)
    }
    loadCounts()
  }, [selectedParticipant, participants, enabledTables])

  // Load rows for selected table + participant
  useEffect(() => {
    async function loadData() {
      if (participants.length === 0) return
      setLoading(true)
      const pIds = selectedParticipant === 'all'
        ? participants.map(p => p.id)
        : [selectedParticipant]

      const [rowsRes, countRes] = await Promise.all([
        supabase
          .from(selectedTable.key)
          .select('*')
          .in('participant_id', pIds)
          .order(selectedTable.timeCol, { ascending: false })
          .limit(100),
        supabase
          .from(selectedTable.key)
          .select('*', { count: 'exact', head: true })
          .in('participant_id', pIds),
      ])
      setData(rowsRes.data || [])
      setTotalCount(countRes.count ?? 0)
      setLoading(false)
    }
    loadData()
  }, [selectedTable, selectedParticipant, participants])

  // Sync participant selection to URL
  function handleParticipantChange(id: string) {
    setSelectedParticipant(id)
    const url = new URL(window.location.href)
    if (id === 'all') url.searchParams.delete('participant')
    else url.searchParams.set('participant', id)
    router.replace(url.pathname + url.search, { scroll: false })
  }

  function buildCSV(rows: any[]) {
    if (rows.length === 0) return ''
    const headers = Object.keys(rows[0])
    return [headers.join(','), ...rows.map(row => headers.map(h => JSON.stringify(row[h] ?? '')).join(','))].join('\n')
  }

  function downloadCSV(csv: string, filename: string) {
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  async function exportAll() {
    const pIds = selectedParticipant === 'all'
      ? participants.map(p => p.id)
      : [selectedParticipant]
    if (pIds.length === 0) return
    setExporting(true)
    const { data: allRows } = await supabase
      .from(selectedTable.key)
      .select('*')
      .in('participant_id', pIds)
      .order(selectedTable.timeCol, { ascending: false })
    const csv = buildCSV(allRows || [])
    if (csv) downloadCSV(csv, `${selectedTable.key}_full_export.csv`)
    setExporting(false)
  }

  const pMap = Object.fromEntries(participants.map(p => [p.id, p]))
  const showParticipantCol = selectedParticipant === 'all'
  const cols = data.length > 0
    ? Object.keys(data[0]).filter(k => k !== 'id' && k !== 'participant_id')
    : []
  const isFiltered = selectedParticipant !== 'all'
  const selectedP = participants.find(p => p.id === selectedParticipant)
  const isCapped = (totalCount ?? 0) > 100

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div>
        <Link
          href={`/studies/${studyId}`}
          className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors mb-4"
        >
          <ArrowLeft size={15} /> Back to Study
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sensor Data</h1>
            <p className="text-gray-500 text-sm mt-0.5">Browse and export collected sensor data</p>
          </div>
          <ParticipantPicker
            participants={participants}
            value={selectedParticipant}
            onChange={handleParticipantChange}
          />
        </div>
      </div>

      {/* Sensor type tabs */}
      <div className="flex flex-wrap gap-1.5">
          {enabledTables.map(t => {
            const active = selectedTable.key === t.key
            const count = counts[t.key] ?? 0
            const hasData = count > 0
            return (
              <button
                key={t.key}
                onClick={() => setSelectedTable(t)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : hasData
                      ? 'bg-white border border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                      : 'bg-white border border-gray-100 text-gray-400 hover:border-gray-200'
                }`}
              >
                {!countsLoading && hasData && !active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                )}
                {t.label}
                {countsLoading ? (
                  <span className="w-5 h-2.5 bg-current opacity-20 rounded animate-pulse" />
                ) : (
                  <span className={`tabular-nums ${active ? 'text-blue-200' : hasData ? 'text-gray-400' : 'text-gray-300'}`}>
                    {count.toLocaleString()}
                  </span>
                )}
              </button>
            )
          })}
      </div>

      {/* Toolbar — record count + export */}
      <div className="flex items-center gap-3 flex-wrap">
        {!loading && totalCount !== null && (
          <span className="text-xs text-gray-400">
            {isCapped
              ? `Showing 100 of ${totalCount.toLocaleString()} records`
              : `${totalCount.toLocaleString()} record${totalCount !== 1 ? 's' : ''}`}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => { const csv = buildCSV(data); if (csv) downloadCSV(csv, `${selectedTable.key}_export.csv`) }}
            disabled={data.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 bg-white rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Download size={12} />
            Export {data.length > 0 ? `${data.length} rows` : 'page'}
          </button>
          <button
            onClick={exportAll}
            disabled={participants.length === 0 || exporting || (totalCount ?? 0) === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Download size={12} />
            {exporting ? 'Exporting…' : totalCount && totalCount > 100 ? `Export all ${totalCount.toLocaleString()}` : 'Export all'}
          </button>
        </div>
      </div>

      {/* Data table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div>
            <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 flex gap-6">
              {[...Array(showParticipantCol ? 5 : 4)].map((_, i) => (
                <div key={i} className={`h-3 bg-gray-200 rounded animate-pulse ${i === 0 ? 'w-24' : 'w-16'}`} />
              ))}
            </div>
            {[...Array(7)].map((_, i) => (
              <div key={i} className="border-b border-gray-50 px-4 py-3 flex gap-6">
                {[...Array(showParticipantCol ? 5 : 4)].map((_, j) => (
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
            <Database size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-600 font-medium">No {selectedTable.label} data</p>
            <p className="text-gray-400 text-sm mt-1">
              {isFiltered ? 'No records for this participant' : 'No records collected yet for this sensor'}
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
                  {cols.map(col => (
                    <th key={col} className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap uppercase tracking-wide text-[11px]">
                      {formatColHeader(col)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.map((row, i) => {
                  const p = pMap[row.participant_id]
                  const name = p ? participantName(p) : row.participant_id
                  return (
                    <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                      {showParticipantCol && (
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${p ? avatarColor(p.id) : 'bg-gray-100 text-gray-500'}`}>
                              {avatarInitial(name)}
                            </span>
                            <span className="text-gray-700 font-medium truncate max-w-28">{name}</span>
                          </div>
                        </td>
                      )}
                      {cols.map(k => {
                        const raw = row[k]
                        const display = formatCellValue(k, raw)
                        const isEmpty = display === '—'
                        return (
                          <td
                            key={k}
                            className={`px-4 py-2.5 whitespace-nowrap max-w-52 truncate ${isEmpty ? 'text-gray-300' : 'text-gray-600'}`}
                            title={isEmpty ? undefined : display}
                          >
                            {display}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
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

// ─── Page (Suspense boundary for useSearchParams) ─────────────────────────────

export default function SensorDataPage() {
  return (
    <Suspense>
      <SensorDataInner />
    </Suspense>
  )
}
