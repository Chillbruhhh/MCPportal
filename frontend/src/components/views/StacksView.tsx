'use client'

import React, { useState, useMemo } from 'react'
import { FaLayerGroup, FaPlus, FaPenToSquare, FaTrash, FaServer, FaGear, FaRobot, FaEllipsisVertical } from 'react-icons/fa6'
import { toast } from 'react-hot-toast'
import { useStacks, useStackStats, useStackTemplates } from '@/hooks/useStacks'
import { useServers } from '@/hooks/useServers'
import { useDashboardWebSocket } from '@/hooks/useWebSocket'
import type { MCPStack, StackTemplate, CreateStackRequest } from '@/lib/api'

interface CreateStackModalProps {
  isOpen: boolean
  onClose: () => void
  onCreateStack: (request: CreateStackRequest) => Promise<void>
  onCreateFromTemplate: (templateName: string, stackName?: string) => Promise<void>
  templates: StackTemplate[]
}

function CreateStackModal({ isOpen, onClose, onCreateStack, onCreateFromTemplate, templates }: CreateStackModalProps) {
  const [stackName, setStackName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stackName.trim()) return

    setIsCreating(true)
    try {
      if (selectedTemplate) {
        await onCreateFromTemplate(selectedTemplate, stackName)
      } else {
        await onCreateStack({
          name: stackName,
          description: description || undefined,
        })
      }
      setStackName('')
      setDescription('')
      setSelectedTemplate(null)
      onClose()
    } catch (error) {
      console.error('Failed to create stack:', error)
    } finally {
      setIsCreating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-md mx-4">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Create New Stack</h3>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Stack Name</label>
              <input
                type="text"
                value={stackName}
                onChange={(e) => setStackName(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background"
                placeholder="e.g., Development Stack"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Description (Optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background h-20 resize-none"
                placeholder="Describe the purpose of this stack..."
              />
            </div>

            {templates.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-2">Create from Template (Optional)</label>
                <select
                  value={selectedTemplate || ''}
                  onChange={(e) => setSelectedTemplate(e.target.value || null)}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                >
                  <option value="">Create Empty Stack</option>
                  {templates.map((template) => (
                    <option key={template.name} value={template.name}>
                      {template.display_name}
                    </option>
                  ))}
                </select>
                {selectedTemplate && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {templates.find(t => t.name === selectedTemplate)?.description}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm border rounded-md hover:bg-accent"
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                disabled={isCreating || !stackName.trim()}
              >
                {isCreating ? 'Creating...' : 'Create Stack'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

interface RenameStackModalProps {
  isOpen: boolean
  stack: MCPStack | null
  newName: string
  onChange: (name: string) => void
  onClose: () => void
  onRename: () => Promise<void>
  isRenaming: boolean
}

function RenameStackModal({ isOpen, stack, newName, onChange, onClose, onRename, isRenaming }: RenameStackModalProps) {
  if (!isOpen || !stack) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-sm mx-4">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Rename Stack</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">×</button>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">New Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => onChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background"
              placeholder="Stack name"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-sm border rounded-md hover:bg-accent"
              disabled={isRenaming}
            >
              Cancel
            </button>
            <button
              onClick={onRename}
              className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
              disabled={isRenaming || !newName.trim()}
            >
              {isRenaming ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StacksView() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [filterAssignment, setFilterAssignment] = useState<'all' | 'assigned' | 'unassigned'>('all')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selectedStack, setSelectedStack] = useState<MCPStack | null>(null)
  const [renameStackState, setRenameStackState] = useState<MCPStack | null>(null)
  const [renameName, setRenameName] = useState('')
  const [isRenamingStack, setIsRenamingStack] = useState(false)

  // Hooks
  const {
    stacks,
    templates,
    isLoading,
    isError,
    error,
    createStack,
    updateStack,
    deleteStack,
    assignServersToStack,
    createStackFromTemplate,
    refreshStacks,
  } = useStacks()

  const { stats, activeStacks, inactiveStacks, assignedStacks, unassignedStacks } = useStackStats()
  const { servers } = useServers()

  // Real-time updates
  useDashboardWebSocket()

  // Filtered stacks
  const filteredStacks = useMemo(() => {
    let filtered = stacks

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(stack =>
        stack.name.toLowerCase().includes(query) ||
        stack.description?.toLowerCase().includes(query)
      )
    }

    // Filter by status
    if (filterStatus !== 'all') {
      filtered = filtered.filter(stack =>
        filterStatus === 'active' ? stack.is_active : !stack.is_active
      )
    }

    // Filter by assignment
    if (filterAssignment !== 'all') {
      filtered = filtered.filter(stack =>
        filterAssignment === 'assigned' ? !!stack.agent_id : !stack.agent_id
      )
    }

    return filtered
  }, [stacks, searchQuery, filterStatus, filterAssignment])

  const getStackStatusColor = (stack: MCPStack) => {
    if (!stack.is_active) return 'bg-gray-100 text-gray-700'
    return stack.agent_id ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
  }

  const getStackStatusText = (stack: MCPStack) => {
    if (!stack.is_active) return 'Inactive'
    return stack.agent_id ? 'Active' : 'Ready'
  }

  const handleCreateStack = async (request: CreateStackRequest) => {
    await createStack(request)
  }

  const handleCreateFromTemplate = async (templateName: string, stackName?: string) => {
    await createStackFromTemplate(templateName, stackName)
  }

  const handleDeleteStack = async (stackId: string) => {
    if (confirm('Are you sure you want to delete this stack? This action cannot be undone.')) {
      await deleteStack(stackId)
    }
  }

  const handleToggleStackStatus = async (stack: MCPStack) => {
    await updateStack(stack.id, {
      is_active: !stack.is_active
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">MCP Stacks</h2>
            <p className="text-sm text-muted-foreground">Loading stacks...</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card-basic animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2 mb-4"></div>
              <div className="h-3 bg-gray-200 rounded w-full"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">MCP Stacks</h2>
            <p className="text-sm text-red-600">Error loading stacks: {error?.message}</p>
          </div>
          <button
            onClick={() => refreshStacks()}
            className="btn btn-outline btn-sm"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">MCP Stacks</h2>
          <p className="text-sm text-muted-foreground">
            Collections of MCP servers. Assign stacks to agents for controlled access.
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="btn btn-primary btn-sm flex items-center gap-2"
        >
          <FaPlus className="w-3 h-3" />
          New Stack
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="card-basic text-center">
          <div className="text-2xl font-bold text-primary">{stats.total}</div>
          <div className="text-sm text-muted-foreground">Total Stacks</div>
        </div>
        <div className="card-basic text-center">
          <div className="text-2xl font-bold text-green-600">{stats.active}</div>
          <div className="text-sm text-muted-foreground">Active</div>
        </div>
        <div className="card-basic text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.assigned}</div>
          <div className="text-sm text-muted-foreground">Assigned</div>
        </div>
        <div className="card-basic text-center">
          <div className="text-2xl font-bold text-orange-600">{stats.totalServers}</div>
          <div className="text-sm text-muted-foreground">Total Servers</div>
        </div>
        <div className="card-basic text-center">
          <div className="text-2xl font-bold text-purple-600">{stats.totalTools}</div>
          <div className="text-sm text-muted-foreground">Total Tools</div>
        </div>
        <div className="card-basic text-center">
          <div className="text-2xl font-bold text-gray-600">{Math.round(stats.avgServersPerStack)}</div>
          <div className="text-sm text-muted-foreground">Avg Servers</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search stacks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border rounded-md bg-background"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="px-3 py-2 border rounded-md bg-background"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select
            value={filterAssignment}
            onChange={(e) => setFilterAssignment(e.target.value as any)}
            className="px-3 py-2 border rounded-md bg-background"
          >
            <option value="all">All Assignments</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </div>
      </div>

      {/* Stacks Grid */}
      {filteredStacks.length === 0 ? (
        <div className="card-basic text-center py-12">
          <FaLayerGroup className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No stacks found</h3>
          <p className="text-muted-foreground mb-4">
            {stacks.length === 0
              ? "Get started by creating your first MCP stack"
              : "Try adjusting your search or filter criteria"
            }
          </p>
          {stacks.length === 0 && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="btn btn-primary"
            >
              Create Your First Stack
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStacks.map((stack) => (
            <div key={stack.id} className="card-basic group hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FaLayerGroup className="w-4 h-4 text-primary" />
                  <div>
                    <div className="font-medium">{stack.name}</div>
                    {stack.template_name && (
                      <div className="text-xs text-muted-foreground">
                        Template: {stack.template_name}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-md ${getStackStatusColor(stack)}`}>
                    {getStackStatusText(stack)}
                  </span>
                  <button className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                    <FaEllipsisVertical className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {stack.description && (
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                  {stack.description}
                </p>
              )}

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Servers:</span>
                  <span className="flex items-center gap-1">
                    <FaServer className="w-3 h-3" />
                    {stack.servers.length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tools:</span>
                  <span className="flex items-center gap-1">
                    <FaGear className="w-3 h-3" />
                    {stack.tools_count}
                  </span>
                </div>
                {stack.agent_id && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Agent:</span>
                    <span className="flex items-center gap-1">
                      <FaRobot className="w-3 h-3" />
                      Assigned
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center mt-4 pt-3 border-t">
                <div className="flex gap-1">
                  <button
                    onClick={() => handleToggleStackStatus(stack)}
                    className={`text-xs px-2 py-1 rounded-md transition-colors ${
                      stack.is_active
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                  >
                    {stack.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
                <div className="flex gap-1">
                  <button
                    className="text-muted-foreground hover:text-foreground p-1"
                    onClick={() => openRenameStack(stack)}
                  >
                    <FaPenToSquare className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDeleteStack(stack.id)}
                    className="text-muted-foreground hover:text-red-600 p-1"
                  >
                    <FaTrash className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Stack Modal */}
      <CreateStackModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreateStack={handleCreateStack}
        onCreateFromTemplate={handleCreateFromTemplate}
        templates={templates}
      />

      <RenameStackModal
        isOpen={!!renameStackState}
        stack={renameStackState}
        newName={renameName}
        onChange={setRenameName}
        onClose={() => {
          setRenameStackState(null)
          setRenameName('')
        }}
        onRename={handleRenameStack}
        isRenaming={isRenamingStack}
      />
    </div>
  )
}
  const openRenameStack = (stack: MCPStack) => {
    setRenameStackState(stack)
    setRenameName(stack.name)
  }

  const handleRenameStack = async () => {
    if (!renameStackState) return
    const trimmed = renameName.trim()
    if (!trimmed) {
      toast.error('Stack name is required')
      return
    }

    setIsRenamingStack(true)
    try {
      await updateStack(renameStackState.id, { name: trimmed })
      toast.success('Stack renamed')
      setRenameStackState(null)
      setRenameName('')
      refreshStacks()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename stack'
      toast.error(message)
    } finally {
      setIsRenamingStack(false)
    }
  }
