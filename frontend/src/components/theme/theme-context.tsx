'use client'

import { createContext, useContext } from 'react'
import type { Theme } from '@/lib/theme'

interface ThemeContextType {
  theme: Theme
  effectiveTheme: 'dark' | 'light'
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  portalColors: {
    primary: string
    secondary: string
    accent: string
    glow: string
    background: string
    surface: string
    textPrimary: string
    textSecondary: string
  }
  isSystemTheme: boolean
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function useTheme() {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }

  return context
}