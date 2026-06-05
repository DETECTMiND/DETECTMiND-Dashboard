'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, ClipboardList, CheckCircle, AlertCircle } from 'lucide-react'

const SENSOR_TYPES = [
  { key: 'app_usage', label: 'App Usage', hasInterval: false, description: 'Tracks foreground app usage with start/end times' },
  { key: 'notifications', label: 'App Notifications', hasInterval: false, description: 'Captures notification events per app' },
  { key: 'calls', label: 'Phone Calls', hasInterval: false, description: 'Logs incoming and outgoing call events' },
  { key: 'sms', label: 'SMS Messages', hasInterval: false, description: 'Logs sent and received SMS messages' },
  { key: 'screen_state', label: 'Screen State', hasInterval: false, description: 'Screen on/off/lock/unlock events' },
  { key: 'gestures', label: 'User Gestures', hasInterval: false, description: 'Tap, scroll, long press, and window content change events' },
  { key: 'location', label: 'Location', hasInterval: true, description: 'GPS/network location at intervals or movement threshold' },
  { key: 'battery', label: 'Battery', hasInterval: true, description: 'Records battery level at intervals' },
  { key: 'light', label: 'Ambient Light', hasInterval: true, description: 'Ambient light readings at intervals' },
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

interface SensorConfig {
  id?: string
  sensor_type: string
  enabled: boolean
  interval_seconds: number | null
  config: Record<string, any>
}

export default function SensorConfigPage() {
  const { id: studyId } = useParams()
  const supabase = createClient()
  const [configs, setConfigs] = useState<Record<string, SensorConfig>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('sensor_configs').select('*').eq('study_id', studyId)
      const map: Record<string, SensorConfig> = {}
      SENSOR_TYPES.forEach(t => {
        const existing = (data || []).find(d => d.sensor_type === t.key)
        if (existing) {
          if (t.key === 'location' && existing.config && (existing.config as any).movement_threshold === undefined) {
            existing.config = { ...existing.config, movement_threshold: 50 }
          }
          if (t.key === 'gestures') {
            existing.config = {
              ...SCREEN_INTERACTION_DEFAULTS,
              ...existing.config,
              interaction_types: { ...SCREEN_INTERACTION_DEFAULTS.interaction_types, ...(existing.config?.interaction_types ?? {}) },
              skip_rules: { ...SCREEN_INTERACTION_DEFAULTS.skip_rules, ...(existing.config?.skip_rules ?? {}) },
            }
          }
          map[t.key] = existing
        } else {
          let defaultConfig: Record<string, any> = {}
          if (t.key === 'location') defaultConfig = { movement_threshold: 50 }
          if (t.key === 'gestures') defaultConfig = SCREEN_INTERACTION_DEFAULTS
          map[t.key] = { sensor_type: t.key, enabled: true, interval_seconds: t.hasInterval ? 300 : null, config: defaultConfig }
        }
      })
      setConfigs(map)
    }
    load()
  }, [studyId])

  function updateConfig(key: string, field: string, value: any) {
    setConfigs(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }))
    setSaved(false)
  }

  function updateScreenInteractionConfig(section: 'interaction_types' | 'skip_rules', subKey: string, value: boolean) {
    setConfigs(prev => {
      const cfg = prev['gestures']
      return {
        ...prev,
        gestures: {
          ...cfg,
          config: {
            ...cfg.config,
            [section]: {
              ...(cfg.config as any)[section],
              [subKey]: value,
            },
          },
        },
      }
    })
    setSaved(false)
  }

  async function saveAll() {
    setSaving(true)
    setSaved(false)
    setSaveError(null)

    const rows = Object.entries(configs).map(([key, cfg]) => ({
      study_id: studyId as string,
      sensor_type: key,
      enabled: cfg.enabled,
      interval_seconds: cfg.interval_seconds,
      config: cfg.config,
    }))

    const { data, error } = await supabase
      .from('sensor_configs')
      .upsert(rows, { onConflict: 'study_id,sensor_type' })
      .select()

    setSaving(false)

    if (error) {
      setSaveError(error.message)
      return
    }

    if (data) {
      const idMap: Record<string, string> = {}
      data.forEach((r: any) => { idMap[r.sensor_type] = r.id })
      setConfigs(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(k => {
          if (idMap[k]) next[k] = { ...next[k], id: idMap[k] }
        })
        return next
      })
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/studies/${studyId}`} className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors mb-4">
          <ArrowLeft size={15} /> Back to Study
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sensor Configuration</h1>
            <p className="text-gray-500 text-sm mt-0.5">Enable or disable sensors and set collection intervals</p>
          </div>
          <button
            onClick={saveAll}
            disabled={saving}
            className={`flex items-center gap-2 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm ${
              saveError ? 'bg-red-500 hover:bg-red-400' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {saveError ? <AlertCircle size={15} /> : saved ? <CheckCircle size={15} /> : <Save size={15} />}
            {saving ? 'Saving…' : saveError ? 'Error' : saved ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {saveError && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">Failed to save — {saveError}</p>
          </div>
        </div>
      )}

      {/* ESM/EMA note */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <ClipboardList size={16} className="text-blue-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-blue-800">ESM / EMA is configured separately</p>
          <p className="text-xs text-blue-600 mt-0.5">
            Survey schedules and questions are managed in the{' '}
            <Link href={`/studies/${studyId}/esm`} className="underline font-semibold hover:text-blue-800">ESM / EMA</Link>{' '}
            section, not here.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {SENSOR_TYPES.map(sensor => {
          const cfg = configs[sensor.key]
          if (!cfg) return null
          return (
            <div key={sensor.key} className={`bg-white rounded-xl border shadow-sm transition-all ${cfg.enabled ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-center justify-between px-5 py-4">
                <div className="min-w-0">
                  <p className={`font-semibold text-sm ${cfg.enabled ? 'text-gray-800' : 'text-gray-400'}`}>{sensor.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{sensor.description}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
                  <input
                    type="checkbox"
                    checked={cfg.enabled}
                    onChange={e => updateConfig(sensor.key, 'enabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white" />
                </label>
              </div>

              {cfg.enabled && (sensor.hasInterval || sensor.key === 'location') && (
                <div className="px-5 pb-4 border-t border-gray-50 pt-3 flex items-center gap-6 flex-wrap">
                  {sensor.hasInterval && (
                    <div className="flex items-center gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Sampling interval (seconds)</label>
                        <input
                          type="number"
                          key={`${sensor.key}-interval-${cfg.interval_seconds || 300}`}
                          defaultValue={cfg.interval_seconds || 300}
                          onBlur={e => {
                            const val = parseInt(e.target.value)
                            updateConfig(sensor.key, 'interval_seconds', isNaN(val) ? 300 : val)
                          }}
                          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                          min={10}
                        />
                      </div>
                      <span className="text-xs text-gray-400 mt-4">
                        = every {((cfg.interval_seconds || 300) / 60).toFixed(1)} min
                      </span>
                    </div>
                  )}
                  {sensor.key === 'location' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Movement threshold (meters)</label>
                      <input
                        type="number"
                        key={`location-threshold-${(cfg.config as any)?.movement_threshold ?? 50}`}
                        defaultValue={(cfg.config as any)?.movement_threshold ?? 50}
                        onBlur={e => {
                          const val = parseInt(e.target.value)
                          updateConfig(sensor.key, 'config', { ...cfg.config, movement_threshold: isNaN(val) ? 0 : val })
                        }}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                        min={0}
                      />
                    </div>
                  )}
                </div>
              )}

              {cfg.enabled && sensor.key === 'gestures' && (() => {
                const siCfg = cfg.config as typeof SCREEN_INTERACTION_DEFAULTS
                return (
                  <div className="px-5 pb-5 border-t border-gray-50 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Data to Collect</p>
                      <p className="text-xs text-gray-400 mb-3">Interaction types</p>
                      <div className="space-y-2">
                        {([
                          { key: 'TYPE_VIEW_SCROLLED', label: 'TYPE_VIEW_SCROLLED' },
                          { key: 'TYPE_VIEW_CLICKED', label: 'TYPE_VIEW_CLICKED' },
                          { key: 'TYPE_VIEW_LONG_CLICKED', label: 'TYPE_VIEW_LONG_CLICKED' },
                          { key: 'TYPE_WINDOW_CONTENT_CHANGED', label: 'TYPE_WINDOW_CONTENT_CHANGED' },
                        ] as const).map(({ key, label }) => (
                          <label key={key} className="flex items-center gap-2.5 cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={siCfg?.interaction_types?.[key] ?? true}
                              onChange={e => updateScreenInteractionConfig('interaction_types', key, e.target.checked)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30 cursor-pointer"
                            />
                            <span className="text-xs font-mono text-gray-700 group-hover:text-gray-900">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Skip Rules</p>
                      <p className="text-xs text-gray-400 mb-3">Packages</p>
                      <div className="space-y-2">
                        {([
                          { key: 'skip_system_ui', label: 'Skip system UI' },
                          { key: 'skip_launchers', label: 'Skip launchers' },
                          { key: 'skip_keyboards', label: 'Skip keyboards' },
                          { key: 'skip_system_settings', label: 'Skip system settings' },
                        ] as const).map(({ key, label }) => (
                          <label key={key} className="flex items-center gap-2.5 cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={siCfg?.skip_rules?.[key] ?? true}
                              onChange={e => updateScreenInteractionConfig('skip_rules', key, e.target.checked)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500/30 cursor-pointer"
                            />
                            <span className="text-xs text-gray-700 group-hover:text-gray-900">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>
    </div>
  )
}
