/**
 * useStacks Hook
 * React hook for managing MCP stack state and operations
 */

import { useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import apiClient, {
  MCPStack,
  StackTemplate,
  CreateStackRequest,
  CreateStackWithNamesRequest,
  UpdateStackRequest,
  AssignStackServersRequest,
  AssignStackServersByNamesRequest
} from '@/lib/api'

export interface UseStacksReturn {
  // Data
  stacks: MCPStack[]
  templates: StackTemplate[]
  isLoading: boolean
  isError: boolean
  error: Error | null

  // Actions
  createStack: (request: CreateStackRequest) => Promise<MCPStack>
  createStackWithNames: (request: CreateStackWithNamesRequest) => Promise<MCPStack>
  updateStack: (stackId: string, request: UpdateStackRequest) => Promise<MCPStack>
  deleteStack: (stackId: string) => Promise<void>
  assignServersToStack: (stackId: string, request: AssignStackServersRequest) => Promise<MCPStack>
  assignServersToStackByNames: (stackId: string, request: AssignStackServersByNamesRequest) => Promise<MCPStack>
  createStackFromTemplate: (templateName: string, stackName?: string) => Promise<MCPStack>
  refreshStacks: () => void
}

export function useStacks(): UseStacksReturn {
  const queryClient = useQueryClient()

  // Queries
  const {
    data: stacksRaw = [],
    isLoading: stacksLoading,
    isError: stacksError,
    error: stacksErrorData,
    refetch: refreshStacks,
  } = useQuery({
    queryKey: ['stacks'],
    queryFn: () => apiClient.listStacks(),
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // 1 minute
  })
  const stacks = useMemo(() => {
    if (Array.isArray(stacksRaw)) return stacksRaw as MCPStack[]
    if (stacksRaw && Array.isArray((stacksRaw as any).stacks)) {
      return ((stacksRaw as any).stacks as MCPStack[])
    }
    return [] as MCPStack[]
  }, [stacksRaw])

  const {
    data: templatesRaw = [],
    isLoading: templatesLoading,
    isError: templatesError,
    error: templatesErrorData,
  } = useQuery({
    queryKey: ['stack-templates'],
    queryFn: () => apiClient.listStackTemplates(),
    staleTime: 300000, // 5 minutes (templates don't change often)
  })
  const templates = useMemo(() => {
    if (Array.isArray(templatesRaw)) return templatesRaw as StackTemplate[]
    if (templatesRaw && Array.isArray((templatesRaw as any).templates)) {
      return ((templatesRaw as any).templates as StackTemplate[])
    }
    return [] as StackTemplate[]
  }, [templatesRaw])

  // Mutations
  const createStackMutation = useMutation({
    mutationFn: (request: CreateStackRequest) => apiClient.createStack(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks'] })
      queryClient.invalidateQueries({ queryKey: ['agents'] }) // Agents might be affected
      toast.success('Stack created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create stack: ${error.message}`)
    },
  })

  const createStackWithNamesMutation = useMutation({
    mutationFn: (request: CreateStackWithNamesRequest) => apiClient.createStackWithNames(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks'] })
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Stack created successfully with auto-imported servers')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create stack: ${error.message}`)
    },
  })

  const updateStackMutation = useMutation({
    mutationFn: ({ stackId, request }: { stackId: string; request: UpdateStackRequest }) =>
      apiClient.updateStack(stackId, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks'] })
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Stack updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update stack: ${error.message}`)
    },
  })

  const deleteStackMutation = useMutation({
    mutationFn: (stackId: string) => apiClient.deleteStack(stackId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks'] })
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Stack deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete stack: ${error.message}`)
    },
  })

  const assignServersMutation = useMutation({
    mutationFn: ({ stackId, request }: { stackId: string; request: AssignStackServersRequest }) =>
      apiClient.assignServersToStack(stackId, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks'] })
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Servers assigned to stack successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to assign servers: ${error.message}`)
    },
  })

  const assignServersByNamesMutation = useMutation({
    mutationFn: ({ stackId, request }: { stackId: string; request: AssignStackServersByNamesRequest }) =>
      apiClient.assignServersToStackByNames(stackId, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks'] })
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      toast.success('Servers assigned to stack successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to assign servers: ${error.message}`)
    },
  })

  const createFromTemplateMutation = useMutation({
    mutationFn: ({ templateName, stackName }: { templateName: string; stackName?: string }) =>
      apiClient.createStackFromTemplate(templateName, stackName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks'] })
      toast.success('Stack created from template successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create stack from template: ${error.message}`)
    },
  })

  // Actions
  const createStack = useCallback(
    async (request: CreateStackRequest): Promise<MCPStack> => {
      return createStackMutation.mutateAsync(request)
    },
    [createStackMutation]
  )

  const createStackWithNames = useCallback(
    async (request: CreateStackWithNamesRequest): Promise<MCPStack> => {
      return createStackWithNamesMutation.mutateAsync(request)
    },
    [createStackWithNamesMutation]
  )

  const updateStack = useCallback(
    async (stackId: string, request: UpdateStackRequest): Promise<MCPStack> => {
      return updateStackMutation.mutateAsync({ stackId, request })
    },
    [updateStackMutation]
  )

  const deleteStack = useCallback(
    async (stackId: string): Promise<void> => {
      await deleteStackMutation.mutateAsync(stackId)
    },
    [deleteStackMutation]
  )

  const assignServersToStack = useCallback(
    async (stackId: string, request: AssignStackServersRequest): Promise<MCPStack> => {
      return assignServersMutation.mutateAsync({ stackId, request })
    },
    [assignServersMutation]
  )

  const assignServersToStackByNames = useCallback(
    async (stackId: string, request: AssignStackServersByNamesRequest): Promise<MCPStack> => {
      return assignServersByNamesMutation.mutateAsync({ stackId, request })
    },
    [assignServersByNamesMutation]
  )

  const createStackFromTemplate = useCallback(
    async (templateName: string, stackName?: string): Promise<MCPStack> => {
      return createFromTemplateMutation.mutateAsync({ templateName, stackName })
    },
    [createFromTemplateMutation]
  )

  // Combine loading and error states
  const isLoading = stacksLoading || templatesLoading
  const isError = stacksError || templatesError
  const error = stacksErrorData || templatesErrorData

  return {
    // Data
    stacks,
    templates,
    isLoading,
    isError,
    error,

    // Actions
    createStack,
    createStackWithNames,
    updateStack,
    deleteStack,
    assignServersToStack,
    assignServersToStackByNames,
    createStackFromTemplate,
    refreshStacks,
  }
}

// Hook for a specific stack
export function useStack(stackId: string) {
  const { stacks } = useStacks()
  const stack = stacks.find(s => s.id === stackId)

  const {
    data: stackDetail,
    isLoading: detailLoading,
    refetch: refreshDetail,
  } = useQuery({
    queryKey: ['stack', stackId],
    queryFn: () => apiClient.getStack(stackId),
    enabled: !!stackId,
    staleTime: 30000,
  })

  return {
    stack: stackDetail || stack,
    isLoading: detailLoading,
    refreshDetail,
  }
}

// Hook for stack statistics
export function useStackStats() {
  const { stacks } = useStacks()

  const activeStacks = stacks.filter(s => s.is_active)
  const inactiveStacks = stacks.filter(s => !s.is_active)
  const assignedStacks = stacks.filter(s => s.agent_id)
  const unassignedStacks = stacks.filter(s => !s.agent_id)

  const totalTools = stacks.reduce((sum, stack) => sum + stack.tools_count, 0)
  const totalServers = stacks.reduce((sum, stack) => sum + stack.servers.length, 0)

  const templateUsage = stacks.reduce((acc, stack) => {
    if (stack.template_name) {
      acc[stack.template_name] = (acc[stack.template_name] || 0) + 1
    }
    return acc
  }, {} as Record<string, number>)

  const stats = {
    total: stacks.length,
    active: activeStacks.length,
    inactive: inactiveStacks.length,
    assigned: assignedStacks.length,
    unassigned: unassignedStacks.length,
    totalTools,
    totalServers,
    avgToolsPerStack: stacks.length > 0 ? totalTools / stacks.length : 0,
    avgServersPerStack: stacks.length > 0 ? totalServers / stacks.length : 0,
  }

  return {
    stats,
    templateUsage,
    activeStacks,
    inactiveStacks,
    assignedStacks,
    unassignedStacks,
  }
}

// Hook for stack templates
export function useStackTemplates() {
  const { templates, isLoading, isError, error } = useStacks()

  const getTemplateByName = useCallback(
    (name: string) => templates.find(t => t.name === name),
    [templates]
  )

  const getTemplatesByCategory = useCallback(() => {
    // Group templates by first word of display name or description
    const categories = templates.reduce((acc, template) => {
      const category = template.display_name.split(' ')[0] || 'Other'
      if (!acc[category]) {
        acc[category] = []
      }
      acc[category].push(template)
      return acc
    }, {} as Record<string, StackTemplate[]>)

    return categories
  }, [templates])

  return {
    templates,
    isLoading,
    isError,
    error,
    getTemplateByName,
    getTemplatesByCategory,
  }
}
