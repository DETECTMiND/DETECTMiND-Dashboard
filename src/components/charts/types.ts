// Row and Recharts helper types shared by the sensor charts. Rows arrive from
// PostgREST as plain JSON objects; each chart narrows to the columns it uses.

/** A row of any data_* table as returned by PostgREST. */
export type DataRow = Record<string, unknown>

export interface ChartParticipant {
  id: string
  label: string | null
  device_id: string
}

/** A merged chart point keyed by e.g. `level_<participantId>`. */
export type ChartPoint = Record<string, string | number | boolean | null | undefined>

/** The subset of a Recharts tooltip payload entry the charts read. */
export interface TooltipEntry {
  dataKey?: string | number
  name?: string | number
  value?: number | string | null
  color?: string
  fill?: string
  payload?: ChartPoint
}

/** Props Recharts injects into a custom tooltip `content` element. */
export interface InjectedTooltipProps {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string | number
}

export const asRows = <T,>(rows: DataRow[]) => rows as unknown as T[]

export interface BatteryRow {
  participant_id: string
  recorded_at: string
  level: number
  is_charging: boolean | null
  temperature: number | null
}

export interface LightRow {
  participant_id: string
  recorded_at: string
  lux: number
}

export interface ScreenStateRow {
  participant_id: string
  recorded_at: string
  state: string
}

export interface NotificationRow {
  participant_id: string
  package_name: string
  app_name: string | null
  posted_at: string
  removed_at: string | null
  removal_reason?: string | null
}

export interface AppUsageRow {
  participant_id: string
  package_name: string
  app_name: string | null
  start_time: string
  end_time: string | null
  duration_seconds: number | null
}

export interface CallSmsRow {
  participant_id: string
  direction: string
  event_time: string
  recorded_at?: string
  duration_seconds?: number | null
}

export interface LocationRow {
  participant_id: string
  recorded_at: string
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
}

export interface EsmResponseRow {
  participant_id: string
  schedule_id: string | null
  triggered_at: string
  responded_at: string | null
  expired: boolean | null
  responses: Record<string, unknown> | null
}
