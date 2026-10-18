'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { KeyRound, Unlock } from 'lucide-react'
import { Badge, Button, errorText } from '@/components/ui'

type Attempt = {
  study_id: string
  device_id: string
  fails: number
  last_fail_at: string
  locked_until: string | null
}

/**
 * Phones that typed a wrong study PIN, with a way to clear their attempts.
 * Renders nothing while there are none.
 */
export function PinLockouts({ studyId, canEdit = true }: { studyId: string; canEdit?: boolean }) {
  const supabase = useMemo(() => createClient(), [])
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchAttempts = useCallback(async () => {
    const { data, error } = await supabase.from('pin_attempts').select('*')
      .eq('study_id', studyId).order('last_fail_at', { ascending: false })
    return { rows: (data || []) as Attempt[], error: error ? `Could not load PIN attempts: ${errorText(error)}` : null }
  }, [supabase, studyId])

  useEffect(() => {
    let cancelled = false
    fetchAttempts().then(res => { if (!cancelled) { setAttempts(res.rows); setError(res.error) } })
    return () => { cancelled = true }
  }, [fetchAttempts])

  async function unlock(deviceId: string) {
    setBusy(deviceId)
    setError(null)
    const { data, error } = await supabase.from('pin_attempts').delete()
      .eq('study_id', studyId).eq('device_id', deviceId).select('device_id')
    const problem = error ? errorText(error) : !data?.length ? 'You do not have permission to clear PIN attempts.' : null
    const res = await fetchAttempts()
    setAttempts(res.rows)
    setError(problem ?? res.error)
    setBusy(null)
  }

  if (!attempts.length && !error) return null
  return (
    <section aria-labelledby="pin-lockouts-title" className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line bg-warning-soft px-4 py-2.5">
        <KeyRound size={15} className="text-warning" aria-hidden="true" />
        <h3 id="pin-lockouts-title" className="text-sm font-semibold text-fg">Wrong PIN attempts</h3>
      </div>
      {error && <p role="alert" className="border-b border-line bg-danger-soft px-4 py-2 text-xs text-danger">{error}</p>}
      <ul className="divide-y divide-line">
        {attempts.map(a => {
          const locked = !!a.locked_until && new Date(a.locked_until) > new Date()
          return (
            <li key={a.device_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                  <span className="break-all font-mono text-xs">{a.device_id}</span>
                  {locked && <Badge tone="red">Locked</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-subtle">
                  {a.fails} failed attempt{a.fails === 1 ? '' : 's'} · {locked
                    ? `locked until ${new Date(a.locked_until!).toLocaleString()}`
                    : `last attempt ${new Date(a.last_fail_at).toLocaleString()}`}
                </p>
              </div>
              {canEdit && (
                <Button variant="secondary" size="sm" loading={busy === a.device_id} onClick={() => unlock(a.device_id)}
                  aria-label={`Clear PIN attempts for ${a.device_id}`}>
                  {busy !== a.device_id && <Unlock size={12} aria-hidden="true" />} Clear attempts
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
