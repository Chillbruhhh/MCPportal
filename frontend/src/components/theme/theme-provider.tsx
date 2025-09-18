'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { ThemeContext } from './theme-context'
import {
  type Theme,
  getTheme,
  setTheme as setThemeStorage,
  getSystemTheme,
  getEffectiveTheme,
  applyTheme,
  enableThemeTransitions,
} from '@/lib/theme'
import { getPortalColors } from '@/lib/utils'

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  enableSystem?: boolean
}

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  enableSystem = true,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme)
  const [mounted, setMounted] = useState(false)

  // Get effective theme (resolves 'system' to actual theme)
  const effectiveTheme = useMemo(() => getEffectiveTheme(theme), [theme])

  // Get portal colors based on effective theme
  const portalColors = useMemo(() => getPortalColors(effectiveTheme), [effectiveTheme])

  // Initialize theme
  useEffect(() => {
    const savedTheme = getTheme()
    setThemeState(savedTheme)
    applyTheme(getEffectiveTheme(savedTheme))
    setMounted(true)
  }, [])

  // Listen for system theme changes
  useEffect(() => {
    if (!enableSystem) return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleChange = () => {
      if (theme === 'system') {
        applyTheme(getSystemTheme())
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme, enableSystem])

  // Apply theme when it changes
  useEffect(() => {
    if (!mounted) return

    const cleanup = enableThemeTransitions()
    applyTheme(effectiveTheme)

    return cleanup
  }, [effectiveTheme, mounted])

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    setThemeStorage(newTheme)
  }, [])

  const toggleTheme = useCallback(() => {
    if (theme === 'system') {
      const systemTheme = getSystemTheme()
      setTheme(systemTheme === 'dark' ? 'light' : 'dark')
    } else {
      setTheme(theme === 'dark' ? 'light' : 'dark')
    }
  }, [theme, setTheme])

  const contextValue = useMemo(() => ({
    theme,
    effectiveTheme,
    setTheme,
    toggleTheme,
    portalColors,
    isSystemTheme: theme === 'system',
  }), [theme, effectiveTheme, setTheme, toggleTheme, portalColors])

  // Prevent hydration mismatch
  if (!mounted) {
    return null
  }

  return (
    <ThemeContext.Provider value={contextValue}>
      <div className="portal-container">
        {children}
      </div>
    </ThemeContext.Provider>
  )
}