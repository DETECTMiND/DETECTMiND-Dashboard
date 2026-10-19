'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { errorText } from '@/components/feedback'

// Results are remembered per page and key for a few minutes, so going back to
// a page (or a tab) shows the last data at once while it refreshes in the
// background, instead of a skeleton every time.
const CACHE_LIMIT = 150
const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { data: unknown; at: number }>()

function readCache<T>(k: string): T | undefined {
  const hit = cache.get(k)
  if (!hit) return undefined
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(k); return undefined }
  return hit.data as T
}

function writeCache(k: string, data: unknown) {
  cache.delete(k)
  cache.set(k, { data, at: Date.now() })
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

/** Forget remembered results (e.g. after a change that affects several pages). */
export function clearAsyncCache() {
  cache.clear()
}

/**
 * Runs `run` whenever `key` changes (null = don't run). Results are keyed, so
 * a slow answer for an old key never overwrites a newer one. Remembered data
 * for the key is returned straight away while a fresh copy loads; `previous`
 * keeps the last good data of any key, for a calmer UI while filters change.
 */
export function useAsync<T>(key: string | null, run: () => Promise<T>) {
  const pathname = usePathname()
  const runRef = useRef(run)
  useEffect(() => { runRef.current = run })
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState<{ key: string; data?: T; error?: string } | null>(null)
  const [previous, setPrevious] = useState<T | undefined>(undefined)
  const fullKey = key === null ? null : `${key}#${tick}`
  const cacheKey = key === null ? null : `${pathname}|${key}`

  useEffect(() => {
    if (fullKey === null || cacheKey === null) return
    let cancelled = false
    runRef.current().then(
      data => {
        writeCache(cacheKey, data)
        if (!cancelled) { setResult({ key: fullKey, data }); setPrevious(data) }
      },
      (e: unknown) => { if (!cancelled) setResult({ key: fullKey, error: e instanceof Error ? e.message : String(e) }) },
    )
    return () => { cancelled = true }
  }, [fullKey, cacheKey])

  const retry = useCallback(() => setTick(t => t + 1), [])
  const current = result && result.key === fullKey ? result : null
  // A retry (tick > 0) always waits for fresh data; otherwise show what we remember
  const remembered = !current && cacheKey && tick === 0 ? readCache<T>(cacheKey) : undefined
  const data = current?.data ?? remembered
  return {
    data,
    previous: previous ?? remembered,
    error: data === undefined ? current?.error ?? null : null,
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
