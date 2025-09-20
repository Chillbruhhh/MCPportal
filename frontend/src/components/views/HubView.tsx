'use client'

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
  useMemo,
} from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  Handle,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  type IsValidConnection,
  useReactFlow,
  type NodeMouseHandler,
  useOnViewportChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'react-hot-toast'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FaUserTie, FaLayerGroup, FaServer } from 'react-icons/fa6'
import { useAgents } from '@/hooks/useAgents'
import { useStacks } from '@/hooks/useStacks'
import { useServers } from '@/hooks/useServers'
import { useDashboardWebSocket } from '@/hooks/useWebSocket'
import { useStackFormation } from '@/hooks/useStackFormation'
import { ServerMergeZone } from '@/components/graph/StackFormationAnimation'
import StackServerInspector from '@/components/graph/StackServerInspector'
import { useGraphState, type SaveOptions } from '@/components/providers/GraphStateProvider'
import { normalizeApiResponse, validateServer, validateAgent, validateStack } from '@/lib/validation'
import type { Agent, MCPStack, MCPServer } from '@/lib/api'

type TypedNode = Node<{
  label: string;
  subtitle?: string;
  agentData?: Agent;
  stackData?: MCPStack;
  serverData?: MCPServer;
  originalServerData?: MCPServer;
  realId?: string;
}>

const AgentNode = ({ data }: { data: { label: string; subtitle?: string; agentData?: Agent } }) => {
  const getAgentIconColor = (type: string) => {
    switch (type) {
      case 'claude-code': return 'text-blue-500'
      case 'cursor': return 'text-purple-500'
      case 'kiro': return 'text-orange-500'
      case 'custom': return 'text-green-500'
      default: return 'text-gray-500'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-100 text-green-700'
      case 'offline': return 'bg-gray-100 text-gray-700'
      case 'connecting': return 'bg-yellow-100 text-yellow-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <FaUserTie className={`w-4 h-4 ${data.agentData ? getAgentIconColor(data.agentData.type) : 'text-gray-500'}`} />
        <div className="text-xs text-muted-foreground">Agent</div>
        {data.agentData && (
          <span className={`text-xs px-2 py-1 rounded-md ${getStatusColor(data.agentData.status)}`}>
            {data.agentData.status}
          </span>
        )}
      </div>
      <div className="font-medium leading-tight">{data.label}</div>
      {data.subtitle && <div className="text-xs text-muted-foreground">{data.subtitle}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const StackNode = ({ data }: { data: { label: string; subtitle?: string; stackData?: MCPStack } }) => {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <FaLayerGroup className="w-4 h-4 text-purple-500" />
        <div className="text-xs text-muted-foreground">Stack</div>
      </div>
      <div className="font-medium leading-tight">{data.label}</div>
      {data.subtitle && <div className="text-xs text-muted-foreground">{data.subtitle}</div>}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const ServerNode = ({ data }: { data: { label: string; subtitle?: string; serverData?: MCPServer } }) => {
  const getStatusColor = (healthStatus?: string) => {
    switch (healthStatus) {
      case 'healthy': return 'bg-green-100 text-green-700'
      case 'unhealthy': return 'bg-red-100 text-red-700'
      case 'offline': return 'bg-gray-100 text-gray-700'
      default: return 'bg-yellow-100 text-yellow-700'
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <FaServer className="w-4 h-4 text-green-500" />
        <div className="text-xs text-muted-foreground">Server</div>
        {data.serverData && (
          <span className={`text-xs px-2 py-1 rounded-md ${getStatusColor(data.serverData.health_status)}`}>
            {data.serverData.health_status || 'unknown'}
          </span>
        )}
      </div>
      <div className="font-medium leading-tight">{data.label}</div>
      {data.subtitle && <div className="text-xs text-muted-foreground">{data.subtitle}</div>}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = {
  agent: AgentNode,
  stack: StackNode,
  server: ServerNode,
}

const AGENT_BASE_Y = 100
const STACK_BASE_Y = 80
const SERVER_BASE_Y = 100
const AGENT_COLUMN_X = 60
const STACK_COLUMN_X = 340
const SERVER_COLUMN_X = 620
const AGENT_VERTICAL_SPACING = 120
const STACK_VERTICAL_SPACING = 150
const SERVER_VERTICAL_SPACING = 120

interface PersistedGraphState {
  nodes: Node[]
  edges: Edge[]
  viewport?: { x: number; y: number; zoom: number }
  position?: [number, number]
  zoom?: number
  selectedServerIds?: string[]
  timestamp?: number
}

type MenuTarget =
  | { type: 'node'; id: string; nodeType: string }
  | { type: 'pane' }

interface ContextMenuState {
  open: boolean
  x: number
  y: number
  target?: MenuTarget
}

export interface HubViewHandle {
  addAgent: () => void
  addServer: (server: MCPServer) => void
  addServerById: (serverId: string) => void
}

export default forwardRef<HubViewHandle, Record<string, never>>(function HubView(_, ref) {
  const reactFlowInstance = useReactFlow()
  const flowWrapperRef = useRef<HTMLDivElement>(null)
  const agentY = useRef(AGENT_BASE_Y)
  const dataSignatureRef = useRef<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const { save: persistGraphState, load: retrieveGraphState } = useGraphState()

  // React Flow's built-in state management - this is the only state we need
  const [nodes, setNodes, onNodesChange] = useNodesState<TypedNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // API data
  const { agents, assignStackToAgent } = useAgents()
  const { stacks, assignServersToStack, updateStack, refreshStacks } = useStacks()
  const { servers, refreshServers } = useServers()
  const { selectedServerIds } = useDashboardWebSocket()

  const safeAgents = useMemo(() => normalizeApiResponse(agents, validateAgent), [agents])
  const safeStacks = useMemo(() => normalizeApiResponse(stacks, validateStack), [stacks])
  const allSafeServers = useMemo(() => normalizeApiResponse(servers, validateServer), [servers])

  const dataSignature = useMemo(() => {
    return JSON.stringify({
      agents: safeAgents.map(agent => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        assignedStackId: agent.assigned_stack_id,
        updatedAt: agent.updated_at,
      })),
      stacks: safeStacks.map(stack => ({
        id: stack.id,
        name: stack.name,
        isActive: stack.is_active,
        updatedAt: stack.updated_at,
        serverIds: (stack.servers ?? []).map(server => String(server.id ?? server.name ?? 'unknown')),
      })),
      servers: allSafeServers.map(server => ({
        id: server.id,
        name: server.name,
        status: server.health_status,
        updatedAt: server.updated_at,
        toolPermissions: server.tool_permissions,
      })),
    })
  }, [safeAgents, safeStacks, allSafeServers])

  // Stack formation
  const {
    formationState,
    startDrag,
    updateDrag,
    endDrag,
    cancelDrag,
    previewName,
    dropZone,
  } = useStackFormation()

  const [stackFormationResult, setStackFormationResult] = useState<any>(null)
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [loadingToast, setLoadingToast] = useState<{ message: string; position: { x: number; y: number } } | null>(null)
  const [successToast, setSuccessToast] = useState<{ message: string; position: { x: number; y: number } } | null>(null)
  const [renameStackTarget, setRenameStackTarget] = useState<{ stackId: string; nodeId?: string; currentName: string } | null>(null)
  const [renameStackName, setRenameStackName] = useState('')
  const [isRenamingStack, setIsRenamingStack] = useState(false)

  const getScreenPosition = useCallback((graphPosition?: { x: number; y: number }) => {
    if (!graphPosition || !flowWrapperRef.current) {
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    }

    const bounds = flowWrapperRef.current.getBoundingClientRect()
    const viewport = reactFlowInstance.getViewport()
    return {
      x: bounds.left + viewport.x + graphPosition.x * viewport.zoom,
      y: bounds.top + viewport.y + graphPosition.y * viewport.zoom,
    }
  }, [reactFlowInstance])

  const showInlineToast = useCallback((config: { type: 'loading' | 'success'; message: string; position?: { x: number; y: number }; duration?: number }) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current)
    }

    const pos = getScreenPosition(config.position)

    if (config.type === 'loading') {
      setLoadingToast({ message: config.message, position: pos })
      setSuccessToast(null)
    } else {
      setSuccessToast({ message: config.message, position: pos })
      setLoadingToast(null)
    }

    toastTimeoutRef.current = setTimeout(() => {
      setLoadingToast(null)
      setSuccessToast(null)
    }, config.duration ?? 1600)
  }, [getScreenPosition])

  const saveState = useCallback(
    (options?: SaveOptions) => {
      try {
        const flowState = reactFlowInstance.toObject()
        const stateToSave: PersistedGraphState = {
          ...flowState,
          selectedServerIds,
          timestamp: Date.now(),
        }

        persistGraphState(stateToSave, options)

        if (process.env.NODE_ENV === 'development') {
          console.log('🔄 Graph state saved:', {
            nodes: flowState.nodes.length,
            edges: flowState.edges.length,
            viewport: flowState.viewport,
          })
        }
      } catch (error) {
        console.error('Failed to save graph state:', error)
      }
    },
    [persistGraphState, reactFlowInstance, selectedServerIds]
  )

  const handleRenameStackSubmit = useCallback(async () => {
    if (!renameStackTarget) return
    const newName = renameStackName.trim()
    if (!newName) {
      toast.error('Stack name is required')
      return
    }

    setIsRenamingStack(true)
    try {
      const updated = await updateStack(renameStackTarget.stackId, { name: newName })
      setNodes(currentNodes => currentNodes.map(node => {
        if (renameStackTarget.nodeId && node.id === renameStackTarget.nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              label: newName,
              stackData: {
                ...node.data.stackData,
                name: newName,
              },
            },
          }
        }
        if (node.type === 'stack' && node.data?.stackData?.id === renameStackTarget.stackId) {
          return {
            ...node,
            data: {
              ...node.data,
              label: newName,
              stackData: {
                ...node.data.stackData,
                name: newName,
              },
            },
          }
        }
        return node
      }))

      toast.success('Stack renamed')
      refreshStacks()
      saveState({ immediate: true })
      setRenameStackTarget(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename stack'
      toast.error(message)
    } finally {
      setIsRenamingStack(false)
    }
  }, [refreshStacks, renameStackName, renameStackTarget, saveState, setNodes, updateStack])

  // Shared helpers for ID/slug generation
  const [menu, setMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0 })
  const [selectedNode, setSelectedNode] = useState<TypedNode | null>(null)
  const [activeStackId, setActiveStackId] = useState<string | null>(null)

  // Save state to storage using the GraphStateProvider context


  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [])

  // UI state
  const slugify = useCallback(
    (value?: string) =>
      (value || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, ''),
    []
  )

  const ensureUniqueId = useCallback((base: string, used: Set<string>) => {
    if (!used.has(base)) return base
    let i = 2
    let next = `${base}-${i}`
    while (used.has(next)) {
      i += 1
      next = `${base}-${i}`
    }
    return next
  }, [])

  // Load state from storage using the GraphStateProvider context
  const loadState = useCallback(() => {
    try {
      const parsedState = retrieveGraphState<PersistedGraphState | null>(null)

      if (parsedState) {
        if (process.env.NODE_ENV === 'development') {
          console.log('🔄 Loading graph state from storage:', {
            nodes: parsedState.nodes?.length || 0,
            edges: parsedState.edges?.length || 0,
            viewport: parsedState.viewport,
          })
        }

        if (Array.isArray(parsedState.nodes)) {
          setNodes(parsedState.nodes)
        }

        if (Array.isArray(parsedState.edges)) {
          setEdges(parsedState.edges)
        }

        if (parsedState.viewport) {
          setTimeout(() => {
            try {
              reactFlowInstance.setViewport(parsedState.viewport, { duration: 200 })
            } catch (error) {
              console.warn('Viewport restoration failed, using fitView fallback', error)
              reactFlowInstance.fitView({ padding: 0.2, duration: 300 })
            }
          }, 100)
        }

        return true
      }
    } catch (error) {
      console.error('Failed to load graph state:', error)
    }

    return false
  }, [retrieveGraphState, setEdges, setNodes, reactFlowInstance])

  const activeStack = useMemo(() => {
    if (!activeStackId) return null
    const stackList = Array.isArray(stacks) ? stacks : []
    return stackList.find((stack) => String(stack.id) === activeStackId) ?? null
  }, [activeStackId, stacks])

  useEffect(() => {
    if (activeStackId && !activeStack) {
      setActiveStackId(null)
    }
  }, [activeStackId, activeStack])

  // Convert backend data to flow nodes and edges
  const convertDataToFlow = useCallback(() => {
    if (!safeAgents.length && !safeStacks.length && !allSafeServers.length) {
      if (nodes.length || edges.length) {
        agentY.current = AGENT_BASE_Y
        setNodes([])
        setEdges([])
        saveState()
      }
      dataSignatureRef.current = dataSignature
      return
    }

    if (dataSignatureRef.current === dataSignature) {
      return
    }

    dataSignatureRef.current = dataSignature

    console.log('\n🔄 Converting backend data to flow elements')

    agentY.current = AGENT_BASE_Y

    const newNodes: TypedNode[] = []
    const newEdges: Edge[] = []
    const usedIds = new Set<string>()
    const agentNodeMap = new Map<string, string>()
    const stackNodeMap = new Map<string, string>()

    const currentNodes = reactFlowInstance.getNodes()
    const currentEdges = reactFlowInstance.getEdges()

    const manualServerNodes = currentNodes.filter(node => node.type === 'server')
    const manualServerNodeIds = new Set(manualServerNodes.map(node => node.id))
    const manualEdges = currentEdges.filter(edge => manualServerNodeIds.has(edge.source) || manualServerNodeIds.has(edge.target))

    const registerKeys = (map: Map<string, string>, keys: Array<string | null | undefined>, value: string) => {
      keys.forEach((key) => {
        if (!key) return
        map.set(typeof key === 'string' ? key : String(key), value)
      })
    }

    safeAgents.forEach((agent) => {
      const baseId = `agent-${slugify(agent.name)}`
      const id = ensureUniqueId(baseId, usedIds)
      usedIds.add(id)

      registerKeys(agentNodeMap, [agent.id, baseId, agent.name ? slugify(agent.name) : null], id)

      newNodes.push({
        id,
        type: 'agent',
        position: { x: AGENT_COLUMN_X, y: agentY.current },
        data: {
          label: agent.name,
          subtitle: agent.type,
          agentData: agent,
          realId: agent.id ? String(agent.id) : undefined,
        },
      })
      agentY.current += AGENT_VERTICAL_SPACING
    })

    safeStacks.forEach((stack, index) => {
      const baseId = `stack-${slugify(stack.name)}`
      const id = ensureUniqueId(baseId, usedIds)
      usedIds.add(id)

      registerKeys(stackNodeMap, [stack.id, baseId, stack.name ? slugify(stack.name) : null], id)

      const stackPositionY = STACK_BASE_Y + index * STACK_VERTICAL_SPACING
      const stackServers = Array.isArray(stack.servers) ? stack.servers : []
      const totalServers = stackServers.length || 0

      newNodes.push({
        id,
        type: 'stack',
        position: { x: STACK_COLUMN_X, y: stackPositionY },
        data: {
          label: stack.name,
          subtitle: `${totalServers} server${totalServers === 1 ? '' : 's'}`,
          stackData: stack,
          realId: stack.id ? String(stack.id) : undefined,
        },
      })

      // No server nodes are rendered in the React Flow graph; stack detail modal shows server inventory.
    })

    safeAgents.forEach((agent) => {
      const agentNodeId = agentNodeMap.get(agent.id ?? `agent-${slugify(agent.name)}`)
      if (!agentNodeId) return

      const assignedStackId = agent.assigned_stack_id ? String(agent.assigned_stack_id) : null
      if (!assignedStackId) return

      const stackNodeId = stackNodeMap.get(assignedStackId)

      if (!stackNodeId) return

      const stackForAgent = safeStacks.find(stack => String(stack.id) === assignedStackId)
      const stackHasHealthyServer = stackForAgent?.servers?.some((server) => server.health_status === 'healthy') ?? false

      const edgeId = `${agentNodeId}-${stackNodeId}`
      newEdges.push({
        id: edgeId,
        source: agentNodeId,
        target: stackNodeId,
        type: 'smoothstep',
        animated: stackHasHealthyServer,
        style: {
          stroke: stackHasHealthyServer ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
          strokeWidth: stackHasHealthyServer ? 2.4 : 1.5,
          opacity: stackHasHealthyServer ? 1 : 0.8,
          strokeDasharray: '6 3',
        },
        data: {
          connectionType: 'agent-stack',
          agentStatus: agent.status,
          stackHasHealthyServer,
          stackId: assignedStackId,
        },
      })
    })

    manualServerNodes.forEach((node) => {
      if (!usedIds.has(node.id)) {
        usedIds.add(node.id)
      }
      newNodes.push(node)
    })

    manualEdges.forEach((edge) => {
      if (!newEdges.some(e => e.id === edge.id)) {
        newEdges.push(edge)
      }
    })

    console.log('🔄 Generated flow elements:', {
      nodes: newNodes.length,
      edges: newEdges.length,
    })

    setNodes(newNodes)
    setEdges(newEdges)
    saveState()
  }, [
    allSafeServers,
    dataSignature,
    ensureUniqueId,
    reactFlowInstance,
    safeAgents,
    safeStacks,
    saveState,
    setEdges,
    setNodes,
    slugify,
  ])

  // Initialize component
  useEffect(() => {
    if (isInitialized) return

    console.log('🔄 Initializing HubView')

    const stateLoaded = loadState()

    if (!stateLoaded) {
      convertDataToFlow()
    }

    setIsInitialized(true)
  }, [isInitialized, loadState, convertDataToFlow])

  // Update flow when backend data changes (but only if we have new data)
  useEffect(() => {
    if (isInitialized) {
      convertDataToFlow()
    }
  }, [isInitialized, convertDataToFlow])

  // Auto-save on viewport changes
  useOnViewportChange({
    onChange: saveState
  })

  // Auto-save on nodes/edges changes
  useEffect(() => {
    if (isInitialized && (nodes.length > 0 || edges.length > 0)) {
      saveState()
    }
  }, [nodes, edges, isInitialized, saveState])

  // Save before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveState({ immediate: true })
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [saveState])

  // Handle page visibility change (tab switches)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab being hidden - save immediately
        saveState({ immediate: true, strategy: 'session' })
      } else {
        // Tab becoming visible - reload latest state
        loadState()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [loadState, saveState])

  // Handle stack formation animation
  useEffect(() => {
    if (stackFormationResult?.success && stackFormationResult.stack) {
      if (stackFormationResult.action === 'create_stack') {
        showInlineToast({
          type: 'success',
          message: `Created ${stackFormationResult.stack?.name}`,
          position: stackFormationResult.dropPosition,
        })
      }

      refreshStacks()
      refreshServers()
      setStackFormationResult(null)
    }
  }, [refreshServers, refreshStacks, showInlineToast, stackFormationResult])

  // Connection validation
  const isValidConnection: IsValidConnection = useCallback((connection) => {
    if (!connection.source || !connection.target) return false

    const sourceNode = reactFlowInstance.getNode(connection.source)
    const targetNode = reactFlowInstance.getNode(connection.target)

    if (!sourceNode || !targetNode) return false

    if (sourceNode.type === 'agent' && targetNode.type === 'stack') return true
    if (sourceNode.type === 'stack' && targetNode.type === 'server') return true
    if (sourceNode.type === 'server' && targetNode.type === 'stack') return true

    return false
  }, [reactFlowInstance])

  // Event handlers
  const handleAgentStackConnection = useCallback(async (
    agentNode: TypedNode,
    stackNode: TypedNode,
    params: Connection
  ) => {
    const agentId = agentNode.data.agentData?.id || agentNode.data.realId
    const stackId = stackNode.data.stackData?.id || stackNode.data.realId

    if (!agentId || !stackId) {
      toast.error('Unable to determine agent or stack identifier for the connection')
      return
    }

    if (agentNode.data.agentData?.assigned_stack_id &&
        String(agentNode.data.agentData.assigned_stack_id) === String(stackId)) {
      toast('Agent already assigned to this stack', { icon: 'ℹ️' })
      return
    }

    const edgeId = `${params.source}-${params.target}`
    const previousEdgesForAgent = edges.filter(edge => edge.source === params.source)
    const stackHasHealthyServer = stackNode.data.stackData?.servers?.some((server) => server.health_status === 'healthy') ?? false

    setEdges((existingEdges) => {
      const filtered = existingEdges.filter(edge => edge.source !== params.source)
      return addEdge({
        ...params,
        id: edgeId,
        type: 'smoothstep',
        animated: stackHasHealthyServer,
        style: {
          stroke: stackHasHealthyServer ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
          strokeWidth: stackHasHealthyServer ? 2.2 : 1.4,
          opacity: stackHasHealthyServer ? 1 : 0.85,
          strokeDasharray: '6 3',
        },
        data: {
          connectionType: 'agent-stack',
          agentStatus: 'connecting',
          stackHasHealthyServer,
          stackId,
        },
      }, filtered)
    })

    try {
      await assignStackToAgent(String(agentId), String(stackId))
      toast.success(`Assigned ${agentNode.data.agentData?.name ?? 'agent'} to ${stackNode.data.stackData?.name ?? 'stack'}`)

      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== agentNode.id) return node
          return {
            ...node,
            data: {
              ...node.data,
              agentData: node.data.agentData
                ? {
                    ...node.data.agentData,
                    assigned_stack_id: stackId,
                  }
                : node.data.agentData,
            },
          }
        })
      )
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to assign stack'
      toast.error(message)
      setEdges((eds) => {
        const filtered = eds.filter(edge => edge.id !== edgeId && edge.source !== params.source)
        return [...filtered, ...previousEdgesForAgent]
      })
    }
  }, [assignStackToAgent, edges, setEdges, setNodes])

  const handleStackServerConnection = useCallback(async (
    stackNode: TypedNode,
    serverNode: TypedNode,
    params: Connection
  ) => {
    const stackId = stackNode.data.stackData?.id || stackNode.data.realId
    const serverId = serverNode.data.serverData?.id || serverNode.data.realId

    if (!stackId || !serverId) {
      toast.error('Unable to determine stack or server identifier for the connection')
      return
    }

    const existingEdge = reactFlowInstance
      .getEdges()
      .find(edge => edge.source === params.source && edge.target === params.target)
    if (existingEdge) {
      toast('Connection already exists', { icon: 'ℹ️' })
      return
    }

    const edgeId = `${params.source}-${params.target}`
    const healthStatus = serverNode.data.serverData?.health_status ?? 'unknown'

    setEdges(existingEdges => addEdge({
      ...params,
      id: edgeId,
      type: 'smoothstep',
      animated: healthStatus === 'healthy',
      style: {
        stroke: healthStatus === 'healthy' ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
        strokeWidth: healthStatus === 'healthy' ? 2 : 1.4,
        opacity: healthStatus === 'healthy' ? 1 : 0.85,
        strokeDasharray: '6 3',
      },
      data: {
        connectionType: 'stack-server',
        healthStatus,
      },
    }, existingEdges))

    try {
      showInlineToast({ type: 'loading', message: 'Adding server…', position: serverNode.position })

      const updatedStack = await assignServersToStack(String(stackId), { server_ids: [String(serverId)] })

      showInlineToast({
        type: 'success',
        message: `Added ${serverNode.data.serverData?.name ?? 'server'}`,
        position: stackNode.position,
      })

      reactFlowInstance.deleteElements({ nodes: [{ id: serverNode.id }] })
      reactFlowInstance.deleteElements({ edges: [{ id: edgeId }] })

      setNodes(currentNodes => currentNodes
        .filter(node => node.id !== serverNode.id)
        .map(node => {
          if (node.id !== stackNode.id) return node
          const stackData = updatedStack ?? node.data.stackData
          const serverCount = stackData?.servers?.length ?? 0
          return {
            ...node,
            data: {
              ...node.data,
              stackData,
              subtitle: `${serverCount} server${serverCount === 1 ? '' : 's'}`,
            },
          }
        })
      )

      setEdges(currentEdges => currentEdges.filter(edge =>
        edge.id !== edgeId && edge.source !== serverNode.id && edge.target !== serverNode.id
      ))

      refreshStacks()
      refreshServers()
      saveState()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to assign server to stack'
      toast.error(message)
      setEdges(eds => eds.filter(edge => edge.id !== edgeId))
    }
  }, [assignServersToStack, reactFlowInstance, refreshServers, refreshStacks, saveState, setEdges, setNodes, showInlineToast])

  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target) return

    const sourceNode = reactFlowInstance.getNode(params.source)
    const targetNode = reactFlowInstance.getNode(params.target)

    if (!sourceNode || !targetNode) return

    if (sourceNode.type === 'agent' && targetNode.type === 'stack') {
      void handleAgentStackConnection(sourceNode as TypedNode, targetNode as TypedNode, params)
      return
    }

    if (sourceNode.type === 'stack' && targetNode.type === 'server') {
      void handleStackServerConnection(sourceNode as TypedNode, targetNode as TypedNode, params)
      return
    }

    if (sourceNode.type === 'server' && targetNode.type === 'stack') {
      const stackNode = targetNode as TypedNode
      const serverNode = sourceNode as TypedNode
      const adjustedParams = { ...params, source: stackNode.id, target: serverNode.id }
      void handleStackServerConnection(stackNode, serverNode, adjustedParams)
      return
    }

    toast('Unsupported connection type', { icon: '⚠️' })
  }, [handleAgentStackConnection, handleStackServerConnection, reactFlowInstance])

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    const typedNode = node as TypedNode

    if (typedNode.type === 'stack') {
      const stackData = typedNode.data?.stackData as MCPStack | undefined
      const resolvedStackId =
        (stackData?.id && String(stackData.id)) ||
        (typedNode.data?.realId ? String(typedNode.data.realId) : null)

      setActiveStackId(resolvedStackId)
      setSelectedNode(typedNode)
      return
    }

    setSelectedNode(typedNode)
    setActiveStackId(null)
  }, [])

  const closeMenu = useCallback(() => {
    setMenu({ open: false, x: 0, y: 0 })
  }, [])

  // Imperative handle for parent component
  const addAgent = useCallback(() => {
    toast('Use the Agents tab to register a new agent, then it will appear here automatically.', {
      icon: 'ℹ️',
    })
  }, [])

  const addServer = useCallback((server: MCPServer) => {
    if (!server) {
      toast.error('Server details unavailable')
      return
    }

    const currentGraphNodes = reactFlowInstance.getNodes()
    const existingNode = currentGraphNodes.find(node =>
      node.type === 'server' &&
      (node.data?.serverData?.id === server.id || node.data?.realId === String(server.id))
    )

    if (existingNode) {
      toast('Server already added to canvas', { icon: 'ℹ️' })
      return
    }

    const used = new Set(currentGraphNodes.map(node => node.id))
    const baseId = server.id ? `server-${String(server.id)}` : `server-${slugify(server.name)}`
    const id = ensureUniqueId(baseId, used)

    const serverNodes = currentGraphNodes.filter(node => node.type === 'server')
    const position = {
      x: SERVER_COLUMN_X,
      y: SERVER_BASE_Y + serverNodes.length * SERVER_VERTICAL_SPACING,
    }

    const healthStatus = server.health_status ?? 'unknown'

    const newNode: TypedNode = {
      id,
      type: 'server',
      position,
      data: {
        label: server.name ?? 'MCP Server',
        subtitle: `${healthStatus}`,
        serverData: server,
        originalServerData: server,
        realId: server.id ? String(server.id) : undefined,
      },
    }

    setNodes(currentNodes => [...currentNodes, newNode])
    toast.success(`Added ${server.name ?? 'server'} to canvas`)
  }, [ensureUniqueId, reactFlowInstance, slugify, setNodes])

  const addServerById = useCallback((serverId: string) => {
    const server = allSafeServers.find(s => {
      if (!s) return false
      if (s.id && String(s.id) === String(serverId)) return true
      if (s.name && slugify(s.name) === slugify(serverId)) return true
      return false
    })

    if (!server) {
      toast.error('Server not found')
      return
    }

    addServer(server)
  }, [addServer, allSafeServers, slugify])

  useImperativeHandle(ref, () => ({
    addAgent,
    addServer,
    addServerById,
  }))

  // Keyboard shortcuts
  useHotkeys('delete', () => {
    if (selectedNode) {
      setNodes(nds => nds.filter(n => n.id !== selectedNode.id))
      setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id))
      setSelectedNode(null)
    }
  })

  return (
    <div ref={flowWrapperRef} className="w-full h-full relative">
      {!isInitialized && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <div className="text-sm text-muted-foreground">
              Loading graph data and restoring state...
            </div>
          </div>
        </div>
      )}

      {/* Empty state when no data */}
      {nodes.length === 0 && isInitialized && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/80">
          <div className="text-center">
            <FaLayerGroup className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No MCP Components Found</h3>
            <p className="text-muted-foreground mb-4 max-w-md">
              Start by adding agents, stacks, and servers in their respective tabs, then return here to see the visual graph.
            </p>
          </div>
        </div>
      )}

      <ReactFlow
        nodeTypes={nodeTypes}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={onNodeClick}
        onPaneClick={closeMenu}
        onNodeDragStart={(_, node) => {
          if (node.type === 'server') {
            startDrag(node as TypedNode)
          }
        }}
        onNodeDrag={(_, node) => {
          if (node.type === 'server') {
            const allNodes = reactFlowInstance.getNodes() as TypedNode[]
            updateDrag(node as TypedNode, allNodes as any)
          }
        }}
        onNodeDragStop={(_, node) => {
          if (node.type === 'server') {
            const allNodes = reactFlowInstance.getNodes() as TypedNode[]
            void (async () => {
              const result = await endDrag(allNodes as any)
              if (result) {
                setStackFormationResult(result)
              }
            })()
          } else {
            cancelDrag()
          }
        }}
        onNodeContextMenu={(e, n) => {
          e.preventDefault()
          setMenu({ open: true, x: e.clientX, y: e.clientY, target: { type: 'node', id: n.id, nodeType: n.type ?? '' } })
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault()
          setMenu({ open: true, x: e.clientX, y: e.clientY, target: { type: 'pane' } })
        }}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.5, maxZoom: 2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showFitView showZoom />
        <MiniMap zoomable pannable />
      </ReactFlow>

      {/* Stack Formation Animation */}
      {formationState.isDragging && (
        <ServerMergeZone
          isActive={formationState.collision.isColliding}
          position={dropZone}
          serverCount={Math.max(1, formationState.collision.collidingWith.length || (formationState.draggedNode ? 1 : 0))}
          previewName={previewName}
        />
      )}

      {loadingToast && (
        <div
          className="fixed pointer-events-none z-50"
          style={{
            left: loadingToast.position.x,
            top: loadingToast.position.y,
            transform: 'translate(-50%, -120%)',
          }}
        >
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-md">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-primary" />
            {loadingToast.message}
          </div>
        </div>
      )}

      {successToast && (
        <div
          className="fixed pointer-events-none z-50"
          style={{
            left: successToast.position.x,
            top: successToast.position.y,
            transform: 'translate(-50%, -120%)',
          }}
        >
          <div className="rounded-md border border-border bg-background px-3 py-1 text-xs font-medium text-foreground shadow-md">
            {successToast.message}
          </div>
        </div>
      )}

      <Dialog open={!!renameStackTarget} onOpenChange={(open) => {
        if (!open) {
          setRenameStackTarget(null)
          setRenameStackName('')
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Stack</DialogTitle>
            <DialogDescription>Choose a clear, descriptive name for this stack.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Stack Name</label>
              <input
                type="text"
                value={renameStackName}
                onChange={(e) => setRenameStackName(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background"
                placeholder="Enter stack name"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRenameStackTarget(null)
                  setRenameStackName('')
                }}
                className="px-3 py-1 text-sm border rounded-md hover:bg-accent"
                disabled={isRenamingStack}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRenameStackSubmit}
                className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                disabled={isRenamingStack}
              >
                {isRenamingStack ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Context Menu */}
      {menu.open && (
        <div
          className="fixed bg-popover border border-border rounded-md shadow-md py-1 z-50"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.target?.type === 'node' ? (
            (() => {
              const targetNode = reactFlowInstance.getNode(menu.target.id)
              if (!targetNode) return null

              if (targetNode.type === 'stack') {
                return (
                  <button
                    className="w-full text-left px-3 py-1 hover:bg-accent text-sm"
                    onClick={() => {
                      const stackData = targetNode.data?.stackData
                      const stackId = stackData?.id || targetNode.data?.realId
                      if (!stackId) {
                        toast.error('Stack data unavailable')
                        return
                      }
                      setRenameStackTarget({
                        stackId: String(stackId),
                        nodeId: targetNode.id,
                        currentName: targetNode.data?.label || stackData?.name || 'Stack',
                      })
                      setRenameStackName(targetNode.data?.label || stackData?.name || '')
                      setMenu({ open: false, x: 0, y: 0 })
                    }}
                  >
                    Rename Stack
                  </button>
                )
              }

              return (
                <button className="w-full text-left px-3 py-1 text-muted-foreground text-sm cursor-default">
                  No actions available
                </button>
              )
            })()
          ) : (
            <button className="w-full text-left px-3 py-1 text-muted-foreground text-sm cursor-default">
              No actions available
            </button>
          )}
        </div>
      )}

      {/* Node Details Modal */}
      {selectedNode && selectedNode.type !== 'stack' && (
        <Dialog open={!!selectedNode} onOpenChange={() => setSelectedNode(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{selectedNode.data.label}</DialogTitle>
              <DialogDescription>
                {selectedNode.type} details
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <p><strong>Type:</strong> {selectedNode.type}</p>
              <p><strong>ID:</strong> {selectedNode.id}</p>
              {selectedNode.data.subtitle && (
                <p><strong>Subtitle:</strong> {selectedNode.data.subtitle}</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Stack Inspector */}
      <StackServerInspector
        stack={activeStack}
        open={!!activeStack}
        onClose={() => setActiveStackId(null)}
      />
    </div>
  )
})
