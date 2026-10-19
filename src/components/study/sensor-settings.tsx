'use client'

import { useId } from 'react'
import {
  CALL_DEFAULTS, CALL_OPTION_LABELS, DEFAULT_MOVEMENT_THRESHOLD, DEFAULT_SCROLL_APPS, GESTURE_DEFAULTS, GESTURE_EVENT_LABELS, GESTURE_SKIP_LABELS,
  SENSORS, type SensorInfo, type SensorKey,
} from '@/lib/sensors'
import { Badge, Button, Field, IntervalInput, Textarea, Toggle, formatInterval } from '@/components/ui'
import { NumberInput } from './number-input'

// Sensor settings shared by the new-study wizard and Settings → Sensors, so
// both start from the same defaults and save the same sensor_configs rows.

export interface ScrollTracking { enabled: boolean; apps: string[] }

/** sensor_configs.config: location uses movement_threshold; gestures uses the interaction, skip and scroll settings; calls uses include_app_calls and detect_video. */
export interface SensorConfigJson {
  movement_threshold?: number
  include_app_calls?: boolean
  detect_video?: boolean
  interaction_types?: Record<string, boolean>
  skip_rules?: Record<string, boolean>
  scroll_tracking?: ScrollTracking
  [key: string]: unknown
}

export interface SensorDraft {
  enabled: boolean
  interval_seconds: number | null
  config: SensorConfigJson
}

export type SensorDrafts = Record<SensorKey, SensorDraft>

export interface SensorConfigRow {
  sensor_type: string
  enabled: boolean
  interval_seconds: number | null
  config: SensorConfigJson | null
}

/** Default interval for timed sensors when the catalogue has none. */
const FALLBACK_INTERVAL = 600

const CATEGORY_COPY: Record<SensorInfo['category'], { title: string; description: string }> = {
  'phone use': { title: 'Phone use', description: 'Recorded when something happens on the phone.' },
  environment: { title: 'Environment', description: 'Sampled on a timer.' },
}

function normaliseConfig(sensor: SensorInfo, config: SensorConfigJson | null | undefined): SensorConfigJson {
  const cfg: SensorConfigJson = { ...(config ?? {}) }
  if (sensor.key === 'location') {
    cfg.movement_threshold = typeof cfg.movement_threshold === 'number' ? cfg.movement_threshold : DEFAULT_MOVEMENT_THRESHOLD
  }
  if (sensor.key === 'calls') {
    // Missing keys are "on" in the app, so show (and save) them as on.
    cfg.include_app_calls = typeof cfg.include_app_calls === 'boolean' ? cfg.include_app_calls : CALL_DEFAULTS.include_app_calls
    cfg.detect_video = typeof cfg.detect_video === 'boolean' ? cfg.detect_video : CALL_DEFAULTS.detect_video
  }
  if (sensor.key === 'gestures') {
    const st = cfg.scroll_tracking as Partial<ScrollTracking> | undefined
    const saved = cfg.interaction_types ?? {}
    cfg.interaction_types = { ...GESTURE_DEFAULTS.interaction_types, ...saved }
    // Configs saved before "touches" existed: the app records touches when Taps
    // is on, so show (and save) that effective value.
    if (typeof saved.touches !== 'boolean') cfg.interaction_types.touches = cfg.interaction_types.TYPE_VIEW_CLICKED ?? false
    cfg.skip_rules = { ...GESTURE_DEFAULTS.skip_rules, ...(cfg.skip_rules ?? {}) }
    // When scroll_tracking is absent the app uses "on" + the default list.
    cfg.scroll_tracking = {
      enabled: typeof st?.enabled === 'boolean' ? st.enabled : true,
      apps: Array.isArray(st?.apps) ? st.apps.map(String) : [...DEFAULT_SCROLL_APPS],
    }
  }
  return cfg
}

/** The one default for a sensor: off, catalogue interval, catalogue gesture and location settings. */
export function defaultSensorDraft(sensor: SensorInfo): SensorDraft {
  return {
    enabled: false,
    interval_seconds: sensor.hasInterval ? (sensor.defaultInterval ?? FALLBACK_INTERVAL) : null,
    config: normaliseConfig(sensor, {}),
  }
}

export function defaultSensorDrafts(): SensorDrafts {
  return Object.fromEntries(SENSORS.map(s => [s.key, defaultSensorDraft(s)])) as SensorDrafts
}

/** Saved rows → editable drafts. Sensors with no row yet get the defaults. */
export function draftsFromRows(rows: SensorConfigRow[]): SensorDrafts {
  return Object.fromEntries(SENSORS.map(s => {
    const row = rows.find(r => r.sensor_type === s.key)
    if (!row) return [s.key, defaultSensorDraft(s)]
    return [s.key, {
      enabled: !!row.enabled,
      interval_seconds: s.hasInterval ? (row.interval_seconds || s.defaultInterval || FALLBACK_INTERVAL) : null,
      config: normaliseConfig(s, row.config),
    }]
  })) as SensorDrafts
}

/** Trim, drop blank lines and de-duplicate the scroll-tracking app list. */
export function cleanAppList(apps: string[]): string[] {
  return [...new Set(apps.map(a => a.trim()).filter(Boolean))]
}

/** Drafts → sensor_configs rows (one per catalogue sensor, on or off). */
export function rowsFromDrafts(studyId: string, drafts: SensorDrafts) {
  return SENSORS.map(s => {
    const d = drafts[s.key]
    const config = s.key === 'gestures' && d.config.scroll_tracking
      ? { ...d.config, scroll_tracking: { ...d.config.scroll_tracking, apps: cleanAppList(d.config.scroll_tracking.apps) } }
      : d.config
    return { study_id: studyId, sensor_type: s.key, enabled: d.enabled, interval_seconds: s.hasInterval ? d.interval_seconds : null, config }
  })
}

/** One line describing how a sensor is set up, for review screens. */
export function sensorSummary(sensor: SensorInfo, d: SensorDraft): string {
  if (sensor.key === 'location') return `${formatInterval(d.interval_seconds)}, and after moving ${d.config.movement_threshold ?? DEFAULT_MOVEMENT_THRESHOLD} m`
  if (sensor.hasInterval) return formatInterval(d.interval_seconds)
  if (sensor.key === 'gestures') {
    const types = Object.entries(d.config.interaction_types ?? {}).filter(([, on]) => on).map(([k]) => GESTURE_EVENT_LABELS[k]?.label ?? k)
    const st = d.config.scroll_tracking
    const apps = st ? cleanAppList(st.apps) : []
    const scroll = !st?.enabled ? 'no feed scroll tracking' : apps.includes('*') ? 'feed scrolls in all apps' : `feed scrolls in ${apps.length} app${apps.length === 1 ? '' : 's'}`
    return `${types.length ? types.join(', ') : 'No event types'}; ${scroll}`
  }
  if (sensor.key === 'calls') {
    const parts = [d.config.include_app_calls === false ? 'Phone calls only' : 'Phone and app calls']
    if (d.config.detect_video !== false) parts.push('video detected')
    return parts.join('; ')
  }
  return 'When it happens'
}

function CallOptions({ draft, onChange, disabled }: { draft: SensorDraft; onChange: (config: SensorConfigJson) => void; disabled?: boolean }) {
  const cfg = draft.config
  return (
    <div className="space-y-3">
      {(Object.keys(CALL_OPTION_LABELS) as (keyof typeof CALL_OPTION_LABELS)[]).map(key => (
        <Toggle key={key} size="sm" checked={cfg[key] !== false} disabled={disabled}
          onChange={on => onChange({ ...cfg, [key]: on })}
          label={CALL_OPTION_LABELS[key].label} description={CALL_OPTION_LABELS[key].description} />
      ))}
    </div>
  )
}

function GestureOptions({ draft, onChange, disabled }: { draft: SensorDraft; onChange: (config: SensorConfigJson) => void; disabled?: boolean }) {
  const appsId = useId()
  const cfg = draft.config
  const scroll = cfg.scroll_tracking ?? { enabled: true, apps: [...DEFAULT_SCROLL_APPS] }
  const apps = cleanAppList(scroll.apps)
  const allApps = apps.includes('*')
  const setScroll = (patch: Partial<ScrollTracking>) => onChange({ ...cfg, scroll_tracking: { ...scroll, ...patch } })

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium text-fg">What to record</legend>
        <div className="space-y-2">
          {Object.entries(GESTURE_EVENT_LABELS).map(([key, info]) => (
            <label key={key} className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" disabled={disabled} checked={cfg.interaction_types?.[key] ?? false}
                onChange={e => onChange({ ...cfg, interaction_types: { ...cfg.interaction_types, [key]: e.target.checked } })}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong accent-[var(--color-accent)]" />
              <span className="min-w-0">
                <span className="block text-sm text-fg">{info.label}</span>
                <span className="block text-xs text-subtle">{info.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium text-fg">Leave out</legend>
        <div className="space-y-2">
          {Object.entries(GESTURE_SKIP_LABELS).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" disabled={disabled} checked={cfg.skip_rules?.[key] ?? false}
                onChange={e => onChange({ ...cfg, skip_rules: { ...cfg.skip_rules, [key]: e.target.checked } })}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong accent-[var(--color-accent)]" />
              <span className="text-sm text-fg">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="min-w-0 border-t border-line pt-4 sm:col-span-2">
        <Toggle size="sm" checked={scroll.enabled} disabled={disabled} onChange={enabled => setScroll({ enabled })}
          label="Feed scrolls and reel swipes"
          description="Records scroll bursts in feeds and full-screen swipes between reels, Shorts and stories." />
        {scroll.enabled && (
          <div className="mt-3">
            <label htmlFor={appsId} className="mb-1.5 block text-sm font-medium text-fg">Apps to track</label>
            <Textarea id={appsId} rows={6} spellCheck={false} disabled={disabled} aria-describedby={`${appsId}-hint`}
              value={scroll.apps.join('\n')} onChange={e => setScroll({ apps: e.target.value.split('\n') })}
              className="max-w-lg font-mono text-xs" />
            <div id={`${appsId}-hint`} className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
              <span>One package name per line. Use <code className="font-mono">*</code> for every app.</span>
              <Badge>{allApps ? 'All apps' : `${apps.length} app${apps.length === 1 ? '' : 's'}`}</Badge>
              {!disabled && (
                <Button variant="ghost" size="sm" onClick={() => setScroll({ apps: [...DEFAULT_SCROLL_APPS] })}>Reset to default list</Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SensorRow({ sensor, draft, onChange, disabled }: {
  sensor: SensorInfo; draft: SensorDraft; onChange: (next: SensorDraft) => void; disabled?: boolean
}) {
  const Icon = sensor.icon
  const hasDetails = sensor.hasInterval || sensor.key === 'gestures' || sensor.key === 'calls'
  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <Icon size={16} aria-hidden="true" className={`mt-0.5 shrink-0 ${draft.enabled ? 'text-fg' : 'text-subtle'}`} />
        <Toggle className="min-w-0 flex-1" checked={draft.enabled} disabled={disabled}
          onChange={enabled => onChange({ ...draft, enabled })}
          label={sensor.label} description={sensor.description} />
      </div>
      {draft.enabled && hasDetails && (
        <div className="mt-4 space-y-4 sm:pl-11">
          {sensor.hasInterval && (
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              <Field label="How often">
                {(id, describedBy) => (
                  <IntervalInput id={id} describedBy={describedBy} seconds={draft.interval_seconds ?? FALLBACK_INTERVAL} disabled={disabled}
                    onChange={interval_seconds => onChange({ ...draft, interval_seconds })} />
                )}
              </Field>
              {sensor.key === 'location' && (
                <Field label="Also record after moving" hint="Metres. 0 turns movement readings off.">
                  {(id, describedBy) => (
                    <div className="flex items-center gap-2">
                      <NumberInput id={id} describedBy={describedBy} min={0} max={100000} disabled={disabled}
                        value={draft.config.movement_threshold ?? DEFAULT_MOVEMENT_THRESHOLD}
                        onChange={movement_threshold => onChange({ ...draft, config: { ...draft.config, movement_threshold } })} />
                      <span className="text-sm text-subtle">m</span>
                    </div>
                  )}
                </Field>
              )}
            </div>
          )}
          {sensor.key === 'calls' && (
            <CallOptions draft={draft} disabled={disabled} onChange={config => onChange({ ...draft, config })} />
          )}
          {sensor.key === 'gestures' && (
            <GestureOptions draft={draft} disabled={disabled} onChange={config => onChange({ ...draft, config })} />
          )}
        </div>
      )}
    </li>
  )
}

/** All sensors, grouped by category, each with a switch and its own settings. */
export function SensorSettingsEditor({ value, onChange, disabled }: {
  value: SensorDrafts
  onChange: (next: SensorDrafts) => void
  disabled?: boolean
}) {
  const categories = Object.keys(CATEGORY_COPY) as SensorInfo['category'][]
  return (
    <div className="space-y-6">
      {categories.map(cat => {
        const sensors = SENSORS.filter(s => s.category === cat)
        const anyOn = sensors.some(s => value[s.key].enabled)
        const onCount = sensors.filter(s => value[s.key].enabled).length
        const setAll = (enabled: boolean) => {
          const next = { ...value }
          sensors.forEach(s => { next[s.key] = { ...next[s.key], enabled } })
          onChange(next)
        }
        return (
          <section key={cat} aria-labelledby={`sensor-cat-${cat.replace(' ', '-')}`} className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken/60 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h3 id={`sensor-cat-${cat.replace(' ', '-')}`} className="text-sm font-semibold text-fg">{CATEGORY_COPY[cat].title}</h3>
                <p className="text-xs text-subtle">{CATEGORY_COPY[cat].description} {onCount} of {sensors.length} on.</p>
              </div>
              {!disabled && (
                <Button variant="ghost" size="sm" onClick={() => setAll(!anyOn)}>
                  {anyOn ? 'Turn all off' : 'Turn all on'}
                </Button>
              )}
            </div>
            <ul className="divide-y divide-line">
              {sensors.map(s => (
                <SensorRow key={s.key} sensor={s} draft={value[s.key]} disabled={disabled}
                  onChange={next => onChange({ ...value, [s.key]: next })} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
