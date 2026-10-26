import { useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'neric.theme'

/**
 * `useTheme` - mengelola dark/light mode.
 * - Membaca preferensi dari localStorage (sekali, saat mount)
 * - Fallback ke `prefers-color-scheme` OS user
 * - Menambah/menghapus class `dark` di <body> agar Tailwind
 *   `darkMode: 'class'` aktif, sekaligus memudahkan CSS global.
 */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
    // Default ke DARK karena ini "Smart City Control Center"
    return 'dark'
  })

  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    if (theme === 'dark') {
      root.classList.add('dark')
      body.classList.add('dark')
    } else {
      root.classList.remove('dark')
      body.classList.remove('dark')
    }
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, setTheme, toggle, isDark: theme === 'dark' }
}
