'use client'

import { useEffect } from 'react'

/**
 * Suppresses noisy ResizeObserver loop errors emitted by Chromium when
 * synchronous layout reads trigger reflows inside observer callbacks.
 * The underlying layout logic is still executed; we just stop the
 * console spam that appears whenever React Flow aggressively measures
 * nodes during graph updates.
 */
export function ResizeObserverFix() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.message === 'ResizeObserver loop completed with undelivered notifications.' ||
          event.message === 'ResizeObserver loop limit exceeded') {
        event.stopImmediatePropagation()
      }
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      const message = (event.reason && event.reason.message) || ''
      if (message.includes('ResizeObserver loop completed with undelivered notifications.')) {
        event.preventDefault()
      }
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [])

  return null
}
