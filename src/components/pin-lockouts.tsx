'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { KeyRound, Unlock } from 'lucide-react'

type Attempt = {
  study_id: string
  device_id: string
  fails: number
  last_fail_at: string
  locked_until: string | null
}

export function PinLockouts({ studyId }: { studyId: string }) {
  const supabase = createClient()
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('pin_attempts').select('*')
      .eq('study_id', studyId).order('last_fail_at', { ascending: false })
    setAttempts((data || []) as Attempt[])
  }, [studyId]) // eslint-disable-line react-hooks/exhaustive-deps

  // The effect starts an external database synchronization; state is updated
  // asynchronously after the request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function unlock(deviceId: string) {
    setBusy(deviceId)
    await supabase.from('pin_attempts').delete().eq('study_id', studyId).eq('device_id', deviceId)
    await load()
    setBusy(null)
  }

  if (!attempts.length) return null
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
      <div className="px-4 py-3 border-b border-amber-200 flex items-center gap-2 text-sm font-semibold text-amber-900">
        <KeyRound size={15} /> PIN attempts and lockouts
      </div>
      <div className="divide-y divide-amber-100">
        {attempts.map(a => {
          const locked = !!a.locked_until && new Date(a.locked_until) > new Date()
          return <div key={a.device_id} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
            <div>
              <p className="font-medium text-gray-800">{a.device_id}</p>
              <p className="text-xs text-gray-500">
                {a.fails} failed attempt{a.fails === 1 ? '' : 's'} · {locked
                  ? `locked until ${new Date(a.locked_until!).toLocaleString()}`
                  : `last attempt ${new Date(a.last_fail_at).toLocaleString()}`}
              </p>
            </div>
            <button onClick={() => unlock(a.device_id)} disabled={busy === a.device_id}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
              <Unlock size={12} /> {busy === a.device_id ? 'Unlocking…' : 'Clear attempts'}
            </button>
          </div>
        })}
      </div>
    </section>
  )
}
