'use client'

import React from 'react'
import { cn } from '@/lib/utils'

interface AnimatedPortalProps {
  className?: string
  size?: number
}

export function AnimatedPortal({ className, size = 400 }: AnimatedPortalProps) {
  return (
    <div className={cn("relative", className)}>
      {/* Background glow effect */}
      <div className="absolute inset-0 blur-3xl opacity-30">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-cyan-500 to-blue-500 rounded-full animate-pulse" />
      </div>
      
      {/* Main portal SVG */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 400 400"
        className="relative z-10 animate-portal-spin"
      >
        {/* Outer ring */}
        <circle
          cx="200"
          cy="200"
          r="180"
          fill="none"
          stroke="url(#portal-gradient-outer)"
          strokeWidth="2"
          className="animate-portal-pulse"
        />
        
        {/* Middle ring */}
        <circle
          cx="200"
          cy="200"
          r="150"
          fill="none"
          stroke="url(#portal-gradient-middle)"
          strokeWidth="3"
          strokeDasharray="10 5"
          className="animate-portal-spin-reverse"
        />
        
        {/* Inner ring */}
        <circle
          cx="200"
          cy="200"
          r="120"
          fill="none"
          stroke="url(#portal-gradient-inner)"
          strokeWidth="4"
          strokeDasharray="20 10"
        />
        
        {/* Center portal */}
        <circle
          cx="200"
          cy="200"
          r="90"
          fill="url(#portal-gradient-center)"
          className="animate-portal-pulse"
        />
        
        {/* Energy particles */}
        {[...Array(8)].map((_, i) => (
          <circle
            key={i}
            cx="200"
            cy="200"
            r="3"
            fill="#60a5fa"
            className="animate-portal-particle"
            style={{
              transformOrigin: '200px 200px',
              transform: `rotate(${i * 45}deg) translateY(-140px)`,
              animationDelay: `${i * 0.2}s`
            }}
          >
            <animate
              attributeName="opacity"
              values="0;1;0"
              dur="3s"
              repeatCount="indefinite"
              begin={`${i * 0.3}s`}
            />
          </circle>
        ))}
        
        {/* Gradients */}
        <defs>
          <linearGradient id="portal-gradient-outer" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#06b6d4" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.3" />
          </linearGradient>
          
          <linearGradient id="portal-gradient-middle" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.5" />
            <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.5" />
          </linearGradient>
          
          <linearGradient id="portal-gradient-inner" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.7" />
            <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.7" />
          </linearGradient>
          
          <radialGradient id="portal-gradient-center">
            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.9" />
            <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#1e40af" stopOpacity="0.5" />
          </radialGradient>
        </defs>
      </svg>
      
      {/* Floating particles around portal */}
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(12)].map((_, i) => (
          <div
            key={`particle-${i}`}
            className="absolute w-1 h-1 bg-blue-400 rounded-full animate-float"
            style={{
              left: `${50 + 40 * Math.cos(i * 30 * Math.PI / 180)}%`,
              top: `${50 + 40 * Math.sin(i * 30 * Math.PI / 180)}%`,
              animationDelay: `${i * 0.5}s`,
              animationDuration: `${3 + i * 0.5}s`
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default AnimatedPortal
