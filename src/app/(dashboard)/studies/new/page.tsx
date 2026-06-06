'use client'

import { createClient } from '@/lib/supabase-browser'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, ArrowRight, Check, FlaskConical,
  Smartphone, Phone, MessageSquare, MapPin, BatteryCharging,
  Bell, Monitor, Zap, Sun, MousePointerClick, ClipboardList,
  Clock, ShieldCheck, BadgeCheck,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SensorOption {
  key: string
  label: string
  description: string
  icon: React.ElementType
  hasInterval: boolean
  defaultInterval?: number
  category: 'behavioral' | 'physical' | 'device'
}

interface WizardState {
  // Step 1 – Basic Info
  name: string
  description: string
  appDescription: string
  syncInterval: number
  guidedPermissions: boolean
  autoParticipantId: boolean

  // Step 2 – Data to Collect
  sensors: Record<string, { enabled: boolean; interval_seconds: number | null; config: Record<string, any> }>

  // Step 3 – ESM/EMA
  enableEsm: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SENSOR_OPTIONS: SensorOption[] = [
  {
    key: 'app_usage',
    label: 'App Usage',
    description: 'Foreground app usage with start/end times per app',
    icon: Smartphone,
    hasInterval: false,
    category: 'behavioral',
  },
  {
    key: 'notifications',
    label: 'App Notifications',
    description: 'Notification events per app (title, posted/removed time)',
    icon: Bell,
    hasInterval: false,
    category: 'behavioral',
  },
  {
    key: 'calls',
    label: 'Phone Calls',
    description: 'Incoming, outgoing, and missed call logs (contact hashed)',
    icon: Phone,
    hasInterval: false,
    category: 'behavioral',
  },
  {
    key: 'sms',
    label: 'SMS Messages',
    description: 'Sent and received SMS logs (contact & body hashed)',
    icon: MessageSquare,
    hasInterval: false,
    category: 'behavioral',
  },
  {
    key: 'screen_state',
    label: 'Screen State',
    description: 'Screen on/off/lock/unlock events with timestamps',
    icon: Monitor,
    hasInterval: false,
    category: 'behavioral',
  },
  {
    key: 'gestures',
    label: 'User Gestures',
    description: 'Tap, scroll, long press, and window content change events',
    icon: MousePointerClick,
    hasInterval: false,
    category: 'behavioral',
  },
  {
    key: 'location',
    label: 'Location',
    description: 'GPS/network location at intervals or on movement',
    icon: MapPin,
    hasInterval: true,
    defaultInterval: 300,
    category: 'physical',
  },
  {
    key: 'battery',
    label: 'Battery',
    description: 'Battery level, charging state, temperature at intervals',
    icon: BatteryCharging,
    hasInterval: true,
    defaultInterval: 300,
    category: 'physical',
  },
  {
    key: 'light',
    label: 'Ambient Light',
    description: 'Ambient light sensor readings (lux) at intervals',
    icon: Sun,
    hasInterval: true,
    defaultInterval: 60,
    category: 'physical',
  },
]

const CATEGORIES = [
  { key: 'behavioral', label: 'Behavioral', description: 'App usage, communication, and interaction patterns' },
  { key: 'physical', label: 'Physical & Device', description: 'Location, battery, and sensor readings' },
]

const STEPS = [
  { number: 1, label: 'Basic Info' },
  { number: 2, label: 'Data Collection' },
  { number: 3, label: 'ESM / EMA' },
  { number: 4, label: 'Review' },
]

const SCREEN_INTERACTION_DEFAULTS = {
  interaction_types: {
    TYPE_VIEW_SCROLLED: true,
    TYPE_VIEW_CLICKED: true,
    TYPE_VIEW_LONG_CLICKED: true,
    TYPE_WINDOW_CONTENT_CHANGED: true,
  },
  skip_rules: {
    skip_system_ui: true,
    skip_launchers: true,
    skip_keyboards: true,
    skip_system_settings: true,
  },
}

const defaultSensors = (): WizardState['sensors'] => {
  const s: WizardState['sensors'] = {}
  SENSOR_OPTIONS.forEach(opt => {
    let config: Record<string, any> = {}
    if (opt.key === 'location') config = { movement_threshold: 50 }
    if (opt.key === 'gestures') config = SCREEN_INTERACTION_DEFAULTS
    s[opt.key] = {
      enabled: false,
      interval_seconds: opt.defaultInterval ?? null,
      config,
    }
  })
  return s
}

const inputCls = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all bg-white placeholder-gray-400'

// ─── Step Components ──────────────────────────────────────────────────────────

function StepBasicInfo({ state, setState }: { state: WizardState; setState: (s: WizardState) => void }) {
  const set = (patch: Partial<WizardState>) => setState({ ...state, ...patch })
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Study Name <span className="text-red-500">*</span>
        </label>
        <input
          value={state.name}
          onChange={e => set({ name: e.target.value })}
          placeholder="e.g. Sleep Pattern Study 2025"
          className={inputCls}
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Internal Description <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          value={state.description}
          onChange={e => set({ description: e.target.value })}
          rows={3}
          placeholder="Notes for your research team about this study…"
          className={`${inputCls} resize-none`}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          App Description <span className="text-gray-400 font-normal">(shown to participants in the mobile app)</span>
        </label>
        <textarea
          value={state.appDescription}
          onChange={e => set({ appDescription: e.target.value })}
          rows={3}
          placeholder="What participants will see when they enroll in your study…"
          className={`${inputCls} resize-none`}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Sync Interval
        </label>
        <div className="flex items-center gap-3">
          <select
            value={state.syncInterval}
            onChange={e => set({ syncInterval: parseInt(e.target.value) })}
            className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all bg-white"
          >
            <option value={5}>Every 5 minutes</option>
            <option value={15}>Every 15 minutes</option>
            <option value={30}>Every 30 minutes</option>
            <option value={60}>Every hour</option>
            <option value={360}>Every 6 hours</option>
            <option value={720}>Every 12 hours</option>
            <option value={1440}>Once a day</option>
          </select>
          <p className="text-xs text-gray-400">How often the app uploads data to the server</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">App Permissions</label>
        <div className="grid grid-cols-2 gap-2">
          {/* Guided Permissions */}
          <div
            className={`flex items-center justify-between rounded-xl border-2 px-4 py-3.5 cursor-pointer transition-all ${
              state.guidedPermissions ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
            onClick={() => set({ guidedPermissions: !state.guidedPermissions })}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                state.guidedPermissions ? 'bg-blue-100' : 'bg-gray-100'
              }`}>
                <ShieldCheck size={17} className={state.guidedPermissions ? 'text-blue-600' : 'text-gray-400'} />
              </div>
              <div className="min-w-0">
                <p className={`font-semibold text-sm ${state.guidedPermissions ? 'text-gray-900' : 'text-gray-600'}`}>
                  Guided Permissions
                </p>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                  Walk participants through granting permissions on first launch
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3" onClick={e => e.stopPropagation()}>
              <input type="checkbox" checked={state.guidedPermissions} onChange={e => set({ guidedPermissions: e.target.checked })} className="sr-only peer" />
              <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white" />
            </label>
          </div>

          {/* Auto Participant ID */}
          <div
            className={`flex items-center justify-between rounded-xl border-2 px-4 py-3.5 cursor-pointer transition-all ${
              state.autoParticipantId ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
            onClick={() => set({ autoParticipantId: !state.autoParticipantId })}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                state.autoParticipantId ? 'bg-blue-100' : 'bg-gray-100'
              }`}>
                <BadgeCheck size={17} className={state.autoParticipantId ? 'text-blue-600' : 'text-gray-400'} />
              </div>
              <div className="min-w-0">
                <p className={`font-semibold text-sm ${state.autoParticipantId ? 'text-gray-900' : 'text-gray-600'}`}>
                  Auto Participant ID
                </p>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                  Automatically assign a unique ID to each participant on enrollment
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3" onClick={e => e.stopPropagation()}>
              <input type="checkbox" checked={state.autoParticipantId} onChange={e => set({ autoParticipantId: e.target.checked })} className="sr-only peer" />
              <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white" />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

function SensorCard({
  sensor,
  enabled,
  interval,
  config,
  onChange,
}: {
  sensor: SensorOption
  enabled: boolean
  interval: number | null
  config: Record<string, any>
  onChange: (patch: { enabled?: boolean; interval_seconds?: number | null; config?: Record<string, any> }) => void
}) {
  const Icon = sensor.icon
  return (
    <div
      className={`rounded-xl border-2 transition-all cursor-pointer ${
        enabled
          ? 'border-blue-400 bg-blue-50/40 shadow-sm'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
      onClick={() => onChange({ enabled: !enabled })}
    >
      <div className="px-4 py-3.5 flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
          enabled ? 'bg-blue-100' : 'bg-gray-100'
        }`}>
          <Icon size={17} className={enabled ? 'text-blue-600' : 'text-gray-400'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className={`font-semibold text-sm ${enabled ? 'text-gray-900' : 'text-gray-600'}`}>
              {sensor.label}
            </p>
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                enabled ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
              }`}
              onClick={e => { e.stopPropagation(); onChange({ enabled: !enabled }) }}
            >
              {enabled && <Check size={11} className="text-white" strokeWidth={3} />}
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{sensor.description}</p>
        </div>
      </div>

      {enabled && sensor.key === 'gestures' && (
        <div className="px-4 pb-4 border-t border-blue-100 pt-3 grid grid-cols-2 gap-4" onClick={e => e.stopPropagation()}>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Interaction Types</p>
            <div className="space-y-1.5">
              {([
                { key: 'TYPE_VIEW_SCROLLED', label: 'TYPE_VIEW_SCROLLED' },
                { key: 'TYPE_VIEW_CLICKED', label: 'TYPE_VIEW_CLICKED' },
                { key: 'TYPE_VIEW_LONG_CLICKED', label: 'TYPE_VIEW_LONG_CLICKED' },
                { key: 'TYPE_WINDOW_CONTENT_CHANGED', label: 'TYPE_WINDOW_CONTENT_CHANGED' },
              ] as const).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.interaction_types?.[key] ?? true}
                    onChange={e => onChange({ config: { ...config, interaction_types: { ...config.interaction_types, [key]: e.target.checked } } })}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30 cursor-pointer shrink-0"
                  />
                  <span className="text-xs font-mono text-gray-600 truncate">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Skip Rules</p>
            <div className="space-y-1.5">
              {([
                { key: 'skip_system_ui', label: 'System UI' },
                { key: 'skip_launchers', label: 'Launchers' },
                { key: 'skip_keyboards', label: 'Keyboards' },
                { key: 'skip_system_settings', label: 'System Settings' },
              ] as const).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.skip_rules?.[key] ?? true}
                    onChange={e => onChange({ config: { ...config, skip_rules: { ...config.skip_rules, [key]: e.target.checked } } })}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30 cursor-pointer shrink-0"
                  />
                  <span className="text-xs text-gray-600">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {enabled && sensor.hasInterval && (
        <div
          className="px-4 pb-3.5 flex items-center flex-wrap gap-2"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 bg-white border border-blue-200 rounded-lg px-3 py-1.5">
            <Clock size={12} className="text-blue-500 shrink-0" />
            <span className="text-xs text-gray-500">Every</span>
            <input
              type="number"
              value={interval || sensor.defaultInterval || 300}
              min={10}
              onChange={e => onChange({ interval_seconds: parseInt(e.target.value) || 60 })}
              className="w-16 text-sm text-center font-semibold text-gray-800 focus:outline-none bg-transparent"
            />
            <span className="text-xs text-gray-500">sec</span>
          </div>
          <span className="text-xs text-gray-400 shrink-0">
            = {(((interval || sensor.defaultInterval || 300)) / 60).toFixed(1)} min
          </span>
          {sensor.key === 'location' && (
            <div className="flex items-center gap-2 bg-white border border-blue-200 rounded-lg px-3 py-1.5">
              <MapPin size={12} className="text-blue-500 shrink-0" />
              <span className="text-xs text-gray-500 shrink-0">Move ≥</span>
              <input
                type="number"
                value={config.movement_threshold ?? 50}
                min={0}
                onChange={e => {
                  const val = parseInt(e.target.value)
                  onChange({ config: { ...config, movement_threshold: isNaN(val) ? 0 : val } })
                }}
                className="w-14 text-sm text-center font-semibold text-gray-800 focus:outline-none bg-transparent"
              />
              <span className="text-xs text-gray-500">m</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StepDataCollection({ state, setState }: { state: WizardState; setState: (s: WizardState) => void }) {
  const enabledCount = Object.values(state.sensors).filter(s => s.enabled).length

  function updateSensor(key: string, patch: { enabled?: boolean; interval_seconds?: number | null; config?: Record<string, any> }) {
    setState({
      ...state,
      sensors: {
        ...state.sensors,
        [key]: { ...state.sensors[key], ...patch },
      },
    })
  }

  function toggleAll(category: string, enable: boolean) {
    const keys = SENSOR_OPTIONS.filter(s => s.category === category).map(s => s.key)
    const updated = { ...state.sensors }
    keys.forEach(k => { updated[k] = { ...updated[k], enabled: enable } })
    setState({ ...state, sensors: updated })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Select the data types you want to collect from participants&apos; devices.
          {enabledCount > 0 && (
            <span className="ml-2 font-semibold text-blue-600">{enabledCount} selected</span>
          )}
        </p>
      </div>

      {CATEGORIES.map(cat => {
        const sensors = SENSOR_OPTIONS.filter(s => s.category === cat.key)
        const catEnabled = sensors.every(s => state.sensors[s.key]?.enabled)
        const catAny = sensors.some(s => state.sensors[s.key]?.enabled)

        return (
          <div key={cat.key}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{cat.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{cat.description}</p>
              </div>
              <button
                type="button"
                onClick={() => toggleAll(cat.key, !catAny)}
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold transition-colors"
              >
                {catAny ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sensors.map(sensor => (
                <SensorCard
                  key={sensor.key}
                  sensor={sensor}
                  enabled={state.sensors[sensor.key]?.enabled ?? false}
                  interval={state.sensors[sensor.key]?.interval_seconds ?? null}
                  config={state.sensors[sensor.key]?.config ?? {}}
                  onChange={patch => updateSensor(sensor.key, patch)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StepEsmEma({ state, setState }: { state: WizardState; setState: (s: WizardState) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        ESM/EMA (Experience Sampling Method / Ecological Momentary Assessment) lets you send survey
        prompts to participants at scheduled times, randomly, or based on device events.
      </p>

      <div
        className={`rounded-xl border-2 cursor-pointer transition-all ${
          state.enableEsm
            ? 'border-blue-400 bg-blue-50/40'
            : 'border-gray-200 bg-white hover:border-gray-300'
        }`}
        onClick={() => setState({ ...state, enableEsm: true })}
      >
        <div className="px-5 py-4 flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
            state.enableEsm ? 'bg-blue-100' : 'bg-gray-100'
          }`}>
            <ClipboardList size={20} className={state.enableEsm ? 'text-blue-600' : 'text-gray-400'} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className={`font-semibold ${state.enableEsm ? 'text-gray-900' : 'text-gray-700'}`}>
                Enable ESM / EMA
              </p>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                state.enableEsm ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
              }`}>
                {state.enableEsm && <Check size={11} className="text-white" strokeWidth={3} />}
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Send periodic surveys to participants. Configure schedules, questions, and notifications after creating the study.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              {['Fixed time', 'Random window'].map(t => (
                <span key={t} className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2.5 py-1 rounded-full font-medium">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        className={`rounded-xl border-2 cursor-pointer transition-all ${
          !state.enableEsm
            ? 'border-gray-400 bg-gray-50'
            : 'border-gray-200 bg-white hover:border-gray-300'
        }`}
        onClick={() => setState({ ...state, enableEsm: false })}
      >
        <div className="px-5 py-4 flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
            !state.enableEsm ? 'bg-gray-200' : 'bg-gray-100'
          }`}>
            <Zap size={20} className={!state.enableEsm ? 'text-gray-600' : 'text-gray-400'} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className={`font-semibold ${!state.enableEsm ? 'text-gray-900' : 'text-gray-600'}`}>
                Sensor data only
              </p>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                !state.enableEsm ? 'bg-gray-600 border-gray-600' : 'border-gray-300'
              }`}>
                {!state.enableEsm && <Check size={11} className="text-white" strokeWidth={3} />}
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Collect passive sensor data only. No surveys or prompts will be sent to participants.
            </p>
          </div>
        </div>
      </div>

      {state.enableEsm && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-sm text-blue-800 font-medium">Next step after creation</p>
          <p className="text-xs text-blue-600 mt-0.5">
            After creating the study, go to <strong>ESM / EMA</strong> in the study menu to configure survey schedules and questions.
          </p>
        </div>
      )}
    </div>
  )
}

function StepReview({ state }: { state: WizardState }) {
  const enabledSensors = SENSOR_OPTIONS.filter(s => state.sensors[s.key]?.enabled)

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Study Details</p>
        </div>
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-start justify-between gap-4">
            <span className="text-sm text-gray-500">Name</span>
            <span className="text-sm font-semibold text-gray-900 text-right">{state.name}</span>
          </div>
          {state.description && (
            <div className="flex items-start justify-between gap-4">
              <span className="text-sm text-gray-500">Description</span>
              <span className="text-sm text-gray-700 text-right max-w-xs">{state.description}</span>
            </div>
          )}
          {state.appDescription && (
            <div className="flex items-start justify-between gap-4">
              <span className="text-sm text-gray-500">App description</span>
              <span className="text-sm text-gray-700 text-right max-w-xs">{state.appDescription}</span>
            </div>
          )}
          <div className="flex items-start justify-between gap-4">
            <span className="text-sm text-gray-500">Sync interval</span>
            <span className="text-sm text-gray-700">Every {state.syncInterval} min</span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Data Collection</p>
          <span className="text-xs text-gray-400">{enabledSensors.length} sensor{enabledSensors.length !== 1 ? 's' : ''} selected</span>
        </div>
        <div className="px-4 py-3">
          {enabledSensors.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No sensors selected — you can configure this later</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {enabledSensors.map(s => {
                const Icon = s.icon
                return (
                  <span key={s.key} className="inline-flex items-center gap-1.5 text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2.5 py-1 rounded-full font-medium">
                    <Icon size={11} />
                    {s.label}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ESM / EMA</p>
        </div>
        <div className="px-4 py-3">
          {state.enableEsm ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center">
                <Check size={9} className="text-white" strokeWidth={3} />
              </div>
              <span className="text-sm text-gray-700">Enabled — configure schedules after creation</span>
            </div>
          ) : (
            <span className="text-sm text-gray-400">Not enabled</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Wizard Page ──────────────────────────────────────────────────────────────

export default function NewStudyPage() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [state, setState] = useState<WizardState>({
    name: '',
    description: '',
    appDescription: '',
    syncInterval: 30,
    guidedPermissions: false,
    autoParticipantId: false,
    sensors: defaultSensors(),
    enableEsm: false,
  })

  function canProceed() {
    if (step === 1) return state.name.trim().length > 0
    return true
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // 1. Create study
      const config: Record<string, any> = {}
      if (state.guidedPermissions) config.guided_permissions = true
      if (state.autoParticipantId) config.auto_participant_id = true
      config.banking_pause = {
        enabled: true,
        apps: [
          'uk.co.hsbc.hsbcukmobilebanking',
          'com.barclays.android.barclaysmobilebanking',
          'com.htsu.hsbcpersonalbanking',
          'com.monzo.android',
          'com.starlingbank.android',
          'com.revolut.app',
        ],
        reminder_minutes: 30,
        escalation_minutes: 120,
      }

      const { data: study, error: studyError } = await supabase
        .from('studies')
        .insert({
          name: state.name.trim(),
          description: state.description.trim() || null,
          app_description: state.appDescription.trim() || null,
          sync_interval_minutes: state.syncInterval,
          config,
          status: 'draft',
          created_by: user?.id ?? null,
        })
        .select()
        .single()

      if (studyError || !study) {
        console.error(studyError)
        setSubmitting(false)
        return
      }

      // 2. Create sensor configs for all sensors (enabled or not)
      await supabase.from('sensor_configs').insert(
        SENSOR_OPTIONS.map(s => ({
          study_id: study.id,
          sensor_type: s.key,
          enabled: state.sensors[s.key]?.enabled ?? false,
          interval_seconds: state.sensors[s.key]?.interval_seconds ?? null,
          config: state.sensors[s.key]?.config ?? {},
        }))
      )

      // 3. Navigate
      if (state.enableEsm) {
        router.push(`/studies/${study.id}/esm`)
      } else {
        router.push(`/studies/${study.id}`)
      }
    } catch (e) {
      console.error(e)
      setSubmitting(false)
    }
  }

  const stepContent: Record<number, React.ReactNode> = {
    1: <StepBasicInfo state={state} setState={setState} />,
    2: <StepDataCollection state={state} setState={setState} />,
    3: <StepEsmEma state={state} setState={setState} />,
    4: <StepReview state={state} />,
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/studies"
          className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors mb-4"
        >
          <ArrowLeft size={15} /> Back to Studies
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
            <FlaskConical size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Create New Study</h1>
            <p className="text-gray-400 text-sm">Set up your research study in a few steps</p>
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((s, i) => {
          const done = step > s.number
          const active = step === s.number
          return (
            <div key={s.number} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  done
                    ? 'bg-blue-600 text-white'
                    : active
                      ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                      : 'bg-gray-100 text-gray-400'
                }`}>
                  {done ? <Check size={13} strokeWidth={3} /> : s.number}
                </div>
                <span className={`text-xs font-medium mt-1.5 whitespace-nowrap ${
                  active ? 'text-blue-700' : done ? 'text-gray-500' : 'text-gray-400'
                }`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mb-4 transition-colors ${done ? 'bg-blue-400' : 'bg-gray-200'}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* Step content */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/60">
          <h2 className="font-semibold text-gray-800">{STEPS[step - 1].label}</h2>
        </div>
        <div className="px-6 py-6">
          {stepContent[step]}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => step > 1 ? setStep(step - 1) : router.push('/studies')}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors font-medium"
          >
            <ArrowLeft size={14} />
            {step === 1 ? 'Cancel' : 'Back'}
          </button>

          {step < STEPS.length ? (
            <button
              type="button"
              onClick={() => canProceed() && setStep(step + 1)}
              disabled={!canProceed()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              Continue
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
            >
              {submitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Check size={14} />
                  Create Study
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
