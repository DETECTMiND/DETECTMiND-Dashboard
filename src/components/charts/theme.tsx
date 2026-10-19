'use client'

import { useEffect, useRef, useState } from 'react'

// Chart colours come from CSS variables (globals.css) so every chart follows
// the light/dark theme. SVG fill/stroke accept var(); <canvas> needs the
// resolved values, see useResolvedColors.

export const SERIES = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
]

export const seriesColor = (i: number) => SERIES[((i % SERIES.length) + SERIES.length) % SERIES.length]

/** Meaningful colours (state, not series). */
export const C = {
  blue: 'var(--chart-1)',
  green: 'var(--chart-2)',
  amber: 'var(--chart-3)',
  violet: 'var(--chart-4)',
  red: 'var(--chart-5)',
  cyan: 'var(--chart-6)',
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  muted: 'var(--chart-axis)',
  surface: 'var(--surface)',
  sunken: 'var(--surface-sunken)',
  fg: 'var(--fg)',
}

export const axisTick = { fontSize: 11, fill: C.axis }
export const axisLine = { stroke: C.grid }
export const gridProps = { strokeDasharray: '3 3', stroke: C.grid }
export const legendStyle = { fontSize: 12, paddingTop: 8, color: C.axis }

/** Props for recharts' default <Tooltip>. */
export const tooltipProps = {
  contentStyle: {
    background: 'var(--chart-tooltip-bg)',
    border: '1px solid var(--chart-tooltip-border)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--fg)',
  },
  labelStyle: { color: 'var(--fg)', fontWeight: 600 },
  itemStyle: { color: 'var(--fg-muted)' },
  cursor: { fill: 'var(--surface-sunken)', opacity: 0.6 },
}

/** Box for custom tooltip content. */
export function TooltipBox({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`max-w-xs space-y-1 rounded-lg border p-3 text-xs text-fg shadow-lg ${className}`}
      style={{ background: 'var(--chart-tooltip-bg)', borderColor: 'var(--chart-tooltip-border)' }}>
      {children}
    </div>
  )
}

export function ChartSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function ChartEmpty({ children }: { children: React.ReactNode }) {
  return <div className="py-12 text-center text-sm text-subtle">{children}</div>
}

/** Mixes a CSS colour with transparent, for heatmap intensity (0..1). */
export function intensity(color: string, amount: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, amount)) * 100)
  return `color-mix(in oklab, ${color} ${pct}%, transparent)`
}

/** Width of an element, kept up to date (for hand-drawn SVGs that must fit their card). */
export function useElementWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.max(240, Math.floor(el.clientWidth)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** The current values of CSS variables, re-read when the theme changes (for <canvas>). */
export function useResolvedColors(names: string[]): Record<string, string> {
  const key = names.join(',')
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement)
      setValues(Object.fromEntries(key.split(',').map(n => [n, style.getPropertyValue(n).trim()])))
    }
    read()
    const mo = new MutationObserver(read)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => mo.disconnect()
  }, [key])
  return values
}
