'use client'

import { useCallback, useEffect, useState } from 'react'
import { THEME_STORAGE_KEY as KEY } from './theme-script'

// Light / dark theme. The choice ('system' | 'light' | 'dark') is kept in
// localStorage; the resolved theme is written to <html data-theme>, which
// globals.css and theme-dark.css read.

export type ThemeChoice = 'system' | 'light' | 'dark'

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>('system')

  useEffect(() => {
    // localStorage is only readable after mount
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoiceState(readChoice())
  }, [])

  // Follow the system while the choice is 'system'
  useEffect(() => {
    if (choice !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [choice])

  const setChoice = useCallback((next: ThemeChoice) => {
    try {
      if (next === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch { /* private mode: still apply for this page */ }
    setChoiceState(next)
    apply(next)
  }, [])

  return { choice, setChoice }
}
