'use client'

import { useEffect, useRef, useState } from 'react'
import { Users, Search, X, Check, ChevronDown } from 'lucide-react'

export interface Participant {
  id: string
  label: string | null
  device_id: string
}

export function participantName(p: Participant) {
  return p.label || p.device_id
}

export function avatarInitial(name: string) {
  return name.charAt(0).toUpperCase()
}

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700', 'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700',
]

export function avatarColor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

/**
 * Searchable participant selector. `value` of 'all' = All Participants.
 * Shared by the Sensor Data and Processed Data pages.
 */
export function ParticipantPicker({
  participants, value, onChange,
}: {
  participants: Participant[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const filtered = participants.filter(p =>
    participantName(p).toLowerCase().includes(query.toLowerCase()) ||
    p.device_id.toLowerCase().includes(query.toLowerCase())
  )

  const selected = participants.find(p => p.id === value)
  const label = selected ? participantName(selected) : 'All Participants'

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => { setOpen(o => !o); setQuery('') }}
        className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-sm bg-white hover:bg-gray-50 focus:outline-none transition-all min-w-56 ${
          selected ? 'border-blue-300 ring-2 ring-blue-100' : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        {selected ? (
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarColor(selected.id)}`}>
            {avatarInitial(label)}
          </span>
        ) : (
          <Users size={14} className="text-gray-400 shrink-0" />
        )}
        <span className="flex-1 text-left text-gray-700 font-medium truncate">{label}</span>
        {selected && (
          <span
            role="button"
            onClick={e => { e.stopPropagation(); onChange('all'); setOpen(false) }}
            className="text-gray-300 hover:text-gray-500 transition-colors cursor-pointer shrink-0"
          >
            <X size={13} />
          </span>
        )}
        <ChevronDown size={13} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 bg-white rounded-xl border border-gray-200 shadow-xl z-50 w-72 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
              <Search size={12} className="text-gray-400 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search participants…"
                className="flex-1 text-xs bg-transparent outline-none text-gray-700 placeholder-gray-400"
              />
              {query && <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600"><X size={11} /></button>}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {!query && (
              <button
                onClick={() => { onChange('all'); setOpen(false); setQuery('') }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${value === 'all' ? 'bg-blue-50' : ''}`}
              >
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <Users size={13} className="text-gray-500" />
                </div>
                <span className={`text-sm font-semibold flex-1 ${value === 'all' ? 'text-blue-700' : 'text-gray-700'}`}>All Participants</span>
                {value === 'all' && <Check size={13} className="text-blue-600 shrink-0" />}
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-5 text-xs text-gray-400 text-center">No participants match</p>
            ) : filtered.map(p => {
              const name = participantName(p)
              const active = value === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => { onChange(p.id); setOpen(false); setQuery('') }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${active ? 'bg-blue-50' : ''}`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarColor(p.id)}`}>
                    {avatarInitial(name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${active ? 'text-blue-700' : 'text-gray-700'}`}>{name}</p>
                    {p.label && <p className="text-[11px] text-gray-400 truncate font-mono">{p.device_id}</p>}
                  </div>
                  {active && <Check size={13} className="text-blue-600 shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
