'use client'

import { useState } from 'react'
import { inputClass } from './field'

type Unit = 'sec' | 'min' | 'hr'
const FACTOR: Record<Unit, number> = { sec: 1, min: 60, hr: 3600 }

function bestUnit(seconds: number): Unit {
  if (seconds >= 3600 && seconds % 3600 === 0) return 'hr'
  if (seconds >= 60 && seconds % 60 === 0) return 'min'
  return 'sec'
}

/**
 * Sampling interval entered as a number + unit (seconds / minutes / hours),
 * stored as seconds. Warns below 60 s: Android limits wake-ups in Doze, so
 * shorter intervals are stretched while the phone sleeps.
 */
export function IntervalInput({ seconds, onChange, id, disabled, min = 1, describedBy }: {
  seconds: number
  onChange: (seconds: number) => void
  id?: string
  disabled?: boolean
  min?: number
  describedBy?: string
}) {
  const [unit, setUnit] = useState<Unit>(() => bestUnit(seconds || 60))
  const value = seconds ? +(seconds / FACTOR[unit]).toFixed(2) : ''
  return (
    <div>
      <div className="flex gap-2">
        <input id={id} type="number" inputMode="decimal" min={min / FACTOR[unit]} step="any" value={value} disabled={disabled}
          aria-describedby={describedBy}
          onChange={e => {
            const n = Number(e.target.value)
            if (Number.isFinite(n) && n > 0) onChange(Math.max(min, Math.round(n * FACTOR[unit])))
          }}
          className={`${inputClass} w-28`} />
        <select aria-label="Unit" value={unit} disabled={disabled} onChange={e => setUnit(e.target.value as Unit)}
          className={`${inputClass} w-28 pr-8`}>
          <option value="sec">seconds</option>
          <option value="min">minutes</option>
          <option value="hr">hours</option>
        </select>
      </div>
      {seconds > 0 && seconds < 60 && (
        <p className="mt-1.5 text-xs text-amber-700">Under a minute: Android may stretch this while the phone is asleep. 1–10 minutes is typical.</p>
      )}
    </div>
  )
}

/** "every 10 min", "every 30 s", "every 2 h" */
export function formatInterval(seconds: number | null | undefined): string {
  if (!seconds) return '—'
  const u = bestUnit(seconds)
  const n = seconds / FACTOR[u]
  return `every ${n} ${u === 'sec' ? 's' : u === 'min' ? 'min' : 'h'}`
}
