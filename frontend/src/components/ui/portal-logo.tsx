'use client'

import { cn } from '@/lib/utils'

interface PortalLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero'
  className?: string
  variant?: 'default' | 'minimal'
}

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-20 h-20',
  xl: 'w-32 h-32',
  hero: 'w-80 h-80 md:w-96 md:h-96 lg:w-[28rem] lg:h-[28rem]'
}

export function PortalLogo({
  size = 'md',
  className,
  variant = 'default'
}: PortalLogoProps) {
  return (
    <div className={cn('relative', sizeClasses[size], className)}>
      {/* Background subtle glow */}
      <div className="absolute inset-0 bg-blue-400/20 rounded-full blur-3xl animate-pulse opacity-60" />

      {/* Main Portal SVG - Clean concentric circles like reference */}
      <svg
        viewBox="0 0 400 400"
        className="w-full h-full relative z-10 animate-spin"
        style={{ animationDuration: '60s' }}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Beautiful gradient matching reference */}
          <radialGradient id="portalGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#93c5fd" stopOpacity="1" />
            <stop offset="30%" stopColor="#60a5fa" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#3b82f6" stopOpacity="0.7" />
            <stop offset="85%" stopColor="#2563eb" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.3" />
          </radialGradient>

          <radialGradient id="centerGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.9" />
            <stop offset="50%" stopColor="#93c5fd" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.5" />
          </radialGradient>
        </defs>

        {/* Outermost circle */}
        <circle
          cx="200"
          cy="200"
          r="180"
          stroke="#1d4ed8"
          strokeWidth="12"
          fill="none"
          opacity="0.2"
        />

        {/* Second circle */}
        <circle
          cx="200"
          cy="200"
          r="150"
          stroke="#2563eb"
          strokeWidth="14"
          fill="none"
          opacity="0.3"
        />

        {/* Third circle */}
        <circle
          cx="200"
          cy="200"
          r="120"
          stroke="#3b82f6"
          strokeWidth="16"
          fill="none"
          opacity="0.4"
        />

        {/* Fourth circle */}
        <circle
          cx="200"
          cy="200"
          r="90"
          stroke="#60a5fa"
          strokeWidth="18"
          fill="none"
          opacity="0.6"
        />

        {/* Fifth circle */}
        <circle
          cx="200"
          cy="200"
          r="60"
          stroke="#93c5fd"
          strokeWidth="20"
          fill="none"
          opacity="0.8"
        />

        {/* Center filled circle */}
        <circle
          cx="200"
          cy="200"
          r="35"
          fill="url(#centerGradient)"
        />

        {/* Small center dot */}
        <circle
          cx="200"
          cy="200"
          r="8"
          fill="#3b82f6"
          opacity="0.9"
        />
      </svg>
    </div>
  )
}

export function PortalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('w-6 h-6', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <circle cx="12" cy="12" r="2" fill="currentColor" opacity="0.8" />
    </svg>
  )
}