'use client'

import { useId, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { errorText } from '@/components/feedback'
import { Button, Modal } from '@/components/ui'
import { tableLabel } from '@/lib/sensors'

const EXTRA_LABELS: Record<string, string> = {
  data_gesture_pauses: 'Gesture pauses',
  data_permission_events: 'Permission changes',
  sync_log: 'Sync history',
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
  const inputId = useId()
  const formId = useId()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const confirmWord = participant.deviceId
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0

  async function run(e?: React.FormEvent) {
    e?.preventDefault()
    if (typed.trim() !== confirmWord || busy) return
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

  if (counts) {
    return (
      <Modal open onClose={finish} size="sm" title="Participant deleted"
        footer={<Button onClick={finish} data-autofocus="">Done</Button>}>
        <p className="text-sm text-muted">
          <strong className="text-fg">{participant.name}</strong> and {total.toLocaleString()} rows were removed. This is recorded in the activity log.
        </p>
        <table className="mt-4 w-full text-sm">
          <tbody className="divide-y divide-line">
            {Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => (
              <tr key={t}>
                <td className="py-1.5 text-muted">{EXTRA_LABELS[t] ?? tableLabel(t)}</td>
                <td className="py-1.5 text-right font-medium tabular-nums text-fg">{n.toLocaleString()}</td>
              </tr>
            ))}
            {total === 0 && <tr><td className="py-1.5 text-subtle">No collected data</td><td /></tr>}
          </tbody>
        </table>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} dismissible={!busy} size="sm" title="Delete participant?"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" form={formId} variant="danger" loading={busy} disabled={typed.trim() !== confirmWord || busy}>
          {busy ? 'Deleting…' : 'Delete permanently'}
        </Button>
      </>}>
      <form id={formId} onSubmit={run} className="space-y-4">
        <p className="text-sm text-muted">
          This permanently deletes <strong className="text-fg">{participant.name}</strong> and <strong className="text-fg">everything collected from them</strong>:
          sensor data, survey responses and sync history. It cannot be undone. Export the data first if you need to keep it.
        </p>
        {mergedChildren.length > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {mergedChildren.join(', ')} {mergedChildren.length === 1 ? 'is' : 'are'} merged into this participant. Delete {mergedChildren.length === 1 ? 'it' : 'them'} first.
          </p>
        )}
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium text-fg">
            Type the device ID <code className="break-all rounded bg-sunken px-1 font-mono text-xs">{confirmWord}</code> to confirm
          </label>
          <input id={inputId} data-autofocus="" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
            className="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface px-3 font-mono text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25" />
        </div>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </form>
    </Modal>
  )
}
