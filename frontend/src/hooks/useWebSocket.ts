/**
 * useWebSocket Hook
 * React hook for managing WebSocket connections and real-time updates
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'

export interface WebSocketMessage {
  type: string
  [key: string]: any
}

export interface UseWebSocketOptions {
  url?: string
  onMessage?: (message: WebSocketMessage) => void
  onConnect?: () => void
  onDisconnect?: () => void
  onError?: (error: Event) => void
  reconnectInterval?: number
  maxReconnectAttempts?: number
  enabled?: boolean
}

export interface UseWebSocketReturn {
  isConnected: boolean
  isConnecting: boolean
  lastMessage: WebSocketMessage | null
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error'
  reconnectAttempts: number
  sendMessage: (message: WebSocketMessage) => void
  connect: () => void
  disconnect: () => void
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    url = `${process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8025'}/ws/dashboard`,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    reconnectInterval = 5000,
    maxReconnectAttempts = 5,
    enabled = true,
  } = options

  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected')
  const [reconnectAttempts, setReconnectAttempts] = useState(0)

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data)
      setLastMessage(message)

      // Handle common message types
      switch (message.type) {
        case 'agent_connected':
        case 'agent_disconnected':
        case 'agent_updated':
        case 'agent_deleted':
        case 'agent_discovered_via_mcp':
        case 'agent_mcp_connection':
          queryClient.invalidateQueries({ queryKey: ['agents'] })
          break

        case 'stack_created':
        case 'stack_updated':
        case 'stack_deleted':
        case 'stack_servers_updated':
        case 'stack_formation_started':
        case 'stack_formation_completed':
          queryClient.invalidateQueries({ queryKey: ['stacks'] })
          queryClient.invalidateQueries({ queryKey: ['agents'] }) // Agents might be affected
          break

        case 'server_created':
        case 'server_updated':
        case 'server_deleted':
        case 'server_status_updated':
        case 'server_discovered':
          queryClient.invalidateQueries({ queryKey: ['servers'] })
          queryClient.invalidateQueries({ queryKey: ['stacks'] }) // Stacks might be affected
          break

        case 'pong':
          // Handle ping/pong
          break

        default:
          console.log('Unknown WebSocket message type:', message.type)
      }

      // Call custom message handler
      onMessage?.(message)

    } catch (error) {
      console.error('Failed to parse WebSocket message:', error)
    }
  }, [onMessage, queryClient])

  const handleOpen = useCallback(() => {
    setIsConnected(true)
    setIsConnecting(false)
    setConnectionState('connected')
    setReconnectAttempts(0)

    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    onConnect?.()
    console.log('WebSocket connected')
  }, [onConnect])

  const handleClose = useCallback(() => {
    setIsConnected(false)
    setIsConnecting(false)
    setConnectionState('disconnected')

    onDisconnect?.()
    console.log('WebSocket disconnected')

    // Attempt to reconnect if enabled and under max attempts
    if (enabled && reconnectAttempts < maxReconnectAttempts) {
      setReconnectAttempts(prev => prev + 1)
      reconnectTimeoutRef.current = setTimeout(() => {
        connect()
      }, reconnectInterval)
    }
  }, [enabled, reconnectAttempts, maxReconnectAttempts, reconnectInterval, onDisconnect])

  const handleError = useCallback((error: Event) => {
    setConnectionState('error')
    setIsConnecting(false)

    onError?.(error)

    // Only log in development to avoid console spam
    if (process.env.NODE_ENV === 'development') {
      console.warn('WebSocket connection failed - backend may not be running:', error)
    }
  }, [onError])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.CONNECTING ||
        wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    setIsConnecting(true)
    setConnectionState('connecting')

    try {
      wsRef.current = new WebSocket(url)

      wsRef.current.addEventListener('open', handleOpen)
      wsRef.current.addEventListener('message', handleMessage)
      wsRef.current.addEventListener('close', handleClose)
      wsRef.current.addEventListener('error', handleError)

    } catch (error) {
      setIsConnecting(false)
      setConnectionState('error')
      console.error('Failed to create WebSocket connection:', error)
    }
  }, [url, handleOpen, handleMessage, handleClose, handleError])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.removeEventListener('open', handleOpen)
      wsRef.current.removeEventListener('message', handleMessage)
      wsRef.current.removeEventListener('close', handleClose)
      wsRef.current.removeEventListener('error', handleError)

      wsRef.current.close()
      wsRef.current = null
    }

    setIsConnected(false)
    setIsConnecting(false)
    setConnectionState('disconnected')
    setReconnectAttempts(0)
  }, [handleOpen, handleMessage, handleClose, handleError])

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message))
      } catch (error) {
        console.error('Failed to send WebSocket message:', error)
      }
    } else {
      console.warn('WebSocket not connected, cannot send message')
    }
  }, [])

  // Auto-connect when enabled
  useEffect(() => {
    if (enabled) {
      connect()
    } else {
      disconnect()
    }

    return () => {
      disconnect()
    }
  }, [enabled])

  // Ping interval to keep connection alive
  useEffect(() => {
    if (!isConnected) return

    const pingInterval = setInterval(() => {
      sendMessage({ type: 'ping' })
    }, 30000) // Ping every 30 seconds

    return () => clearInterval(pingInterval)
  }, [isConnected, sendMessage])

  return {
    isConnected,
    isConnecting,
    lastMessage,
    connectionState,
    reconnectAttempts,
    sendMessage,
    connect,
    disconnect,
  }
}

// Hook for dashboard-specific WebSocket connection with enhanced notifications
export function useDashboardWebSocket() {
  const queryClient = useQueryClient()

  const handleMessage = useCallback((message: WebSocketMessage) => {
    // Show toast notifications for important events
    switch (message.type) {
      case 'agent_connected':
        toast.success(`Agent "${message.agent?.name || 'Unknown'}" connected`, {
          duration: 4000,
          icon: '🤖',
        })
        break

      case 'agent_disconnected':
        toast(`Agent "${message.agent?.name || 'Unknown'}" disconnected`, {
          icon: '⚠️',
          duration: 4000,
        })
        break

      case 'agent_created':
        toast.success(`New agent "${message.agent?.name}" created`, {
          duration: 4000,
          icon: '✨',
        })
        break

      case 'agent_updated':
        toast(`Agent "${message.agent?.name}" updated`, {
          duration: 3000,
          icon: '🔄',
        })
        break

      case 'agent_deleted':
        toast.error(`Agent "${message.agent?.name}" deleted`, {
          duration: 4000,
          icon: '🗑️',
        })
        break

      case 'agent_discovered_via_mcp':
        toast.success(`🚀 Agent "${message.agent?.name}" auto-discovered via MCP!`, {
          duration: 6000,
          icon: '✨',
        })
        break

      case 'agent_mcp_connection':
        toast(`Agent "${message.agent?.name}" connected via MCP protocol`, {
          duration: 4000,
          icon: '🔗',
        })
        break

      case 'stack_formation_started':
        toast(`🎯 Creating stack from ${message.server_count || 2} servers...`, {
          duration: 3000,
          icon: '⚡',
        })
        break

      case 'stack_formation_completed':
        toast.success(`✨ Stack "${message.stack?.name}" created with ${message.server_count || 2} servers!`, {
          duration: 5000,
          icon: '🎉',
        })
        break

      case 'stack_created':
        toast.success(`Stack "${message.stack?.name}" created`, {
          duration: 4000,
          icon: '📚',
        })
        break

      case 'stack_updated':
        toast(`Stack "${message.stack?.name}" updated`, {
          duration: 3000,
          icon: '🔄',
        })
        break

      case 'stack_deleted':
        toast.error(`Stack "${message.stack?.name}" deleted`, {
          duration: 4000,
          icon: '🗑️',
        })
        break

      case 'stack_servers_updated':
        toast(`Stack "${message.stack?.name}" servers updated`, {
          duration: 3000,
          icon: '🔧',
        })
        break

      case 'server_created':
        toast.success(`Server "${message.server?.name}" added`, {
          duration: 4000,
          icon: '🖥️',
        })
        break

      case 'server_updated':
        toast(`Server "${message.server?.name}" updated`, {
          duration: 3000,
          icon: '🔄',
        })
        break

      case 'server_deleted':
        toast.error(`Server "${message.server?.name}" deleted`, {
          duration: 4000,
          icon: '🗑️',
        })
        break

      case 'server_status_updated':
        const serverName = message.server?.name || message.server_name || 'Unknown Server'
        if (message.status === 'error') {
          toast.error(`Server "${serverName}" is experiencing issues`, {
            duration: 6000,
            icon: '❌',
          })
        } else if (message.status === 'healthy') {
          toast.success(`Server "${serverName}" is healthy`, {
            duration: 3000,
            icon: '✅',
          })
        } else if (message.status === 'offline') {
          toast(`Server "${serverName}" is offline`, {
            icon: '⚠️',
            duration: 5000,
          })
        }
        break

      case 'server_discovered':
        toast.success(`New server "${message.server?.name}" discovered`, {
          duration: 5000,
          icon: '🔍',
        })
        break

      case 'health_check_completed':
        if (message.results) {
          const { successful = 0, failed = 0 } = message.results
          if (failed > 0) {
            toast(`Health check completed: ${successful} passed, ${failed} failed`, {
              icon: '🩺',
              duration: 5000,
            })
          } else {
            toast.success(`Health check completed: All ${successful} servers healthy`, {
              icon: '🩺',
              duration: 4000,
            })
          }
        }
        break

      case 'token_generated':
        toast.success(`New access token generated for agent "${message.agent?.name}"`, {
          duration: 4000,
          icon: '🔑',
        })
        break

      case 'access_denied':
        toast.error(`Access denied: ${message.reason || 'Unauthorized request'}`, {
          duration: 6000,
          icon: '🚫',
        })
        break

      case 'system_status':
        if (message.status === 'maintenance') {
          toast('System entering maintenance mode', {
            icon: '🔧',
            duration: 8000,
          })
        } else if (message.status === 'operational') {
          toast.success('System is fully operational', {
            icon: '✅',
            duration: 4000,
          })
        }
        break

      default:
        // Log unknown message types for debugging
        if (process.env.NODE_ENV === 'development') {
          console.log('Unknown WebSocket message type:', message.type, message)
        }
    }
  }, [])

  const ws = useWebSocket({
    onMessage: handleMessage,
    onConnect: () => {
      toast.success('Connected to MCP Portal', {
        duration: 3000,
        icon: '🔗',
      })
    },
    onDisconnect: () => {
      // Only show disconnect toast if we were previously connected
      if (ws.isConnected) {
        toast('Disconnected from MCP Portal', {
          icon: '⚠️',
          duration: 5000,
        })
      }
    },
    onError: () => {
      // Only show error toast in development or if we were previously connected
      if (process.env.NODE_ENV === 'development' || ws.isConnected) {
        toast.error('Connection error - check if backend is running', {
          duration: 6000,
          icon: '🔌',
        })
      }
    },
  })

  return ws
}

// Hook for real-time activity feed
export function useActivityFeed() {
  const [activities, setActivities] = useState<WebSocketMessage[]>([])
  const maxActivities = 50 // Keep last 50 activities

  const handleMessage = useCallback((message: WebSocketMessage) => {
    // Only track certain message types in the activity feed
    const activityTypes = [
      'agent_connected',
      'agent_disconnected',
      'agent_created',
      'agent_updated',
      'agent_deleted',
      'agent_discovered_via_mcp',
      'agent_mcp_connection',
      'stack_created',
      'stack_updated',
      'stack_deleted',
      'stack_formation_started',
      'stack_formation_completed',
      'server_created',
      'server_updated',
      'server_deleted',
      'server_status_updated',
      'server_discovered',
      'health_check_completed',
      'token_generated',
    ]

    if (activityTypes.includes(message.type)) {
      setActivities(prev => {
        const newActivities = [{
          ...message,
          timestamp: message.timestamp || new Date().toISOString()
        }, ...prev]
        return newActivities.slice(0, maxActivities)
      })
    }
  }, [])

  const ws = useWebSocket({
    onMessage: handleMessage,
  })

  const clearActivities = useCallback(() => {
    setActivities([])
  }, [])

  return {
    activities,
    clearActivities,
    isConnected: ws.isConnected,
    connectionState: ws.connectionState,
  }
}

// Hook for real-time metrics
export function useRealTimeMetrics() {
  const [metrics, setMetrics] = useState({
    activeAgents: 0,
    healthyServers: 0,
    totalStacks: 0,
    totalTools: 0,
    lastUpdated: new Date(),
  })

  const handleMessage = useCallback((message: WebSocketMessage) => {
    switch (message.type) {
      case 'metrics_update':
        if (message.metrics) {
          setMetrics({
            ...message.metrics,
            lastUpdated: new Date(),
          })
        }
        break

      case 'agent_connected':
      case 'agent_disconnected':
      case 'server_status_updated':
      case 'stack_created':
      case 'stack_deleted':
        // Request updated metrics
        ws.sendMessage({ type: 'request_metrics' })
        break
    }
  }, [])

  const ws = useWebSocket({
    onMessage: handleMessage,
    onConnect: () => {
      // Request initial metrics
      ws.sendMessage({ type: 'request_metrics' })
    },
  })

  return {
    metrics,
    isConnected: ws.isConnected,
    requestUpdate: () => ws.sendMessage({ type: 'request_metrics' }),
  }
}

// Hook for agent-specific WebSocket connection
export function useAgentWebSocket(agentId?: string) {
  const url = agentId
    ? `${process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8025'}/ws/agents/${agentId}`
    : undefined

  return useWebSocket({
    url,
    enabled: !!agentId,
  })
}
