'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { GESTURE_INTERACTION_LABELS, callSourceLabel } from '@/lib/sensors'

// Friendly column names and cell formatting for raw data tables.

const COLUMN_LABELS: Record<string, string> = {
  recorded_at: 'Recorded',
  start_time: 'Start',
  end_time: 'End',
  duration_seconds: 'Duration (s)',
  package_name: 'Package',
  app_name: 'App',
  app_category: 'App category',
  posted_at: 'Posted',
  removed_at: 'Removed',
  removal_reason: 'Removed by',
  title: 'Title',
  level: 'Level (%)',
  is_charging: 'Charging',
  charging_type: 'Charger',
  temperature: 'Temperature (°C)',
  voltage: 'Voltage (V)',
  direction: 'Direction',
  event_time: 'Time',
  contact_hash: 'Contact (hashed)',
  source: 'App',
  call_kind: 'Network',
  outcome: 'Outcome',
  is_video: 'Video',
  video_seconds: 'Video (s)',
  ring_seconds: 'Ringing (s)',
  connected_at: 'Connected',
  ended_at: 'Ended',
  signals: 'Signals',
  schedule_id: 'Schedule',
  triggered_at: 'Triggered',
  responded_at: 'Responded',
  expired: 'Expired',
  responses: 'Answers',
  latitude: 'Latitude',
  longitude: 'Longitude',
  altitude: 'Altitude (m)',
  accuracy: 'Accuracy (m)',
  speed: 'Speed (m/s)',
  provider: 'Provider',
  lux: 'Light (lux)',
  state: 'State',
  interaction_type: 'Interaction',
  interaction_data: 'Details',
  steps: 'Steps',
  proximity_cm: 'Proximity (cm)',
  orientation: 'Orientation',
  _direction: 'Direction',
  _detail: 'Summary',
}

export function columnLabel(col: string): string {
  if (COLUMN_LABELS[col]) return COLUMN_LABELS[col]
  const s = col.replace(/^_/, '').replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const isTimeColumn = (col: string) => col.endsWith('_at') || col.endsWith('_time')

// The app stores battery voltage in millivolts (e.g. 4371). Display volts; the
// stored value (and CSV export) is unchanged. Values that already look like
// volts (< 100) are shown as-is.
function formatVoltage(value: number): string {
  return (value >= 100 ? value / 1000 : value).toFixed(2)
}

// data_calls display values. Display only: CSV exports keep the raw values.
const CALL_KIND_LABELS: Record<string, string> = { cellular: 'Cellular', voip: 'Internet (VoIP)' }
const CALL_OUTCOME_LABELS: Record<string, string> = {
  answered: 'Answered', missed: 'Missed', declined: 'Declined', unanswered: 'Not answered', unknown: 'Unknown',
}

function formatCallValue(col: string, value: unknown): string | null {
  if (col === 'source') return callSourceLabel(typeof value === 'string' ? value : null)
  if (value === null || value === undefined || value === '') return null
  if (col === 'call_kind' && typeof value === 'string') return CALL_KIND_LABELS[value] ?? value
  if (col === 'outcome' && typeof value === 'string') return CALL_OUTCOME_LABELS[value] ?? value
  if (col === 'signals' && Array.isArray(value)) return value.length ? value.map(String).join(', ') : null
  return null
}

/** Display text for one cell. `table` enables per-table formatting (e.g. call app names). */
export function formatCellValue(col: string, value: unknown, table?: string): string {
  if (table === 'data_calls') {
    const call = formatCallValue(col, value)
    if (call !== null) return call
  }
  if (value === null || value === undefined || value === '') return '—'
  if (col === 'voltage' && typeof value === 'number') return formatVoltage(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (col === 'interaction_type' && typeof value === 'string' && GESTURE_INTERACTION_LABELS[value]) return GESTURE_INTERACTION_LABELS[value]
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string' && isTimeColumn(col) && /^\d{4}-/.test(value)) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 6 })
  return String(value)
}

/** JSON value shown on one line, with a button to expand it. */
export function JsonCell({ value, label }: { value: unknown; label: string }) {
  const [open, setOpen] = useState(false)
  if (value === null || value === undefined) return <span className="text-subtle">—</span>
  const compact = JSON.stringify(value)
  const isEmpty = compact === '{}' || compact === '[]'
  if (isEmpty) return <span className="text-subtle">{compact}</span>
  return (
    <div className="min-w-48 max-w-96">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
        className="flex w-full items-start gap-1 rounded text-left font-mono text-xs text-muted hover:text-fg">
        {open ? <ChevronDown size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> : <ChevronRight size={12} className="mt-0.5 shrink-0" aria-hidden="true" />}
        {!open && <span className="truncate">{compact}</span>}
        {open && <span className="text-subtle">Hide</span>}
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-sunken p-2 font-mono text-[11px] text-fg">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  )
}
