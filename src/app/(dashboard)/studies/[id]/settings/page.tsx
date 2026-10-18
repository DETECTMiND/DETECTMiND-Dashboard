'use client'

import { createClient } from '@/lib/supabase-browser'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Users, Database, ClipboardList, Settings, Edit2, Trash2, ChevronRight, MessageSquare, ShieldCheck, BadgeCheck, X, Plus, CreditCard, Clock, Lock, Download, UsersRound } from 'lucide-react'
import { useStudyAccess, STUDY_ROLE_LABEL } from '@/lib/access'
import { Notice, errorText, type NoticeState } from '@/components/feedback'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { isPendingApproval, statusOptionsFor } from '@/lib/pending-studies'
import { downloadBlob, exportStudyZip } from '@/lib/export-study'

interface Study {
  id: string
  name: string
  description: string | null
  app_description: string | null
  status: string
  sync_interval_minutes: number
  config: StudyConfig | null
  pin_required?: boolean
  approved_at?: string | null
  created_at: string
}

interface BankingPause {
  enabled: boolean
  apps: string[]
  reminder_minutes: number
  escalation_minutes: number
}

interface StudyConfig {
  guided_permissions?: boolean
  auto_participant_id?: boolean
  banking_pause?: Partial<BankingPause>
  [key: string]: unknown
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

export default function StudyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const access = useStudyAccess(id)
  const [notice, setNotice] = useState<NoticeState>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
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
  const [bankingPause, setBankingPause] = useState<BankingPause>({
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
  // Admin-only: delete (typed name) or reject a pending study (reason), both via delete_study().
  const [deleteMode, setDeleteMode] = useState<'delete' | 'reject' | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [approving, setApproving] = useState(false)
  const isAdmin = access.role === 'admin'

  useEffect(() => {
    if (!editing) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [editing])

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.from('studies').select('*').eq('id', id).maybeSingle()
      if (error || !data) {
        setLoadError(error ? errorText(error) : 'This study does not exist or you do not have access to it.')
        return
      }
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
    void load()
  }, [id, supabase])

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
    setSaving(true)
    setNotice(null)
    // Only send status when it changed: the DB decides who may change it.
    const nextStatus = form.status || study.status
    const { data: saved, error } = await supabase.from('studies').update({
      name: form.name || study.name,
      description: form.description ?? study.description,
      app_description: form.app_description ?? study.app_description,
      ...(nextStatus !== study.status ? { status: nextStatus } : {}),
      sync_interval_minutes: form.sync_interval_minutes ?? study.sync_interval_minutes,
      config: updatedConfig,
    }).eq('id', id).select('id')
    if (error || !saved?.length) {
      setSaving(false)
      setNotice({ tone: 'error', text: `Could not save the study: ${error ? errorText(error) : 'you do not have permission to edit it.'}` })
      return
    }
    // Apply PIN changes via the server function (hashes it; never stored in plain text).
    // - pinRequired off  -> clear any PIN
    // - pinInput set      -> set/replace the PIN
    // - pinRequired on but no new input -> leave the existing PIN unchanged
    if (!pinRequired && study.pin_required) {
      const { error: pinErr } = await supabase.rpc('set_study_pin', { p_study: id, p_pin: null })
      if (pinErr) { setSaving(false); setPinError(errorText(pinErr)); return }
    } else if (pinRequired && pinInput) {
      const { error: pinErr } = await supabase.rpc('set_study_pin', { p_study: id, p_pin: pinInput })
      if (pinErr) { setSaving(false); setPinError(errorText(pinErr)); return }
    } else if (pinRequired && !study.pin_required) {
      setSaving(false)
      setPinError('Enter a 4-digit PIN to turn the PIN on')
      return
    }
    setSaving(false)
    setPinInput('')
    setStudy({ ...study, ...form, config: updatedConfig, pin_required: pinRequired } as Study)
    setEditing(false)
    setNotice({ tone: 'success', text: 'Study saved.' })
    if (nextStatus !== study.status) await reloadStudy()
  }

  /** Re-reads the study (status / approval are set by the database). */
  async function reloadStudy() {
    const { data } = await supabase.from('studies').select('*').eq('id', id).maybeSingle()
    if (data) { setStudy(data); setForm(data) }
  }

  async function handleApprove() {
    if (!study) return
    setApproving(true)
    setNotice(null)
    const { data, error } = await supabase.from('studies').update({ status: 'active' }).eq('id', id).select('id')
    setApproving(false)
    if (error || !data?.length) {
      setNotice({ tone: 'error', text: `Could not approve the study: ${error ? errorText(error) : 'only an admin can approve it.'}` })
      return
    }
    await reloadStudy()
    setNotice({ tone: 'success', text: `${study.name} is approved and active. Participants can now join.` })
  }

  function openDelete(mode: 'delete' | 'reject') {
    setDeleteReason('')
    setDeleteError(null)
    setDeleteMode(mode)
  }

  async function handleExport() {
    if (!study) return
    setNotice(null)
    setExportStatus('Starting…')
    try {
      const { blob, filename, counts } = await exportStudyZip(supabase, study, setExportStatus)
      downloadBlob(blob, filename)
      const rows = Object.entries(counts).filter(([t]) => t.startsWith('data_')).reduce((a, [, n]) => a + n, 0)
      setNotice({ tone: 'success', text: `Exported ${counts.participants ?? 0} participants and ${rows.toLocaleString()} data rows to ${filename}.` })
    } catch (e) {
      setNotice({ tone: 'error', text: `Export failed: ${e instanceof Error ? e.message : 'unknown error'}` })
    } finally {
      setExportStatus(null)
    }
  }

  async function handleDelete() {
    if (!study || !deleteMode) return
    const reason = deleteReason.trim()
    if (deleteMode === 'reject' && !reason) { setDeleteError('Enter a reason for rejecting this study.'); return }
    setDeleting(true)
    setDeleteError(null)
    const { error } = await supabase.rpc('delete_study', {
      p_study: id,
      p_reason: reason ? (deleteMode === 'reject' ? `Rejected: ${reason}` : reason) : null,
    })
    if (error) {
      setDeleteError(errorText(error))
      setDeleting(false)
      return
    }
    router.push('/studies')
  }

  if (loadError) {
    return <div className="space-y-4">
      <Link href="/studies" className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors"><ArrowLeft size={15} /> Back to Studies</Link>
      <Notice notice={{ tone: 'error', text: loadError }} />
    </div>
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

  const pending = isPendingApproval(study)
  const statusRule = statusOptionsFor(access.role, study)
  const statusChoices = statusRule.options.includes(form.status ?? study.status)
    ? statusRule.options
    : [form.status ?? study.status, ...statusRule.options]

  const tabs = [
    { href: `/studies/${id}/participants`,  label: 'Participants',    icon: Users,         description: `${participantCount} enrolled` },
    { href: `/studies/${id}/data`,          label: 'Sensor Data',     icon: Database,      description: 'Browse & export' },
    { href: `/studies/${id}/processed`,     label: 'Processed Data',  icon: Clock,         description: 'Hourly usage & more' },
    { href: `/studies/${id}/esm-responses`, label: 'ESM Responses',    icon: MessageSquare, description: 'Survey responses' },
    { href: `/studies/${id}/esm`,           label: 'ESM / EMA Config', icon: ClipboardList, description: 'Survey schedules' },
    { href: `/studies/${id}/config`,        label: 'Sensor Config',   icon: Settings,      description: 'Collection settings' },
    { href: `/studies/${id}/team`,          label: 'Team',            icon: UsersRound,    description: access.role ? `You: ${STUDY_ROLE_LABEL[access.role]}` : 'Members & roles' },
  ]

  return (
    <div className="space-y-6">
      <Link href="/studies" className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition-colors">
        <ArrowLeft size={15} /> Back to Studies
      </Link>

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {pending && (
        <div role="status" aria-label="Pending approval" className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center">
          <Clock size={18} className="hidden shrink-0 text-amber-600 sm:block" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm text-amber-900">
            <p className="font-semibold">Pending approval</p>
            <p className="mt-0.5 text-amber-800">
              {isAdmin
                ? 'This study is waiting for an admin to review it. Participants cannot join until it is approved.'
                : 'An admin will review this study before participants can join. You can set it up in the meantime.'}
            </p>
          </div>
          {isAdmin && (
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={handleApprove} disabled={approving}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {approving ? 'Approving…' : 'Approve'}
              </button>
              <button type="button" onClick={() => openDelete('reject')} disabled={approving}
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                Reject
              </button>
            </div>
          )}
        </div>
      )}

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
                  aria-label="Status"
                  value={form.status}
                  disabled={!statusRule.editable}
                  onChange={e => setForm({ ...form, status: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all disabled:bg-gray-50 disabled:text-gray-500"
                >
                  {statusChoices.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {statusRule.reason && <p className="mt-1 text-xs text-gray-400">{statusRule.reason}</p>}
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
                  <div className="px-4 pb-4 pt-1 border-t border-blue-100/70">
                    <div className="flex items-center gap-3 mt-3">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        value={pinInput}
                        onChange={e => { setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinError(null) }}
                        placeholder="••••"
                        className={`w-28 px-3 py-2.5 border rounded-lg text-lg font-mono text-center tracking-[0.5em] pl-[0.5em] focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${pinError ? 'border-red-300' : 'border-gray-200 focus:border-blue-400'}`}
                      />
                      <p className="text-xs text-gray-400 leading-relaxed flex-1">
                        Enter 4 digits to set or replace the PIN. Leave blank to keep the current one. It&apos;s stored securely and never shown again.
                      </p>
                    </div>
                    {pinError && <p className="text-xs text-red-600 mt-2">{pinError}</p>}
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
              <button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors">
                {saving ? 'Saving…' : 'Save Changes'}
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
              {isAdmin && <button type="button" onClick={() => openDelete('delete')} className="ml-auto flex items-center gap-1.5 px-4 py-2 text-red-500 hover:bg-red-50 border border-red-200 rounded-lg text-sm transition-colors">
                <Trash2 size={14} /> Delete study
              </button>}
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
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <button
                  onClick={handleExport}
                  disabled={!!exportStatus}
                  title="Download every table for this study as CSV files in a zip"
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60 transition-colors"
                >
                  <Download size={13} /> {exportStatus ? `Exporting: ${exportStatus}` : 'Export all study data'}
                </button>
                {access.canEdit && (
                  <button
                    onClick={() => setEditing(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <Edit2 size={13} /> Edit
                  </button>
                )}
              </div>
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

      <ConfirmDialog
        open={deleteMode !== null}
        tone="danger"
        title={deleteMode === 'reject' ? `Reject ${study.name}?` : `Delete ${study.name}?`}
        body={deleteMode === 'reject'
          ? <p>Rejecting deletes this pending study and its setup. The reason is kept in the audit log.</p>
          : <p>This permanently deletes the study, its {participantCount} participant{participantCount === 1 ? '' : 's'} and all collected data. This cannot be undone.</p>}
        confirmLabel={deleteMode === 'reject' ? 'Reject study' : 'Delete permanently'}
        requireText={deleteMode === 'delete' ? study.name : undefined}
        busy={deleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => { if (!deleting) setDeleteMode(null) }}
      >
        <label className="block text-sm font-medium text-gray-700">
          Reason{deleteMode === 'delete' && <span className="font-normal text-gray-400"> (optional)</span>}
          <textarea value={deleteReason} onChange={e => setDeleteReason(e.target.value)} rows={2} maxLength={1000}
            required={deleteMode === 'reject'}
            className="mt-1.5 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
        </label>
      </ConfirmDialog>
    </div>
  )
}
