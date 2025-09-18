/**
 * useStackFormation Hook
 * React hook for managing drag-and-drop stack creation with collision detection
 */

import { useCallback, useState, useRef } from 'react'
import { Node, XYPosition } from '@xyflow/react'
import { useStacks } from '@/hooks/useStacks'
import { useServers } from '@/hooks/useServers'
import { toast } from 'react-hot-toast'

// Helper function to validate UUID format
const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

interface ServerNode extends Node {
  data: {
    label: string
    subtitle?: string
    serverData?: any
    originalServerData?: any
    realId?: string
  }
}

interface CollisionInfo {
  isColliding: boolean
  collidingWith: ServerNode[]
  dropZone?: XYPosition
}

interface StackFormationState {
  isDragging: boolean
  draggedNode: ServerNode | null
  collision: CollisionInfo
  isForming: boolean
  previewName: string
}

export function useStackFormation() {
  const { createStackWithNames, assignServersToStack, assignServersToStackByNames } = useStacks()
  const { servers: rawServers, refreshServers } = useServers()

  const [formationState, setFormationState] = useState<StackFormationState>({
    isDragging: false,
    draggedNode: null,
    collision: { isColliding: false, collidingWith: [] },
    isForming: false,
    previewName: ''
  })

  const dragStartPosition = useRef<XYPosition | null>(null)

  // Calculate collision between nodes (including stacks)
  const calculateCollision = useCallback((
    draggedNode: ServerNode,
    allNodes: ServerNode[],
    threshold: number = 80
  ): CollisionInfo => {
    const collidingWith: ServerNode[] = []
    const draggedBounds = {
      x: draggedNode.position.x,
      y: draggedNode.position.y,
      width: 200, // Approximate node width
      height: 100, // Approximate node height
    }

    for (const node of allNodes) {
      if (node.id === draggedNode.id) continue

      // Allow collision with servers (for new stacks) and stack nodes (for adding to existing stacks)
      if (node.type !== 'server' && node.type !== 'stack') continue

      const nodeBounds = {
        x: node.position.x,
        y: node.position.y,
        width: 200,
        height: 100,
      }

      // Calculate distance between centers
      const centerDistance = Math.sqrt(
        Math.pow(draggedBounds.x - nodeBounds.x, 2) +
        Math.pow(draggedBounds.y - nodeBounds.y, 2)
      )

      if (centerDistance < threshold) {
        collidingWith.push(node)
      }
    }

    return {
      isColliding: collidingWith.length > 0,
      collidingWith,
      dropZone: collidingWith.length > 0 ? {
        x: (draggedBounds.x + collidingWith[0].position.x) / 2,
        y: (draggedBounds.y + collidingWith[0].position.y) / 2,
      } : undefined
    }
  }, [])

  // Generate smart stack name based on server types
  const generateStackName = useCallback((servers: ServerNode[]): string => {
    const serverTypes = servers.map(s => s.data.serverData?.name?.toLowerCase() || s.data.label?.toLowerCase() || 'server')

    // Common patterns
    const patterns = {
      development: ['git', 'github', 'docker', 'filesystem', 'postgres', 'mysql'],
      dataAnalysis: ['pandas', 'numpy', 'sqlite', 'postgres', 'filesystem'],
      webScraping: ['brave-search', 'puppeteer', 'filesystem', 'sqlite'],
      contentCreation: ['filesystem', 'google-drive', 'brave-search', 'image']
    }

    // Check if servers match any pattern
    for (const [patternName, keywords] of Object.entries(patterns)) {
      const matchCount = keywords.filter(keyword =>
        serverTypes.some(type => type.includes(keyword))
      ).length

      if (matchCount >= 2) {
        return patternName.charAt(0).toUpperCase() + patternName.slice(1).replace(/([A-Z])/g, ' $1') + ' Stack'
      }
    }

    // Default name based on server types
    if (serverTypes.length === 2) {
      const names = serverTypes.map(type => type.split('-')[0] || type)
      return `${names[0]} + ${names[1]} Stack`
    }

    return `Custom Stack (${serverTypes.length} servers)`
  }, [])

  // Start drag operation
  const startDrag = useCallback((node: ServerNode) => {
    if (node.type !== 'server') return

    setFormationState(prev => ({
      ...prev,
      isDragging: true,
      draggedNode: node
    }))

    dragStartPosition.current = { ...node.position }
  }, [])

  // Update collision during drag
  const updateDrag = useCallback((
    draggedNode: ServerNode,
    allNodes: ServerNode[]
  ) => {
    if (!formationState.isDragging) return

    const collision = calculateCollision(draggedNode, allNodes)

    // Generate appropriate preview text based on collision type
    let previewName = ''
    if (collision.isColliding && collision.collidingWith.length > 0) {
      const firstCollider = collision.collidingWith[0]

      if (firstCollider.type === 'stack') {
        // Check for duplicate before showing preview
        const stackData = firstCollider.data.stackData
        if (stackData) {
          const serverAlreadyInStack = stackData.servers.some((server: any) => {
            return server.id === draggedNode.data.realId ||
                   server.name === draggedNode.data.label ||
                   (server.id === draggedNode.data.originalServerData?.id)
          })

          if (serverAlreadyInStack) {
            previewName = `⚠️ Already in ${firstCollider.data.label}`
          } else {
            previewName = `Add to ${firstCollider.data.label}`
          }
        } else {
          previewName = `Add to ${firstCollider.data.label}`
        }
      } else if (firstCollider.type === 'server') {
        // Creating new stack with servers
        previewName = generateStackName([draggedNode, ...collision.collidingWith])
      }
    }

    setFormationState(prev => ({
      ...prev,
      collision,
      previewName
    }))
  }, [formationState.isDragging, calculateCollision, generateStackName])

  // End drag operation and potentially create stack or add to existing stack
  const endDrag = useCallback(async (allNodes: ServerNode[]) => {
    if (!formationState.isDragging || !formationState.draggedNode) {
      setFormationState(prev => ({
        ...prev,
        isDragging: false,
        draggedNode: null,
        collision: { isColliding: false, collidingWith: [] },
        previewName: ''
      }))
      return null
    }

    const { draggedNode, collision } = formationState

    // Reset state first
    setFormationState({
      isDragging: false,
      draggedNode: null,
      collision: { isColliding: false, collidingWith: [] },
      isForming: false,
      previewName: ''
    })

    // Handle collision based on what the server was dropped onto
    if (collision.isColliding && collision.collidingWith.length > 0) {
      const firstCollider = collision.collidingWith[0]

      // Case 1: Dropping server onto existing stack
      if (firstCollider.type === 'stack' && firstCollider.data.stackData) {
        if (!draggedNode.data.realId) {
          console.warn('Cannot add server to stack: dragged server missing valid ID', draggedNode)
          toast.error('Cannot add server to stack: server has invalid data')
          return { success: false, error: 'Invalid server data' }
        }

        // Check for duplicate servers - prevent adding the same server twice
        const stackData = firstCollider.data.stackData
        const serverAlreadyInStack = stackData.servers.some((server: any) => {
          // Check by server ID and by server name as fallback
          return server.id === draggedNode.data.realId ||
                 server.name === draggedNode.data.label ||
                 (server.id === draggedNode.data.originalServerData?.id)
        })

        if (serverAlreadyInStack) {
          console.warn(`Server "${draggedNode.data.label}" is already in stack "${stackData.name}"`)
          toast.error(`Server "${draggedNode.data.label}" is already in stack "${stackData.name}"`)
          return { success: false, error: 'Server already in stack' }
        }

        try {
          setFormationState(prev => ({ ...prev, isForming: true }))

          console.log(`🎯 Adding server "${draggedNode.data.label}" to stack "${firstCollider.data.stackData.name}"`)

          // Smart endpoint selection: use UUID-based or name-based endpoint
          const serverId = draggedNode.data.realId
          if (!serverId) {
            throw new Error(`Server "${draggedNode.data.label}" has no ID`)
          }

          let updatedStack
          if (isValidUUID(serverId)) {
            // Use UUID-based endpoint for registered servers
            console.log(`🔗 Using UUID endpoint for registered server "${draggedNode.data.label}" (${serverId})`)
            updatedStack = await assignServersToStack(firstCollider.data.stackData.id, {
              server_ids: [serverId]
            })
          } else {
            // Use name-based endpoint for discovered servers (auto-imports)
            console.log(`📋 Using name-based endpoint for discovered server "${draggedNode.data.label}"`)
            updatedStack = await assignServersToStackByNames(firstCollider.data.stackData.id, {
              server_names: [draggedNode.data.label]
            })
          }

          toast.success(`✨ Server "${draggedNode.data.label}" added to stack "${firstCollider.data.stackData.name}"!`)

          return {
            success: true,
            stack: updatedStack,
            involvedNodes: [draggedNode],
            dropPosition: collision.dropZone,
            action: 'add_to_stack'
          }

        } catch (error) {
          console.error('Failed to add server to stack:', error)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          toast.error(`Failed to add server to stack: ${errorMessage}`)
          return { success: false, error }
        } finally {
          setFormationState(prev => ({ ...prev, isForming: false }))
        }
      }

      // Case 2: Creating new stack from multiple servers
      else if (firstCollider.type === 'server') {
        const allStackNodes = [draggedNode, ...collision.collidingWith.filter(n => n.type === 'server')]
        const invalidNodes = allStackNodes.filter(node => !node.data.realId)

        if (invalidNodes.length > 0) {
          console.warn('Cannot create stack: some servers missing valid IDs', invalidNodes)
          toast.error('Cannot create stack: some servers have invalid data')
          return { success: false, error: 'Invalid server data' }
        }

        // Extract server names from nodes for the new API
        const serverNames: string[] = []
        console.log('🔍 EXTRACTING SERVER NAMES FOR STACK CREATION:')

        for (const node of allStackNodes) {
          const serverName = node.data.label

          if (serverName) {
            serverNames.push(serverName)
            console.log(`✅ Added server name: "${serverName}"`)
          } else {
            console.error(`❌ Node missing server name:`, node.data)
          }
        }

        console.log('\n🎯 FINAL SERVER NAMES FOR API:', serverNames)

        if (serverNames.length >= 2) {
          setFormationState(prev => ({ ...prev, isForming: true }))

          try {
            const stackName = generateStackName(allStackNodes)

            console.log('Creating stack with server names:', serverNames)

            const newStack = await createStackWithNames({
              name: stackName,
              description: `Auto-created stack from ${serverNames.length} servers`,
              server_names: serverNames
            })

            toast.success(`✨ Stack "${stackName}" created successfully!`)

            return {
              success: true,
              stack: newStack,
              involvedNodes: allStackNodes,
              dropPosition: collision.dropZone,
              action: 'create_stack'
            }

          } catch (error) {
            console.error('Failed to create stack:', error)
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            toast.error(`Failed to create stack: ${errorMessage}`)
            return { success: false, error }
          } finally {
            setFormationState(prev => ({ ...prev, isForming: false }))
          }
        } else {
          console.warn('Insufficient server names for stack creation')
          toast.error('Need at least 2 valid servers to create a stack')
          return { success: false, error: 'Insufficient servers' }
        }
      }
    }

    return null
  }, [formationState, createStackWithNames, assignServersToStack, assignServersToStackByNames, generateStackName])

  // Cancel drag operation
  const cancelDrag = useCallback(() => {
    setFormationState({
      isDragging: false,
      draggedNode: null,
      collision: { isColliding: false, collidingWith: [] },
      isForming: false,
      previewName: ''
    })
  }, [])

  // Check if two nodes can form a stack or add to existing stack
  const canFormStack = useCallback((node1: ServerNode, node2: ServerNode): boolean => {
    // Can create new stack with two servers
    if (
      node1.type === 'server' &&
      node2.type === 'server' &&
      node1.id !== node2.id &&
      node1.data.realId &&
      node2.data.realId
    ) {
      return true
    }

    // Can add server to existing stack
    if (
      node1.type === 'server' &&
      node2.type === 'stack' &&
      node1.data.realId &&
      node2.data.stackData
    ) {
      return true
    }

    return false
  }, [])

  return {
    // State
    formationState,

    // Actions
    startDrag,
    updateDrag,
    endDrag,
    cancelDrag,
    canFormStack,
    calculateCollision,
    generateStackName,

    // Computed
    isDragging: formationState.isDragging,
    isColliding: formationState.collision.isColliding,
    isForming: formationState.isForming,
    previewName: formationState.previewName,
    collidingNodes: formationState.collision.collidingWith,
    dropZone: formationState.collision.dropZone,
  }
}