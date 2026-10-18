'use client'

import type { SupabaseClient } from '@supabase/supabase-js'

// "Export all study data": one CSV per table, zipped in the browser. Every
// query runs with the signed-in researcher's session, so RLS decides what is
// included, exactly as on screen. Libraries are loaded on demand.

const PAGE = 1000
const ID_CHUNK = 100

const DATA_TABLES = [
  'data_app_usage', 'data_notifications', 'data_battery', 'data_calls', 'data_sms',
  'data_esm_responses', 'data_location', 'data_light', 'data_screen_state',
  'data_gestures', 'data_steps', 'data_proximity', 'data_gesture_pauses',
  'data_permission_events', 'sync_log',
] as const

// Never exported: the device secret's hash is useless for analysis.
const PARTICIPANT_COLUMNS = [
  'id', 'study_id', 'device_id', 'label', 'status', 'enrolled_at', 'last_sync_at',
  'consent_version', 'consent_at', 'device_info', 'permissions',
  'merged_into', 'merged_at', 'merge_adopted_at', 'created_at', 'updated_at',
].join(',')

type Row = Record<string, unknown>
export type ExportProgress = (message: string) => void

async function fetchAll(
  build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < PAGE) return out
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** RFC 4180 CSV; JSON columns are written as JSON strings. */
function toCsv(rows: Row[]): string {
  if (!rows.length) return ''
  const columns: string[] = []
  const seen = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); columns.push(k) }
  const lines = [columns.map(csvCell).join(',')]
  for (const r of rows) lines.push(columns.map(c => csvCell(r[c])).join(','))
  return lines.join('\r\n') + '\r\n'
}

function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'study'
}

export async function exportStudyZip(
  supabase: SupabaseClient,
  study: { id: string; name: string },
  progress: ExportProgress,
): Promise<{ blob: Blob; filename: string; counts: Record<string, number> }> {
  const { zipSync, strToU8 } = await import('fflate')
  const files: Record<string, Uint8Array> = {}
  const counts: Record<string, number> = {}
  const add = (table: string, rows: Row[]) => {
    counts[table] = rows.length
    files[`${table}.csv`] = strToU8(toCsv(rows))
  }

  progress('Study settings…')
  add('studies', await fetchAll((a, b) => supabase.from('studies').select('*').eq('id', study.id).range(a, b)))
  add('sensor_configs', await fetchAll((a, b) => supabase.from('sensor_configs').select('*').eq('study_id', study.id).order('sensor_type').range(a, b)))
  const schedules = await fetchAll((a, b) => supabase.from('esm_schedules').select('*').eq('study_id', study.id).order('created_at').range(a, b))
  add('esm_schedules', schedules)
  const questions: Row[] = []
  for (const ids of chunks(schedules.map(s => s.id as string), ID_CHUNK)) {
    questions.push(...await fetchAll((a, b) => supabase.from('esm_questions').select('*').in('schedule_id', ids).order('id').range(a, b)))
  }
  add('esm_questions', questions)

  progress('Participants…')
  const participants = await fetchAll((a, b) => supabase.from('participants').select(PARTICIPANT_COLUMNS).eq('study_id', study.id).order('enrolled_at').range(a, b) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>)
  add('participants', participants)
  add('participant_merge_audit', await fetchAll((a, b) => supabase.from('participant_merge_audit').select('*').eq('study_id', study.id).order('merged_at').range(a, b)))

  const ids = participants.map(p => p.id as string)
  for (const table of DATA_TABLES) {
    progress(`${table.replace(/^data_/, '').replace(/_/g, ' ')}…`)
    const rows: Row[] = []
    for (const group of chunks(ids, ID_CHUNK)) {
      rows.push(...await fetchAll((a, b) => supabase.from(table).select('*').in('participant_id', group).order('id').range(a, b)))
      if (rows.length) progress(`${table.replace(/^data_/, '').replace(/_/g, ' ')}: ${rows.length.toLocaleString()} rows…`)
    }
    add(table, rows)
  }

  const stamp = new Date().toISOString()
  files['README.txt'] = strToU8([
    `DETECTMiND export: ${study.name}`,
    `Study id: ${study.id}`,
    `Exported: ${stamp}`,
    '',
    'One CSV per table. Timestamps are UTC (ISO 8601). JSON columns',
    '(config, device_info, permissions, responses, interaction_data, ...) are JSON strings.',
    'data_battery.voltage is in millivolts. Phone numbers are SHA-256 hashes.',
    '',
    'Rows per table:',
    ...Object.entries(counts).map(([t, n]) => `  ${t}: ${n}`),
    '',
  ].join('\n'))

  progress('Compressing…')
  const zipped = zipSync(files, { level: 6 })
  const blob = new Blob([zipped.slice().buffer as ArrayBuffer], { type: 'application/zip' })
  return { blob, filename: `${safeName(study.name)}_export_${stamp.slice(0, 10)}.zip`, counts }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
