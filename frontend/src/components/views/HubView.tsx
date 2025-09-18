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
  MarkerType,
  addEdge,
  useEdgesState,
  useNodesState,
  type IsValidConnection,
  useReactFlow,
  type NodeMouseHandler,
  useOnViewportChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AnimatePresence } from 'framer-motion'
import { useHotkeys } from 'react-hotkeys-hook'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FaUserTie, FaLayerGroup, FaServer } from 'react-icons/fa6'
import { useAgents } from '@/hooks/useAgents'
import { useStacks } from '@/hooks/useStacks'
import { useServers } from '@/hooks/useServers'
import { useDashboardWebSocket } from '@/hooks/useWebSocket'
import { useStackFormation } from '@/hooks/useStackFormation'
import { StackFormationAnimation, ServerMergeZone } from '@/components/graph/StackFormationAnimation'
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
      case 'unknown': return 'bg-yellow-100 text-yellow-700'
      default: return 'bg-gray-100 text-gray-700'
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
    </div>
  )
}

const nodeTypes = {
  agent: AgentNode,
  stack: StackNode,
  server: ServerNode,
}

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
  addServer: (server: MCPServer) => void
  addServerById: (serverId: string) => void
}

export default forwardRef<HubViewHandle, Record<string, never>>(function HubView(_, ref) {
  const reactFlowInstance = useReactFlow()
  const agentY = useRef(100)
  const serverY = useRef(100)
  const dataSignatureRef = useRef<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const { save: persistGraphState, load: retrieveGraphState } = useGraphState()

  // React Flow's built-in state management - this is the only state we need
  const [nodes, setNodes, onNodesChange] = useNodesState<TypedNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // API data
  const { agents } = useAgents()
  const { stacks } = useStacks()
  const { servers } = useServers()
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
  const { stackFormation, isForming, result } = useStackFormation()
  const [stackFormationAnimation, setStackFormationAnimation] = useState({ isVisible: false, serverCount: 0 })

  // UI state
  const [menu, setMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0 })
  const [selectedNode, setSelectedNode] = useState<TypedNode | null>(null)
  const [activeStackId, setActiveStackId] = useState<string | null>(null)

  // Save state to storage using the GraphStateProvider context
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

  // Shared helpers for ID/slug generation
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
        agentY.current = 100
        serverY.current = 100
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

    agentY.current = 100
    serverY.current = 100

    const newNodes: TypedNode[] = []
    const newEdges: Edge[] = []
    const usedIds = new Set<string>()
    const agentNodeMap = new Map<string, string>()
    const stackNodeMap = new Map<string, string>()

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

      registerKeys(agentNodeMap, [agent.id, baseId], id)

      newNodes.push({
        id,
        type: 'agent',
        position: { x: 50, y: agentY.current },
        data: {
          label: agent.name,
          subtitle: agent.type,
          agentData: agent,
        },
      })
      agentY.current += 120
    })

    safeStacks.forEach((stack, index) => {
      const baseId = `stack-${slugify(stack.name)}`
      const id = ensureUniqueId(baseId, usedIds)
      usedIds.add(id)

      registerKeys(stackNodeMap, [stack.id, baseId], id)

      newNodes.push({
        id,
        type: 'stack',
        position: { x: 300, y: 50 + index * 120 },
        data: {
          label: stack.name,
          subtitle: `${stack.servers?.length || 0} servers`,
          stackData: stack,
        },
      })
    })

    safeAgents.forEach((agent) => {
      const agentNodeId = agentNodeMap.get(agent.id ?? `agent-${slugify(agent.name)}`)
      if (!agentNodeId) return

      const assignedStackId = agent.assigned_stack_id ? String(agent.assigned_stack_id) : null
      if (!assignedStackId) return

      const stackNodeId = stackNodeMap.get(assignedStackId)

      if (!stackNodeId) return

      const edgeId = `${agentNodeId}-${stackNodeId}`
      newEdges.push({
        id: edgeId,
        source: agentNodeId,
        target: stackNodeId,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
      })
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
    edges.length,
    nodes.length,
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
    if (stackFormation && result && isForming) {
      if (result.success && result.stack) {
        setStackFormationAnimation({
          isVisible: true,
          position: result.dropPosition || { x: 0, y: 0 },
          serverCount: result.involvedNodes?.length || 2,
          stackName: result.stack?.name
        })

        setTimeout(() => {
          setStackFormationAnimation({ isVisible: false, serverCount: 0 })
        }, 3500)
      }
    }
  }, [stackFormation, result, isForming])

  // Connection validation
  const isValidConnection: IsValidConnection = useCallback((connection) => {
    const sourceNode = nodes.find(n => n.id === connection.source)
    const targetNode = nodes.find(n => n.id === connection.target)

    if (!sourceNode || !targetNode) return false

    // Allow agent -> stack connections only
    if (sourceNode.type === 'agent' && targetNode.type === 'stack') return true

    return false
  }, [nodes])

  // Event handlers
  const onConnect = useCallback((params: Connection) => {
    setEdges(eds => addEdge(params, eds))
  }, [setEdges])

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
  const addServer = useCallback((server: MCPServer) => {
    console.info('HubView.addServer invoked, but server nodes are managed inside stack details now.', server?.id)
  }, [])

  const addServerById = useCallback((serverId: string) => {
    console.info('HubView.addServerById invoked with id:', serverId)
  }, [])

  useImperativeHandle(ref, () => ({
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
    <div className="w-full h-full relative">
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
      <AnimatePresence>
        {stackFormationAnimation.isVisible && (
          <StackFormationAnimation
            isVisible={stackFormationAnimation.isVisible}
            position={stackFormationAnimation.position}
            serverCount={stackFormationAnimation.serverCount}
            stackName={stackFormationAnimation.stackName}
          />
        )}
      </AnimatePresence>

      {/* Server Merge Zone */}
      {isForming && <ServerMergeZone />}

      {/* Context Menu */}
      {menu.open && (
        <div
          className="fixed bg-popover border border-border rounded-md shadow-md py-1 z-50"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.target?.type === 'node' && (
            <>
              <button className="w-full text-left px-3 py-1 hover:bg-accent text-sm">
                Edit Node
              </button>
              <button className="w-full text-left px-3 py-1 hover:bg-accent text-sm text-destructive">
                Delete Node
              </button>
            </>
          )}
          {menu.target?.type === 'pane' && (
            <button className="w-full text-left px-3 py-1 hover:bg-accent text-sm">
              Add Node
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
