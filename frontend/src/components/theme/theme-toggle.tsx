'use client'

import { Moon, Sun, Monitor } from 'lucide-react'
import { useTheme } from './theme-context'
import { cn } from '@/lib/utils'

interface ThemeToggleProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'button' | 'dropdown' | 'simple'
  showLabel?: boolean
}

export function ThemeToggle({
  className,
  size = 'md',
  variant = 'button',
  showLabel = false,
}: ThemeToggleProps) {
  const { theme, effectiveTheme, toggleTheme, setTheme } = useTheme()

  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-9 w-9',
    lg: 'h-10 w-10',
  }

  const iconSizeClasses = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  }

  if (variant === 'simple') {
    return (
      <button
        onClick={toggleTheme}
        className={cn(
          'inline-flex items-center justify-center rounded-lg border border-input bg-background transition-colors hover:bg-accent hover:text-accent-foreground',
          sizeClasses[size],
          className
        )}
        aria-label="Toggle theme"
      >
        {effectiveTheme === 'dark' ? (
          <Moon className={iconSizeClasses[size]} />
        ) : (
          <Sun className={iconSizeClasses[size]} />
        )}
      </button>
    )
  }

  if (variant === 'dropdown') {
    return (
      <div className={cn('relative', className)}>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
          className="portal-input text-sm"
          aria-label="Select theme"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </div>
    )
  }

  // Button variant with enhanced portal styling
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        onClick={toggleTheme}
        className={cn(
          'inline-flex items-center justify-center rounded-lg',
          'border border-input bg-background',
          'transition-all duration-200',
          'hover:bg-accent hover:text-accent-foreground',
          'portal-glow hover:portal-glow-strong',
          sizeClasses[size]
        )}
        aria-label={`Switch to ${effectiveTheme === 'dark' ? 'light' : 'dark'} mode`}
      >
        <div className="relative">
          <Sun
            className={cn(
              iconSizeClasses[size],
              'rotate-0 scale-100 transition-all duration-300',
              effectiveTheme === 'dark' && 'rotate-90 scale-0'
            )}
          />
          <Moon
            className={cn(
              iconSizeClasses[size],
              'absolute inset-0 rotate-90 scale-0 transition-all duration-300',
              effectiveTheme === 'dark' && 'rotate-0 scale-100'
            )}
          />
        </div>
      </button>

      {showLabel && (
        <span className="text-sm font-medium text-muted-foreground">
          {effectiveTheme === 'dark' ? 'Dark' : 'Light'} Mode
        </span>
      )}

      {theme === 'system' && (
        <Monitor className="h-3 w-3 text-muted-foreground" />
      )}
    </div>
  )
}

// Advanced theme selector with all options
export function ThemeSelector({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()

  const themes = [
    { value: 'light' as const, label: 'Light', icon: Sun },
    { value: 'dark' as const, label: 'Dark', icon: Moon },
    { value: 'system' as const, label: 'System', icon: Monitor },
  ]

  return (
    <div className={cn('flex items-center rounded-lg border border-input p-1', className)}>
      {themes.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-all duration-200',
            theme === value
              ? 'bg-portal-blue text-white portal-glow'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          )}
          aria-label={`Switch to ${label.toLowerCase()} mode`}
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}