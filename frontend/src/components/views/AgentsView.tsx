'use client'

import React, { useState } from 'react'
import {
  Plus,
  MoreVertical,
  Settings,
  Trash2,
  Activity,
  Clock,
  Key,
  Copy,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  XCircle,
  Circle
} from 'lucide-react'
import { FaUserTie } from 'react-icons/fa6'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAgents, useAgentStatus } from '@/hooks/useAgents'
import { useStacks } from '@/hooks/useStacks'
import { useDashboardWebSocket } from '@/hooks/useWebSocket'
import { Agent, MCPStack } from '@/lib/api'

// Agent icon styling based on type
const getAgentIconColor = (type: string) => {
  switch (type) {
    case 'claude-code':
      return 'text-orange-500'
    case 'cursor':
      return 'text-blue-500'
    case 'kiro':
      return 'text-purple-500'
    case 'custom':
      return 'text-green-500'
    default:
      return 'text-gray-500'
  }
}

// Agent Status Colors
const STATUS_COLORS = {
  online: 'text-green-500',
  offline: 'text-gray-500',
  error: 'text-red-500'
}

interface AgentCardProps {
  agent: Agent
  onEdit: (agent: Agent) => void
  onDelete: (agent: Agent) => void
  onViewLogs: (agent: Agent) => void
  onAssignStack: (agent: Agent) => void
}

function AgentCard({ agent, onEdit, onDelete, onViewLogs, onAssignStack }: AgentCardProps) {
  const [showDropdown, setShowDropdown] = useState(false)

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'offline':
        return <Circle className="w-4 h-4 text-gray-500" />
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return <AlertCircle className="w-4 h-4 text-yellow-500" />
    }
  }

  return (
    <Card className="relative hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-accent ${getAgentIconColor(agent.type)}`}>
              <FaUserTie className="w-6 h-6" />
            </div>
            <div>
              <CardTitle className="text-lg">{agent.name}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                {getStatusIcon(agent.status)}
                <span className={`text-sm capitalize ${STATUS_COLORS[agent.status as keyof typeof STATUS_COLORS]}`}>
                  {agent.status}
                </span>
              </div>
            </div>
          </div>

          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDropdown(!showDropdown)}
            >
              <MoreVertical className="w-4 h-4" />
            </Button>

            {showDropdown && (
              <div className="absolute right-0 mt-1 z-10 w-48 bg-card border border-border rounded-lg shadow-lg py-1">
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
                  onClick={() => {
                    onEdit(agent)
                    setShowDropdown(false)
                  }}
                >
                  <Settings className="w-4 h-4" />
                  Edit Settings
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
                  onClick={() => {
                    onAssignStack(agent)
                    setShowDropdown(false)
                  }}
                >
                  <Activity className="w-4 h-4" />
                  Assign Stack
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
                  onClick={() => {
                    onViewLogs(agent)
                    setShowDropdown(false)
                  }}
                >
                  <Clock className="w-4 h-4" />
                  View Logs
                </button>
                <hr className="my-1" />
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent text-red-600 flex items-center gap-2"
                  onClick={() => {
                    onDelete(agent)
                    setShowDropdown(false)
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Agent
                </button>
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Assigned Stack:</span>
            <span className="font-medium">
              {agent.assigned_stack ? agent.assigned_stack.name : 'None'}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Available Tools:</span>
            <span className="font-medium">{agent.tools_count}</span>
          </div>

          {agent.last_connected && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Last Connected:</span>
              <span className="font-medium">
                {formatDistanceToNow(new Date(agent.last_connected), { addSuffix: true })}
              </span>
            </div>
          )}

          {agent.last_access && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Last Active:</span>
              <span className="font-medium">
                {formatDistanceToNow(new Date(agent.last_access), { addSuffix: true })}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

interface CreateTokenDialogProps {
  open: boolean
  onClose: () => void
}

function CreateTokenDialog({ open, onClose }: CreateTokenDialogProps) {
  const [name, setName] = useState('')
  const [agentType, setAgentType] = useState<string>('')
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>()
  const [isCreating, setIsCreating] = useState(false)
  const [createdToken, setCreatedToken] = useState<string | null>(null)

  const { createToken } = useAgents()

  const handleCreate = async () => {
    if (!name.trim()) return

    setIsCreating(true)
    try {
      const result = await createToken({
        name: name.trim(),
        agent_type: agentType || undefined,
        expires_in_days: expiresInDays
      })
      setCreatedToken(result.token)
    } catch (error) {
      console.error('Failed to create token:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleClose = () => {
    setName('')
    setAgentType('')
    setExpiresInDays(undefined)
    setCreatedToken(null)
    onClose()
  }

  const copyToken = () => {
    if (createdToken) {
      navigator.clipboard.writeText(createdToken)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Agent Token</DialogTitle>
          <DialogDescription>
            Generate a secure token for agent authentication
          </DialogDescription>
        </DialogHeader>

        {!createdToken ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Token Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., My Claude Desktop"
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Agent Type (Optional)</label>
              <select
                value={agentType}
                onChange={(e) => setAgentType(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select agent type</option>
                <option value="claude-code">Claude Code</option>
                <option value="cursor">Cursor</option>
                <option value="kiro">Kiro</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Expires In (Days)</label>
              <input
                type="number"
                value={expiresInDays || ''}
                onChange={(e) => setExpiresInDays(e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Leave empty for no expiration"
                min="1"
                max="365"
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!name.trim() || isCreating}
              >
                {isCreating ? 'Creating...' : 'Create Token'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2">
                ⚠️ <strong>Important:</strong> Save this token now - it won't be shown again!
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Your Agent Token</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={createdToken}
                  readOnly
                  className="flex-1 px-3 py-2 border border-border rounded-lg bg-muted font-mono text-sm"
                />
                <Button variant="outline" size="sm" onClick={copyToken}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              <p>To connect your agent:</p>
              <ol className="list-decimal list-inside mt-2 space-y-1">
                <li>Copy the token above</li>
                <li>Configure your agent with this token</li>
                <li>Set the MCP Portal endpoint: <code className="bg-muted px-1 rounded">{process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8025'}</code></li>
              </ol>
            </div>

            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function AgentsView() {
  const [showCreateToken, setShowCreateToken] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showLogsDialog, setShowLogsDialog] = useState(false)
  const [showAssignStackDialog, setShowAssignStackDialog] = useState(false)

  const {
    agents,
    tokens,
    isLoading,
    refreshAgents,
    deleteAgent,
    updateAgent,
    assignStackToAgent
  } = useAgents()
  const { stats } = useAgentStatus()
  const { stacks } = useStacks()

  // Connect to WebSocket for real-time updates
  useDashboardWebSocket()

  const handleDelete = async (agent: Agent) => {
    try {
      await deleteAgent(agent.id)
      setShowDeleteDialog(false)
      setSelectedAgent(null)
    } catch (error) {
      console.error('Failed to delete agent:', error)
    }
  }

  const handleAssignStack = async (stackId: string) => {
    if (!selectedAgent) return

    try {
      await assignStackToAgent(selectedAgent.id, stackId)
      setShowAssignStackDialog(false)
      setSelectedAgent(null)
    } catch (error) {
      console.error('Failed to assign stack:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">My Agents</h2>
          <p className="text-muted-foreground">
            Connect your Claude, Cursor, Kiro, and other agents to dedicated MCP stacks
          </p>
        </div>
        <Button onClick={() => setShowCreateToken(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Agent Token
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Agents</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Activity className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Online</p>
                <p className="text-2xl font-bold text-green-500">{stats.online}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Offline</p>
                <p className="text-2xl font-bold text-gray-500">{stats.offline}</p>
              </div>
              <Circle className="w-8 h-8 text-gray-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Tokens</p>
                <p className="text-2xl font-bold">{tokens.filter(t => t.is_active).length}</p>
              </div>
              <Key className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Agents Grid */}
      {agents.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Activity className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Agents Connected</h3>
            <p className="text-muted-foreground mb-4">
              Create your first agent token to connect Claude, Cursor, or other agents
            </p>
            <Button onClick={() => setShowCreateToken(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Agent Token
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onEdit={(agent) => {
                setSelectedAgent(agent)
                setShowEditDialog(true)
              }}
              onDelete={(agent) => {
                setSelectedAgent(agent)
                setShowDeleteDialog(true)
              }}
              onViewLogs={(agent) => {
                setSelectedAgent(agent)
                setShowLogsDialog(true)
              }}
              onAssignStack={(agent) => {
                setSelectedAgent(agent)
                setShowAssignStackDialog(true)
              }}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <CreateTokenDialog
        open={showCreateToken}
        onClose={() => setShowCreateToken(false)}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{selectedAgent?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedAgent && handleDelete(selectedAgent)}
            >
              Delete Agent
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign Stack Dialog */}
      <Dialog open={showAssignStackDialog} onOpenChange={setShowAssignStackDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign MCP Stack</DialogTitle>
            <DialogDescription>
              Choose an MCP stack to assign to "{selectedAgent?.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {stacks.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                No stacks available. Create a stack first.
              </p>
            ) : (
              <div className="space-y-2">
                {stacks.map((stack) => (
                  <button
                    key={stack.id}
                    onClick={() => handleAssignStack(stack.id)}
                    className="w-full text-left p-3 border border-border rounded-lg hover:bg-accent transition-colors"
                  >
                    <div className="font-medium">{stack.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {stack.servers.length} servers, {stack.tools_count} tools
                    </div>
                  </button>
                ))}
              </div>
            )}
            <Button variant="outline" onClick={() => setShowAssignStackDialog(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
