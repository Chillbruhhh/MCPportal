/**
 * useAgents Hook
 * React hook for managing agent state and operations
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import apiClient, {
  Agent,
  AgentToken,
  CreateAgentTokenRequest,
  CreateAgentTokenResponse,
  AgentAccessLog
} from '@/lib/api'

export interface UseAgentsReturn {
  // Data
  agents: Agent[]
  tokens: AgentToken[]
  isLoading: boolean
  isError: boolean
  error: Error | null

  // Actions
  createToken: (request: CreateAgentTokenRequest) => Promise<CreateAgentTokenResponse>
  createAgentToken: (request: CreateAgentTokenRequest) => Promise<CreateAgentTokenResponse>
  revokeToken: (tokenId: string) => Promise<void>
  updateAgent: (agentId: string, updates: Record<string, any>) => Promise<void>
  deleteAgent: (agentId: string) => Promise<void>
  assignStackToAgent: (agentId: string, stackId: string) => Promise<void>
  getAgentLogs: (agentId: string, limit?: number) => Promise<AgentAccessLog[]>
  refreshAgents: () => void
  refreshTokens: () => void
}

export function useAgents(): UseAgentsReturn {
  const queryClient = useQueryClient()

  // Queries
  const {
    data: agentsRaw = [],
    isLoading: agentsLoading,
    isError: agentsError,
    error: agentsErrorData,
    refetch: refreshAgents,
  } = useQuery({
    queryKey: ['agents'],
    queryFn: () => apiClient.listAgents(),
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // 1 minute
  })
  const agents = useMemo(() => {
    if (Array.isArray(agentsRaw)) return agentsRaw as Agent[]
    if (agentsRaw && Array.isArray((agentsRaw as any).agents)) {
      return ((agentsRaw as any).agents as Agent[])
    }
    return [] as Agent[]
  }, [agentsRaw])

  const {
    data: tokensRaw = [],
    isLoading: tokensLoading,
    isError: tokensError,
    error: tokensErrorData,
    refetch: refreshTokens,
  } = useQuery({
    queryKey: ['agent-tokens'],
    queryFn: () => apiClient.listAgentTokens(),
    staleTime: 60000, // 1 minute
  })
  const tokens = useMemo(() => {
    if (Array.isArray(tokensRaw)) return tokensRaw as AgentToken[]
    if (tokensRaw && Array.isArray((tokensRaw as any).tokens)) {
      return ((tokensRaw as any).tokens as AgentToken[])
    }
    return [] as AgentToken[]
  }, [tokensRaw])

  // Mutations
  const createTokenMutation = useMutation({
    mutationFn: (request: CreateAgentTokenRequest) =>
      apiClient.createAgentToken(request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-tokens'] })
      toast.success('Agent token created successfully')

      // Show token once (since it won't be shown again)
      const tokenDisplay = `${data.token.slice(0, 8)}...${data.token.slice(-8)}`
      toast.success(
        `Token: ${tokenDisplay}\n\nSave this token - it won't be shown again!`,
        { duration: 10000 }
      )
    },
    onError: (error: Error) => {
      toast.error(`Failed to create token: ${error.message}`)
    },
  })

  const revokeTokenMutation = useMutation({
    mutationFn: (tokenId: string) => apiClient.revokeAgentToken(tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-tokens'] })
      queryClient.invalidateQueries({ queryKey: ['agents'] }) // Agents might be affected
      toast.success('Token revoked successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to revoke token: ${error.message}`)
    },
  })

  const updateAgentMutation = useMutation({
    mutationFn: ({ agentId, updates }: { agentId: string; updates: Record<string, any> }) =>
      apiClient.updateAgent(agentId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Agent updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update agent: ${error.message}`)
    },
  })

  const deleteAgentMutation = useMutation({
    mutationFn: (agentId: string) => apiClient.deleteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      queryClient.invalidateQueries({ queryKey: ['agent-tokens'] })
      toast.success('Agent deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete agent: ${error.message}`)
    },
  })

  const assignStackMutation = useMutation({
    mutationFn: ({ agentId, stackId }: { agentId: string; stackId: string }) =>
      apiClient.assignStackToAgent(agentId, stackId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      queryClient.invalidateQueries({ queryKey: ['stacks'] })
      toast.success('Stack assigned to agent successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to assign stack: ${error.message}`)
    },
  })

  // Actions
  const createToken = useCallback(
    async (request: CreateAgentTokenRequest): Promise<CreateAgentTokenResponse> => {
      return createTokenMutation.mutateAsync(request)
    },
    [createTokenMutation]
  )

  const createAgentToken = useCallback(
    async (request: CreateAgentTokenRequest): Promise<CreateAgentTokenResponse> => {
      return createTokenMutation.mutateAsync(request)
    },
    [createTokenMutation]
  )

  const revokeToken = useCallback(
    async (tokenId: string): Promise<void> => {
      await revokeTokenMutation.mutateAsync(tokenId)
    },
    [revokeTokenMutation]
  )

  const updateAgent = useCallback(
    async (agentId: string, updates: Record<string, any>): Promise<void> => {
      await updateAgentMutation.mutateAsync({ agentId, updates })
    },
    [updateAgentMutation]
  )

  const deleteAgent = useCallback(
    async (agentId: string): Promise<void> => {
      await deleteAgentMutation.mutateAsync(agentId)
    },
    [deleteAgentMutation]
  )

  const assignStackToAgent = useCallback(
    async (agentId: string, stackId: string): Promise<void> => {
      await assignStackMutation.mutateAsync({ agentId, stackId })
    },
    [assignStackMutation]
  )

  const getAgentLogs = useCallback(
    async (agentId: string, limit: number = 100): Promise<AgentAccessLog[]> => {
      return apiClient.getAgentAccessLogs(agentId, limit)
    },
    []
  )

  // Combine loading and error states
  const isLoading = agentsLoading || tokensLoading
  const isError = agentsError || tokensError
  const error = agentsErrorData || tokensErrorData

  return {
    // Data
    agents,
    tokens,
    isLoading,
    isError,
    error,

    // Actions
    createToken,
    createAgentToken,
    revokeToken,
    updateAgent,
    deleteAgent,
    assignStackToAgent,
    getAgentLogs,
    refreshAgents,
    refreshTokens,
  }
}

// Hook for a specific agent
export function useAgent(agentId: string) {
  const { agents } = useAgents()
  const agent = agents.find(a => a.id === agentId)

  const {
    data: logs = [],
    isLoading: logsLoading,
    refetch: refreshLogs,
  } = useQuery({
    queryKey: ['agent-logs', agentId],
    queryFn: () => apiClient.getAgentAccessLogs(agentId),
    enabled: !!agentId,
    staleTime: 30000,
  })

  return {
    agent,
    logs,
    logsLoading,
    refreshLogs,
  }
}

// Hook for agent status monitoring
export function useAgentStatus() {
  const { agents } = useAgents()

  const onlineAgents = agents.filter(a => a.status === 'online')
  const offlineAgents = agents.filter(a => a.status === 'offline')
  const errorAgents = agents.filter(a => a.status === 'error')

  const stats = {
    total: agents.length,
    online: onlineAgents.length,
    offline: offlineAgents.length,
    error: errorAgents.length,
  }

  return {
    stats,
    onlineAgents,
    offlineAgents,
    errorAgents,
  }
}
