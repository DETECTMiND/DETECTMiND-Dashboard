'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { ShieldCheck, AlertTriangle, CheckCircle } from 'lucide-react'
import { Badge, ErrorState, Modal, SegmentedControl, SkeletonRows, TableWrap, THead, Th, Td, Tr } from '@/components/ui'
import { must, useAsync } from '@/components/data/use-async'
import { permissionLabel } from '@/lib/sensors'

interface Participant {
  id: string
  device_id: string
  label: string | null
}

interface EventRow {
  permission: string
  action: string      // granted | revoked
  recorded_at: string
}

interface OutageRow {
  permission: string
  revoked_at: string
  restored_at: string | null
  outage_minutes: number | null
}

function pName(p: Participant) { return p.label || p.device_id }

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtDuration(mins: number | null): string {
  if (mins == null) return 'Still off'
  if (mins < 60) return `${Math.round(mins)} min`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** When a participant's permissions were turned off and back on. */
export function PermissionHistoryModal({
  participant, onClose,
}: {
  participant: Participant
  onClose: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [tab, setTab] = useState<'outages' | 'events'>('outages')

  const q = useAsync(`perm:${participant.id}`, async () => {
    const [evRes, outRes] = await Promise.all([
      supabase.from('data_permission_events').select('permission, action, recorded_at')
        .eq('participant_id', participant.id).order('recorded_at', { ascending: false }).limit(2000),
      supabase.from('permission_outages').select('permission, revoked_at, restored_at, outage_minutes')
        .eq('participant_id', participant.id).order('revoked_at', { ascending: false }).limit(2000),
    ])
    return { events: must(evRes) as EventRow[], outages: must(outRes) as OutageRow[] }
  })
  const events = q.data?.events
  const outages = q.data?.outages

  // Current state per permission (from the latest event).
  const currentState = useMemo(() => {
    const map: Record<string, string> = {}
    for (const e of events || []) if (!map[e.permission]) map[e.permission] = e.action
    return map
  }, [events])

  const openOutages = (outages || []).filter(o => o.restored_at == null).length

  return (
    <Modal open onClose={onClose} size="lg" title="Permission history" description={pName(participant)}
      footer={q.data ? (
        <p className="mr-auto self-center text-xs text-subtle">
          {openOutages > 0 ? `${openOutages} permission${openOutages > 1 ? 's are' : ' is'} turned off right now` : 'Every tracked permission is on right now'}
        </p>
      ) : undefined}>
      <div className="space-y-4">
        <SegmentedControl label="Show" value={tab} onChange={setTab} size="sm"
          options={[{ value: 'outages', label: 'Outages' }, { value: 'events', label: 'All changes' }]} />

        {q.data && Object.keys(currentState).length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Current permissions">
            {Object.entries(currentState).map(([perm, action]) => (
              <Badge key={perm} tone={action === 'granted' ? 'green' : 'red'}
                icon={action === 'granted' ? <CheckCircle size={11} aria-hidden="true" /> : <AlertTriangle size={11} aria-hidden="true" />}>
                {permissionLabel(perm)}{action === 'granted' ? '' : ' (off)'}
              </Badge>
            ))}
          </div>
        )}

        {q.error ? (
          <ErrorState message={q.error} onRetry={q.retry} />
        ) : !q.data ? (
          <SkeletonRows rows={5} />
        ) : tab === 'outages' ? (
          outages && outages.length > 0 ? (
            <TableWrap>
              <THead><tr><Th>Permission</Th><Th>Turned off</Th><Th>Turned back on</Th><Th>Off for</Th></tr></THead>
              <tbody>
                {outages.map((o, i) => (
                  <Tr key={i}>
                    <Td className="font-medium">{permissionLabel(o.permission)}</Td>
                    <Td className="whitespace-nowrap text-muted">{fmt(o.revoked_at)}</Td>
                    <Td className="whitespace-nowrap text-muted">{fmt(o.restored_at)}</Td>
                    <Td className={`whitespace-nowrap font-medium ${o.restored_at ? '' : 'text-danger'}`}>{fmtDuration(o.outage_minutes)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          ) : <Empty text="No permission outages" sub="This participant has not turned any permission off." />
        ) : events && events.length > 0 ? (
          <TableWrap>
            <THead><tr><Th>Permission</Th><Th>Change</Th><Th>When</Th></tr></THead>
            <tbody>
              {events.map((e, i) => (
                <Tr key={i}>
                  <Td className="font-medium">{permissionLabel(e.permission)}</Td>
                  <Td>{e.action === 'granted' ? <Badge tone="green">Turned on</Badge> : <Badge tone="red">Turned off</Badge>}</Td>
                  <Td className="whitespace-nowrap text-muted">{fmt(e.recorded_at)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <Empty text="No permission changes" sub="Changes appear here once the app reports them." />}
      </div>
    </Modal>
  )
}

function Empty({ text, sub }: { text: string; sub: string }) {
  return (
    <div className="py-10 text-center">
      <ShieldCheck size={28} className="mx-auto mb-2 text-subtle" aria-hidden="true" />
      <p className="text-sm font-medium text-fg">{text}</p>
      <p className="mt-1 text-sm text-subtle">{sub}</p>
    </div>
  )
}
