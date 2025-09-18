'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
} from 'react'

export type PersistStrategy = 'session' | 'local' | 'both'

export interface SaveOptions {
  strategy?: PersistStrategy
  /**
   * When true, bypasses the configured debounce and writes immediately.
   * Defaults to `!autoSave` so manual calls behave predictably in tests.
   */
  immediate?: boolean
}

export interface GraphStateContextValue {
  storageKey: string
  autoSave: boolean
  debounceMs: number
  save: (data: unknown, options?: SaveOptions) => void
  load: <T>(fallback: T, strategy?: PersistStrategy) => T
  clear: (strategy?: PersistStrategy) => void
}

const GraphStateContext = createContext<GraphStateContextValue | null>(null)

export interface GraphStateProviderProps extends PropsWithChildren {
  storageKey: string
  autoSave?: boolean
  debounceMs?: number
}

const parseValue = (raw: string | null) => {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('GraphStateProvider: failed to parse stored graph state', error)
    }
    return undefined
  }
}

export function GraphStateProvider({
  children,
  storageKey,
  autoSave = false,
  debounceMs = 300,
}: GraphStateProviderProps) {
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingRef = useRef<{
    payload: unknown
    strategy: PersistStrategy
  } | null>(null)

  const persist = useCallback(
    (payload: unknown, strategy: PersistStrategy) => {
      if (typeof window === 'undefined') return

      try {
        const serialised = JSON.stringify(payload)

        if (strategy === 'session' || strategy === 'both') {
          window.sessionStorage.setItem(`${storageKey}-session`, serialised)
        }

        if (strategy === 'local' || strategy === 'both') {
          window.localStorage.setItem(storageKey, serialised)
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('GraphStateProvider: failed to persist graph state', error)
        }
      }
    },
    [storageKey]
  )

  const flush = useCallback(() => {
    if (!pendingRef.current) return

    persist(pendingRef.current.payload, pendingRef.current.strategy)
    pendingRef.current = null
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [persist])

  const save = useCallback<GraphStateContextValue['save']>(
    (data, options) => {
      const strategy = options?.strategy ?? 'both'
      const immediate = options?.immediate ?? !autoSave

      if (immediate) {
        persist(data, strategy)
        return
      }

      pendingRef.current = { payload: data, strategy }
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(flush, debounceMs)
    },
    [autoSave, debounceMs, flush, persist]
  )

  const load = useCallback<GraphStateContextValue['load']>(
    (fallback, strategy = 'both') => {
      if (typeof window === 'undefined') return fallback

      const sources: PersistStrategy[] =
        strategy === 'both' ? ['session', 'local'] : [strategy]

      for (const source of sources) {
        if (source === 'session') {
          const sessionValue = parseValue(window.sessionStorage.getItem(`${storageKey}-session`))
          if (typeof sessionValue !== 'undefined') {
            return sessionValue as typeof fallback
          }
        } else {
          const localValue = parseValue(window.localStorage.getItem(storageKey))
          if (typeof localValue !== 'undefined') {
            return localValue as typeof fallback
          }
        }
      }

      return fallback
    },
    [storageKey]
  )

  const clear = useCallback<GraphStateContextValue['clear']>(
    (strategy = 'both') => {
      if (typeof window === 'undefined') return

      try {
        if (strategy === 'session' || strategy === 'both') {
          window.sessionStorage.removeItem(`${storageKey}-session`)
        }

        if (strategy === 'local' || strategy === 'both') {
          window.localStorage.removeItem(storageKey)
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('GraphStateProvider: failed to clear stored state', error)
        }
      }
    },
    [storageKey]
  )

  useEffect(() => () => {
    flush()
  }, [flush])

  const value = useMemo<GraphStateContextValue>(
    () => ({ storageKey, autoSave, debounceMs, save, load, clear }),
    [autoSave, debounceMs, load, save, clear, storageKey]
  )

  return <GraphStateContext.Provider value={value}>{children}</GraphStateContext.Provider>
}

export function useGraphState() {
  const context = useContext(GraphStateContext)
  if (!context) {
    throw new Error('useGraphState must be used within a GraphStateProvider')
  }
  return context
}
