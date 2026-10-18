'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { errorText } from '@/components/feedback'

const TABLE_LABEL: Record<string, string> = {
  data_app_usage: 'App usage',
  data_notifications: 'Notifications',
  data_battery: 'Battery',
  data_calls: 'Calls',
  data_sms: 'SMS',
  data_esm_responses: 'Survey responses',
  data_location: 'Location',
  data_light: 'Light',
  data_screen_state: 'Screen state',
  data_gestures: 'Gestures',
  data_steps: 'Steps',
  data_proximity: 'Proximity',
  data_gesture_pauses: 'Gesture pauses',
  data_permission_events: 'Permission events',
  sync_log: 'Sync log',
  participant_merge_audit: 'Merge records',
}

type Counts = Record<string, number>

/**
 * Typed-confirmation dialog for delete_participant(). The database checks
 * that the caller owns the study (or is an admin) and refuses while other
 * participants are merged into this one.
 */
export function DeleteParticipantModal({ participant, mergedChildren, onClose, onDeleted }: {
  participant: { id: string; name: string; deviceId: string }
  mergedChildren: string[]
  onClose: () => void
  onDeleted: (summary: string) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const confirmWord = participant.deviceId
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function run() {
    if (typed.trim() !== confirmWord) return
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('delete_participant', { p_id: participant.id })
    setBusy(false)
    if (error) { setError(errorText(error)); return }
    setCounts(((data as { counts?: Counts } | null)?.counts) ?? {})
  }

  function finish() {
    onDeleted(`${participant.name} and ${total.toLocaleString()} data rows were permanently deleted.`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="delete-participant-title">
      <button className="absolute inset-0 bg-slate-950/45" onClick={() => !busy && (counts ? finish() : onClose())} aria-label="Close" />
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id="delete-participant-title" className="flex items-center gap-2 text-lg font-bold text-gray-900">
            {counts ? <CheckCircle2 size={20} className="text-emerald-600" /> : <AlertTriangle size={20} className="text-red-600" />}
            {counts ? 'Participant deleted' : 'Delete participant?'}
          </h2>
          <button onClick={() => counts ? finish() : onClose()} disabled={busy} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" aria-label="Close"><X size={18} /></button>
        </div>

        {counts ? (
          <>
            <p className="mt-2 text-sm text-gray-600">
              <strong>{participant.name}</strong> and {total.toLocaleString()} rows were removed. This has been recorded in the audit log.
            </p>
            <table className="mt-4 w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => (
                  <tr key={t}><td className="py-1.5 text-gray-600">{TABLE_LABEL[t] ?? t}</td><td className="py-1.5 text-right font-medium tabular-nums text-gray-900">{n.toLocaleString()}</td></tr>
                ))}
                {total === 0 && <tr><td className="py-1.5 text-gray-500">No collected data</td><td /></tr>}
              </tbody>
            </table>
            <div className="mt-6 flex justify-end">
              <button onClick={finish} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Done</button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-gray-600">
              This permanently deletes <strong>{participant.name}</strong> and <strong>everything collected from them</strong>:
              sensor data, survey responses and sync history. It cannot be undone. Export the data first if you need to keep it.
            </p>
            {mergedChildren.length > 0 && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {mergedChildren.join(', ')} {mergedChildren.length === 1 ? 'is' : 'are'} merged into this participant. Delete {mergedChildren.length === 1 ? 'it' : 'them'} first.
              </p>
            )}
            <label className="mt-5 block text-sm font-medium text-gray-700">
              Type the device ID <code className="rounded bg-gray-100 px-1 font-mono text-xs">{confirmWord}</code> to confirm
              <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm" />
            </label>
            {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={onClose} disabled={busy} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={run} disabled={typed.trim() !== confirmWord || busy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
