'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from '@/components/feedback'

/**
 * Runs `run` whenever `key` changes (null = don't run). Results are keyed, so
 * a slow answer for an old key never overwrites a newer one. `previous` keeps
 * the last good data while a new key loads, for a calmer UI.
 */
export function useAsync<T>(key: string | null, run: () => Promise<T>) {
  const runRef = useRef(run)
  useEffect(() => { runRef.current = run })
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState<{ key: string; data?: T; error?: string } | null>(null)
  const [previous, setPrevious] = useState<T | undefined>(undefined)
  const fullKey = key === null ? null : `${key}#${tick}`

  useEffect(() => {
    if (fullKey === null) return
    let cancelled = false
    runRef.current().then(
      data => { if (!cancelled) { setResult({ key: fullKey, data }); setPrevious(data) } },
      (e: unknown) => { if (!cancelled) setResult({ key: fullKey, error: e instanceof Error ? e.message : String(e) }) },
    )
    return () => { cancelled = true }
  }, [fullKey])

  const retry = useCallback(() => setTick(t => t + 1), [])
  const current = result && result.key === fullKey ? result : null
  return {
    data: current?.data,
    previous,
    error: current?.error ?? null,
    loading: fullKey !== null && !current,
    retry,
  }
}

/** Unwraps a Supabase response, throwing a readable error. */
export function must<T>(res: { data: T | null; error: { message: string; details?: string | null; hint?: string | null } | null }): T {
  if (res.error) throw new Error(errorText(res.error))
  return res.data as T
}

/** Like `must` for count-only (head) requests. */
export function mustCount(res: { count: number | null; error: { message: string } | null }): number {
  if (res.error) throw new Error(errorText(res.error))
  return res.count ?? 0
}
