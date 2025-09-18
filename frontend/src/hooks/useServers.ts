/**
 * useServers Hook
 * React hook for managing MCP server state and operations
 */

import { useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import apiClient, {
  MCPServer,
  CreateServerRequest,
  UpdateServerRequest
} from '@/lib/api'

export interface UseServersReturn {
  // Data
  servers: MCPServer[]
  isLoading: boolean
  isError: boolean
  error: Error | null

  // Actions
  createServer: (request: CreateServerRequest) => Promise<MCPServer>
  updateServer: (serverId: string, request: UpdateServerRequest) => Promise<MCPServer>
  deleteServer: (serverId: string) => Promise<void>
  testServerHealth: (serverId: string) => Promise<Record<string, any>>
  enableServer: (serverName: string) => Promise<void>
  disableServer: (serverName: string) => Promise<void>
  refreshServers: () => void
}

export function useServers(): UseServersReturn {
  const queryClient = useQueryClient()

  // Queries
  const {
    data: serversRaw = [],
    isLoading,
    isError,
    error,
    refetch: refreshServers,
  } = useQuery({
    queryKey: ['servers'],
    queryFn: () => apiClient.listServers(),
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // 1 minute
  })

  // Normalize API shapes: allow either [] or { servers: [] }
  const servers = useMemo(() => {
    if (Array.isArray(serversRaw)) return serversRaw as MCPServer[]
    if (serversRaw && Array.isArray((serversRaw as any).servers)) {
      return ((serversRaw as any).servers as MCPServer[])
    }
    return [] as MCPServer[]
  }, [serversRaw])

  // Mutations
  const createServerMutation = useMutation({
    mutationFn: (request: CreateServerRequest) => apiClient.createServer(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      toast.success('Server created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create server: ${error.message}`)
    },
  })

  const updateServerMutation = useMutation({
    mutationFn: ({ serverId, request }: { serverId: string; request: UpdateServerRequest }) =>
      apiClient.updateServer(serverId, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      queryClient.invalidateQueries({ queryKey: ['stacks'] }) // Stacks might be affected
      toast.success('Server updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update server: ${error.message}`)
    },
  })

  const deleteServerMutation = useMutation({
    mutationFn: (serverId: string) => apiClient.deleteServer(serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      queryClient.invalidateQueries({ queryKey: ['stacks'] })
      toast.success('Server deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete server: ${error.message}`)
    },
  })

  const testHealthMutation = useMutation({
    mutationFn: (serverId: string) => apiClient.testServerHealth(serverId),
    onSuccess: (data, serverId) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      const status = data.health_status
      if (status === 'healthy') {
        toast.success(`Server health check passed (${data.tools_discovered} tools found)`)
      } else {
        toast.error(`Server health check failed: ${data.error_message || 'Unknown error'}`)
      }
    },
    onError: (error: Error) => {
      toast.error(`Health check failed: ${error.message}`)
    },
  })

  const enableServerMutation = useMutation({
    mutationFn: (serverName: string) => apiClient.enableServer(serverName),
    onSuccess: (data, serverName) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      toast.success(`Server '${serverName}' enabled successfully`)
    },
    onError: (error: Error) => {
      toast.error(`Failed to enable server: ${error.message}`)
    },
  })

  const disableServerMutation = useMutation({
    mutationFn: (serverName: string) => apiClient.disableServer(serverName),
    onSuccess: (data, serverName) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      toast.success(`Server '${serverName}' disabled successfully`)
    },
    onError: (error: Error) => {
      toast.error(`Failed to disable server: ${error.message}`)
    },
  })

  // Actions
  const createServer = useCallback(
    async (request: CreateServerRequest): Promise<MCPServer> => {
      return createServerMutation.mutateAsync(request)
    },
    [createServerMutation]
  )

  const updateServer = useCallback(
    async (serverId: string, request: UpdateServerRequest): Promise<MCPServer> => {
      return updateServerMutation.mutateAsync({ serverId, request })
    },
    [updateServerMutation]
  )

  const deleteServer = useCallback(
    async (serverId: string): Promise<void> => {
      await deleteServerMutation.mutateAsync(serverId)
    },
    [deleteServerMutation]
  )

  const testServerHealth = useCallback(
    async (serverId: string): Promise<Record<string, any>> => {
      return testHealthMutation.mutateAsync(serverId)
    },
    [testHealthMutation]
  )

  const enableServer = useCallback(
    async (serverName: string): Promise<void> => {
      await enableServerMutation.mutateAsync(serverName)
    },
    [enableServerMutation]
  )

  const disableServer = useCallback(
    async (serverName: string): Promise<void> => {
      await disableServerMutation.mutateAsync(serverName)
    },
    [disableServerMutation]
  )

  return {
    // Data
    servers,
    isLoading,
    isError,
    error,

    // Actions
    createServer,
    updateServer,
    deleteServer,
    testServerHealth,
    enableServer,
    disableServer,
    refreshServers,
  }
}

// Hook for a specific server
export function useServer(serverId: string) {
  const { servers } = useServers()
  const server = servers.find(s => s.id === serverId)

  const {
    data: serverDetail,
    isLoading: detailLoading,
    refetch: refreshDetail,
  } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => apiClient.getServer(serverId),
    enabled: !!serverId,
    staleTime: 30000,
  })

  return {
    server: serverDetail || server,
    isLoading: detailLoading,
    refreshDetail,
  }
}

// Hook for server statistics and health monitoring
export function useServerStats() {
  const { servers } = useServers()

  const healthyServers = servers.filter(s => (s.health_status ?? '').toLowerCase() === 'healthy')
  const errorServers = servers.filter(s => (s.health_status ?? '').toLowerCase() === 'error')
  const offlineServers = servers.filter(s => (s.health_status ?? '').toLowerCase() === 'offline')
  const unknownServers = servers.filter(s => !['healthy', 'error', 'offline'].includes((s.health_status ?? '').toLowerCase()))

  const discoveredServers = servers.filter(s => (s.server_type ?? '').toLowerCase() === 'discovered')
  const customServers = servers.filter(s => (s.server_type ?? '').toLowerCase() === 'custom')
  const marketplaceServers = servers.filter(s => (s.server_type ?? '').toLowerCase() === 'marketplace')

  const totalTools = servers.reduce((sum, server) => {
    const discoveredCount = Array.isArray(server.discovered_tools) ? server.discovered_tools.length : undefined
    const fallback = server.tools_count || 0
    return sum + (discoveredCount ?? fallback)
  }, 0)

  const healthDistribution = {
    healthy: healthyServers.length,
    error: errorServers.length,
    offline: offlineServers.length,
    unknown: unknownServers.length,
  }

  const typeDistribution = {
    discovered: discoveredServers.length,
    custom: customServers.length,
    marketplace: marketplaceServers.length,
  }

  const stats = {
    total: servers.length,
    totalTools: totalTools,
    avgToolsPerServer: servers.length > 0 ? Number((totalTools / servers.length).toFixed(1)) : 0,
    healthDistribution,
    typeDistribution,
  }

  return {
    stats,
    healthyServers,
    errorServers,
    offlineServers,
    unknownServers,
    discoveredServers,
    customServers,
    marketplaceServers,
  }
}

// Hook for server health monitoring
export function useServerHealth() {
  const { servers, testServerHealth } = useServers()

  const testAllServers = useCallback(async () => {
    const results = await Promise.allSettled(
      servers.map(server => testServerHealth(server.id))
    )

    const successful = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    toast.success(`Health check completed: ${successful} passed, ${failed} failed`)

    return results
  }, [servers, testServerHealth])

  const getUnhealthyServers = useCallback(() => {
    return servers.filter(s => s.health_status !== 'healthy')
  }, [servers])

  const getServersByHealth = useCallback((status: 'healthy' | 'error' | 'offline' | 'unknown') => {
    return servers.filter(s => s.health_status === status)
  }, [servers])

  return {
    testAllServers,
    getUnhealthyServers,
    getServersByHealth,
  }
}

// Hook for server filtering and searching
export function useServerFilters() {
  const { servers } = useServers()

  const filterByType = useCallback((type: 'discovered' | 'custom' | 'marketplace') => {
    return servers.filter(s => s.server_type === type)
  }, [servers])

  const filterByHealth = useCallback((status: 'healthy' | 'error' | 'offline' | 'unknown') => {
    return servers.filter(s => s.health_status === status)
  }, [servers])

  const searchServers = useCallback((query: string) => {
    const lowercaseQuery = query.toLowerCase()
    return servers.filter(server =>
      server.name.toLowerCase().includes(lowercaseQuery) ||
      server.description?.toLowerCase().includes(lowercaseQuery)
    )
  }, [servers])

  const sortServers = useCallback((
    sortBy: 'name' | 'created_at' | 'health_status' | 'tools_count',
    order: 'asc' | 'desc' = 'asc'
  ) => {
    return [...servers].sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortBy) {
        case 'name':
          aValue = a.name.toLowerCase()
          bValue = b.name.toLowerCase()
          break
        case 'created_at':
          aValue = new Date(a.created_at)
          bValue = new Date(b.created_at)
          break
        case 'health_status':
          // Sort by health priority: healthy, unknown, offline, error
          const healthPriority = { healthy: 4, unknown: 3, offline: 2, error: 1 }
          aValue = healthPriority[a.health_status as keyof typeof healthPriority] || 0
          bValue = healthPriority[b.health_status as keyof typeof healthPriority] || 0
          break
        case 'tools_count':
          aValue = a.tools_count
          bValue = b.tools_count
          break
        default:
          return 0
      }

      if (aValue < bValue) return order === 'asc' ? -1 : 1
      if (aValue > bValue) return order === 'asc' ? 1 : -1
      return 0
    })
  }, [servers])

  return {
    filterByType,
    filterByHealth,
    searchServers,
    sortServers,
  }
}
