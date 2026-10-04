'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Users, Database, ClipboardList, Settings, Edit2, Trash2, ChevronRight, MessageSquare, ShieldCheck, BadgeCheck, X, Plus, CreditCard, Clock, Lock } from 'lucide-react'

interface Study {
  id: string
  name: string
  description: string | null
  app_description: string | null
  status: string
  sync_interval_minutes: number
  config: Record<string, any> | null
  pin_required?: boolean
  created_at: string
}

const DEFAULT_BANKING_APPS = [
  'uk.co.hsbc.hsbcukmobilebanking',
  'com.barclays.android.barclaysmobilebanking',
  'com.htsu.hsbcpersonalbanking',
  'com.monzo.android',
  'com.starlingbank.android',
  'com.revolut.app',
]

const STATUS_STYLES: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600 border border-gray-200',
  active:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  paused:    'bg-amber-50 text-amber-700 border border-amber-200',
  completed: 'bg-blue-50 text-blue-700 border border-blue-200',
}

const statusOptions = ['draft', 'active', 'paused', 'completed']

export default function StudyDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const supabase = createClient()
  const [study, setStudy] = useState<Study | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Partial<Study>>({})
  const [guidedPermissions, setGuidedPermissions] = useState(false)
  const [autoParticipantId, setAutoParticipantId] = useState(false)
  const [participantCount, setParticipantCount] = useState(0)
  // PIN: pinRequired reflects whether the study currently has one; pinInput is
  // the new value being set (empty = leave unchanged / cleared via the toggle).
  const [pinRequired, setPinRequired] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [bankingPause, setBankingPause] = useState<{
    enabled: boolean
    apps: string[]
    reminder_minutes: number
    escalation_minutes: number
  }>({
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
  })
  const [newAppId, setNewAppId] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('studies').select('*').eq('id', id).single()
      if (data) {
        setStudy(data)
        setForm(data)
        setGuidedPermissions(!!(data.config?.guided_permissions))
        setPinRequired(!!data.pin_required)
        setAutoParticipantId(!!(data.config?.auto_participant_id))
        if (data.config?.banking_pause) {
          setBankingPause({
            enabled: data.config.banking_pause.enabled ?? true,
            apps: data.config.banking_pause.apps ?? DEFAULT_BANKING_APPS,
            reminder_minutes: data.config.banking_pause.reminder_minutes ?? 30,
            escalation_minutes: data.config.banking_pause.escalation_minutes ?? 120,
          })
        }
      }
      const { count } = await supabase.from('participants').select('*', { count: 'exact', head: true }).eq('study_id', id)
      setParticipantCount(count || 0)
    }
    load()
  }, [id])

  async function handleSave() {
    if (!study) return
    const updatedConfig = { ...(study.config ?? {}) }
    if (guidedPermissions) updatedConfig.guided_permissions = true
    else delete updatedConfig.guided_permissions
    if (autoParticipantId) updatedConfig.auto_participant_id = true
    else delete updatedConfig.auto_participant_id
    updatedConfig.banking_pause = { ...bankingPause }
    // Validate a new PIN if one was entered.
    if (pinInput && !/^\d{4}$/.test(pinInput)) {
      setPinError('PIN must be exactly 4 digits')
      return
    }
    setPinError(null)
    const { error } = await supabase.from('studies').update({
      name: form.name || study.name,
      description: form.description ?? study.description,
      app_description: form.app_description ?? study.app_description,
      status: form.status || study.status,
      sync_interval_minutes: form.sync_interval_minutes ?? study.sync_interval_minutes,
      config: updatedConfig,
    }).eq('id', id)
    if (error) return
    // Apply PIN changes via the server function (hashes it; never stored in plain text).
    // - pinRequired off  -> clear any PIN
    // - pinInput set      -> set/replace the PIN
    // - pinRequired on but no new input -> leave the existing PIN unchanged
    if (!pinRequired) {
      await supabase.rpc('set_study_pin', { p_study: id, p_pin: null })
    } else if (pinInput) {
      const { error: pinErr } = await supabase.rpc('set_study_pin', { p_study: id, p_pin: pinInput })
      if (pinErr) { setPinError(pinErr.message); return }
    }
    setPinInput('')
    setStudy({ ...study, ...form, config: updatedConfig, pin_required: pinRequired } as Study)
    setEditing(false)
  }

  async function handleDelete() {
    if (!confirm('Delete this study and all its data? This cannot be undone.')) return
    await supabase.from('studies').delete().eq('id', id)
    router.push('/studies')
  }

  if (!study) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-24" />
        <div className="h-36 bg-gray-200 rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
        </div>
      </div>
    )
  }

  const tabs = [
    { href: `/studies/${id}/participants`,  label: 'Participants',    icon: Users,         description: `${participantCount} enrolled` },
    { href: `/studies/${id}/data`,          label: 'Sensor Data',     icon: Database,      description: 'Browse & export' },
    { href: `/studies/${id}/processed`,     label: 'Processed Data',  icon: Clock,         description: 'Hourly usage & more' },
    { href: `/studies/${id}/esm-responses`, label: 'ESM Responses',    icon: MessageSquare, description: 'Survey responses' },
    { href: `/studies/${id}/esm`,           label: 'ESM / EMA Config', icon: ClipboardList, description: 'Survey schedules' },
    { href: `/studies/${id}/config`,        label: 'Sensor Config',   icon: Settings,      description: 'Collection settings' },
  ]

  return (
    <div className="space-y-6">
      <Link href="/studies" className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors">
        <ArrowLeft size={15} /> Back to Studies
      </Link>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {editing ? (
          <div className="px-6 py-5 space-y-4">
            <h2 className="font-semibold text-gray-800 mb-4">Edit Study</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Name</label>
              <input
                value={form.name || ''}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Description <span className="text-gray-400 font-normal">(internal)</span></label>
              <textarea
                value={form.description || ''}
                onChange={e => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">App Description <span className="text-gray-400 font-normal">(shown to participants)</span></label>
              <textarea
                value={form.app_description || ''}
                onChange={e => setForm({ ...form, app_description: e.target.value })}
                rows={2}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
                <select
                  value={form.status}
                  onChange={e => setForm({ ...form, status: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                >
                  {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Sync Interval (minutes)</label>
                <input
                  type="number"
                  value={form.sync_interval_minutes || 30}
                  onChange={e => setForm({ ...form, sync_interval_minutes: parseInt(e.target.value) })}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">App Permissions</label>
              <div className="grid grid-cols-2 gap-2">
                {/* Guided Permissions */}
                <div
                  className={`flex items-center justify-between rounded-xl border-2 px-4 py-3.5 cursor-pointer transition-all ${
                    guidedPermissions ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                  onClick={() => setGuidedPermissions(v => !v)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      guidedPermissions ? 'bg-blue-100' : 'bg-gray-100'
                    }`}>
                      <ShieldCheck size={17} className={guidedPermissions ? 'text-blue-600' : 'text-gray-400'} />
                    </div>
                    <div className="min-w-0">
                      <p className={`font-semibold text-sm ${guidedPermissions ? 'text-gray-900' : 'text-gray-600'}`}>
                        Guided Permissions
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                        Walk participants through granting permissions on first launch
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={guidedPermissions} onChange={e => setGuidedPermissions(e.target.checked)} className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white" />
                  </label>
                </div>

                {/* Auto Participant ID */}
                <div
                  className={`flex items-center justify-between rounded-xl border-2 px-4 py-3.5 cursor-pointer transition-all ${
                    autoParticipantId ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                  onClick={() => setAutoParticipantId(v => !v)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      autoParticipantId ? 'bg-blue-100' : 'bg-gray-100'
                    }`}>
                      <BadgeCheck size={17} className={autoParticipantId ? 'text-blue-600' : 'text-gray-400'} />
                    </div>
                    <div className="min-w-0">
                      <p className={`font-semibold text-sm ${autoParticipantId ? 'text-gray-900' : 'text-gray-600'}`}>
                        Auto Participant ID
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                        Automatically assign a unique ID to each participant on enrollment
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={autoParticipantId} onChange={e => setAutoParticipantId(e.target.checked)} className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white" />
                  </label>
                </div>
              </div>
            </div>

            {/* Study PIN */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Study PIN</label>
              <div className={`rounded-xl border-2 transition-all ${pinRequired ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between px-4 py-3.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${pinRequired ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      <Lock size={17} className={pinRequired ? 'text-blue-600' : 'text-gray-400'} />
                    </div>
                    <div className="min-w-0">
                      <p className={`font-semibold text-sm ${pinRequired ? 'text-gray-900' : 'text-gray-600'}`}>Require a 4-digit PIN to join</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">Only participants given the PIN can enrol in this study</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                    <input type="checkbox" checked={pinRequired} onChange={e => { setPinRequired(e.target.checked); if (!e.target.checked) setPinInput('') }} className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white" />
                  </label>
                </div>
                {pinRequired && (
                  <div className="px-4 pb-4 pt-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      value={pinInput}
                      onChange={e => { setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinError(null) }}
                      placeholder="Set a new PIN"
                      className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm tracking-[0.4em] font-mono text-center focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    />
                    <p className="text-xs text-gray-400 mt-1.5">
                      Leave blank to keep the current PIN. The PIN is stored securely and never shown again.
                    </p>
                    {pinError && <p className="text-xs text-red-600 mt-1">{pinError}</p>}
                  </div>
                )}
              </div>
            </div>

            {/* Banking Pause */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Banking App Pause</label>
              <div className={`rounded-xl border-2 transition-all ${bankingPause.enabled ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between px-4 py-3.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${bankingPause.enabled ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      <CreditCard size={17} className={bankingPause.enabled ? 'text-blue-600' : 'text-gray-400'} />
                    </div>
                    <div className="min-w-0">
                      <p className={`font-semibold text-sm ${bankingPause.enabled ? 'text-gray-900' : 'text-gray-600'}`}>Banking Pause</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">Pause participants when banking apps are detected open</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={bankingPause.enabled} onChange={e => setBankingPause(p => ({ ...p, enabled: e.target.checked }))} className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white" />
                  </label>
                </div>
                <div className="px-4 pb-4 pt-1 border-t border-blue-100 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Reminder (minutes)</label>
                      <input
                        type="number"
                        min={1}
                        value={bankingPause.reminder_minutes}
                        onChange={e => setBankingPause(p => ({ ...p, reminder_minutes: parseInt(e.target.value) || 30 }))}
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Escalation (minutes)</label>
                      <input
                        type="number"
                        min={1}
                        value={bankingPause.escalation_minutes}
                        onChange={e => setBankingPause(p => ({ ...p, escalation_minutes: parseInt(e.target.value) || 120 }))}
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2">Monitored App Package IDs</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {bankingPause.apps.map(app => (
                        <span key={app} className="inline-flex items-center gap-1.5 text-xs bg-white border border-gray-200 text-gray-700 px-2.5 py-1 rounded-full font-mono">
                          {app}
                          <button
                            type="button"
                            onClick={() => setBankingPause(p => ({ ...p, apps: p.apps.filter(a => a !== app) }))}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newAppId}
                        onChange={e => setNewAppId(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            const trimmed = newAppId.trim()
                            if (trimmed && !bankingPause.apps.includes(trimmed)) {
                              setBankingPause(p => ({ ...p, apps: [...p.apps, trimmed] }))
                              setNewAppId('')
                            }
                          }
                        }}
                        placeholder="com.example.bankapp"
                        className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const trimmed = newAppId.trim()
                          if (trimmed && !bankingPause.apps.includes(trimmed)) {
                            setBankingPause(p => ({ ...p, apps: [...p.apps, trimmed] }))
                            setNewAppId('')
                          }
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors"
                      >
                        <Plus size={12} /> Add
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors">
                Save Changes
              </button>
              <button onClick={() => {
                setEditing(false)
                setForm(study)
                setGuidedPermissions(!!(study.config?.guided_permissions))
                setAutoParticipantId(!!(study.config?.auto_participant_id))
                setBankingPause(study.config?.banking_pause
                  ? { enabled: study.config.banking_pause.enabled ?? true, apps: study.config.banking_pause.apps ?? DEFAULT_BANKING_APPS, reminder_minutes: study.config.banking_pause.reminder_minutes ?? 30, escalation_minutes: study.config.banking_pause.escalation_minutes ?? 120 }
                  : { enabled: true, apps: DEFAULT_BANKING_APPS, reminder_minutes: 30, escalation_minutes: 120 })
                setNewAppId('')
              }} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleDelete} className="ml-auto flex items-center gap-1.5 px-4 py-2 text-red-500 hover:bg-red-50 border border-red-200 rounded-lg text-sm transition-colors">
                <Trash2 size={14} /> Delete Study
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl font-bold text-gray-900">{study.name}</h1>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[study.status] || STATUS_STYLES.draft}`}>
                    {study.status}
                  </span>
                </div>
                {study.description && <p className="text-gray-500 text-sm mt-1.5">{study.description}</p>}
                {study.app_description && (
                  <p className="text-gray-400 text-xs mt-1">
                    <span className="font-medium text-gray-500">App: </span>{study.app_description}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                  <span>{participantCount} participants</span>
                  <span>Sync every {study.sync_interval_minutes} min</span>
                  {study.config?.guided_permissions && (
                    <span className="inline-flex items-center gap-1 text-blue-600 font-medium">
                      <ShieldCheck size={12} /> Guided permissions
                    </span>
                  )}
                  {study.config?.auto_participant_id && (
                    <span className="inline-flex items-center gap-1 text-blue-600 font-medium">
                      <BadgeCheck size={12} /> Auto participant ID
                    </span>
                  )}
                  {study.config?.banking_pause?.enabled && (
                    <span className="inline-flex items-center gap-1 text-blue-600 font-medium">
                      <CreditCard size={12} /> Banking pause ({study.config.banking_pause.apps?.length ?? 0} apps)
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors shrink-0"
              >
                <Edit2 size={13} /> Edit
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {tabs.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className="bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all px-4 py-4 flex items-center gap-3 group"
          >
            <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center group-hover:bg-blue-50 transition-colors shrink-0">
              <tab.icon size={16} className="text-gray-500 group-hover:text-blue-500 transition-colors" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">{tab.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{tab.description}</p>
            </div>
            <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-400 ml-auto shrink-0 transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  )
}
