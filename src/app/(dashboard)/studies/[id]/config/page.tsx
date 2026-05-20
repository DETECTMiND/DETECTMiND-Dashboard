'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save } from 'lucide-react'

const SENSOR_TYPES = [
  { key: 'app_usage', label: 'App Usage', hasInterval: false, description: 'Tracks foreground app usage with start/end times' },
  { key: 'notifications', label: 'Notifications', hasInterval: false, description: 'Captures notification events per app' },
  { key: 'battery', label: 'Battery', hasInterval: true, description: 'Records battery level at intervals' },
  { key: 'calls', label: 'Phone Calls', hasInterval: false, description: 'Logs incoming and outgoing call events' },
  { key: 'sms', label: 'SMS', hasInterval: false, description: 'Logs sent and received SMS messages' },
  { key: 'esm_ema', label: 'ESM/EMA', hasInterval: false, description: 'Configured via ESM/EMA page' },
  { key: 'location', label: 'Location', hasInterval: true, description: 'GPS/network location at intervals or movement threshold' },
  { key: 'light', label: 'Light Sensor', hasInterval: true, description: 'Ambient light readings at intervals' },
  { key: 'screen_state', label: 'Screen State', hasInterval: false, description: 'Screen on/off/lock/unlock events' },
  { key: 'screen_interaction', label: 'Screen Interaction', hasInterval: false, description: 'Touch and swipe events' },
]

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

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('sensor_configs').select('*').eq('study_id', studyId)
      const map: Record<string, SensorConfig> = {}
      SENSOR_TYPES.forEach(t => {
        const existing = (data || []).find(d => d.sensor_type === t.key)
        map[t.key] = existing || { sensor_type: t.key, enabled: true, interval_seconds: t.hasInterval ? 300 : null, config: {} }
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

  async function saveAll() {
    setSaving(true)
    for (const [key, cfg] of Object.entries(configs)) {
      if (cfg.id) {
        await supabase.from('sensor_configs').update({
          enabled: cfg.enabled,
          interval_seconds: cfg.interval_seconds,
          config: cfg.config,
        }).eq('id', cfg.id)
      } else {
        await supabase.from('sensor_configs').upsert({
          study_id: studyId,
          sensor_type: key,
          enabled: cfg.enabled,
          interval_seconds: cfg.interval_seconds,
          config: cfg.config,
        }, { onConflict: 'study_id,sensor_type' })
      }
    }
    setSaving(false)
    setSaved(true)
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
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm"
          >
            <Save size={15} />
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save All'}
          </button>
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
                          value={cfg.interval_seconds || 300}
                          onChange={e => updateConfig(sensor.key, 'interval_seconds', parseInt(e.target.value))}
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
                        value={(cfg.config as any)?.movement_threshold || 50}
                        onChange={e => updateConfig(sensor.key, 'config', { ...cfg.config, movement_threshold: parseInt(e.target.value) })}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                        min={0}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
