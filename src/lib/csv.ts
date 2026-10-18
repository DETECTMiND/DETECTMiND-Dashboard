// CSV and paging helpers shared by every export. PostgREST returns at most
// 1000 rows per request, so exports must page with fetchAll or they are cut off.

export type Row = Record<string, unknown>

const PAGE = 1000

/**
 * Fetch every row of a query, 1000 at a time.
 * Usage: fetchAll((from, to) => supabase.from('t').select('*').eq(...).order('id').range(from, to))
 * Always give the query a stable order, or rows can repeat or go missing between pages.
 */
export async function fetchAll<T = Row>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  { limit }: { limit?: number } = {},
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const to = limit ? Math.min(from + PAGE, limit) - 1 : from + PAGE - 1
    const { data, error } = await build(from, to)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < to - from + 1 || (limit && out.length >= limit)) return out
  }
}

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  // Spreadsheet apps run cells starting with = + - @ as formulas
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** RFC 4180 CSV. Columns: the given order, else every key seen. JSON values are written as JSON. */
export function toCsv(rows: Row[], columns?: string[]): string {
  const cols = columns ?? (() => {
    const list: string[] = []
    const seen = new Set<string>()
    for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); list.push(k) }
    return list
  })()
  if (!cols.length) return ''
  const lines = [cols.map(csvCell).join(',')]
  for (const r of rows) lines.push(cols.map(c => csvCell(r[c])).join(','))
  return lines.join('\r\n') + '\r\n'
}

export function safeFileName(name: string) {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'export'
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Build and download a CSV file. */
export function downloadCsv(rows: Row[], filename: string, columns?: string[]) {
  const name = filename.endsWith('.csv') ? filename : `${filename}.csv`
  downloadBlob(new Blob(['﻿', toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }), name)
}

/** YYYY-MM-DD in the viewer's local time zone (not UTC). */
export function localDay(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
