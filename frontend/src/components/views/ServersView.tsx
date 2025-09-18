'use client'

import React, { useState, useMemo } from 'react'
import { FaServer, FaPlus, FaPenToSquare, FaTrash, FaGear, FaHeartPulse, FaEllipsisVertical, FaTriangleExclamation, FaCircleCheck, FaClock, FaQuestion } from 'react-icons/fa6'
import { useServers, useServerStats, useServerHealth, useServerFilters } from '@/hooks/useServers'
import { useDashboardWebSocket } from '@/hooks/useWebSocket'
import type { MCPServer, CreateServerRequest, UpdateServerRequest } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'

interface CreateServerModalProps {
  isOpen: boolean
  onClose: () => void
  onCreateServer: (request: CreateServerRequest) => Promise<void>
}

function CreateServerModal({ isOpen, onClose, onCreateServer }: CreateServerModalProps) {
  const [serverData, setServerData] = useState({
    name: '',
    description: '',
    url: '',
    command: '',
    args: [] as string[],
    env: {} as Record<string, string>,
    transport: 'sse' as 'sse' | 'stdio',
    enabled: true,
  })
  const [isCreating, setIsCreating] = useState(false)
  const [argsInput, setArgsInput] = useState('')
  const [envInput, setEnvInput] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!serverData.name.trim()) return

    setIsCreating(true)
    try {
      const request: CreateServerRequest = {
        name: serverData.name,
        description: serverData.description || undefined,
        enabled: serverData.enabled,
      }

      if (serverData.transport === 'sse') {
        if (!serverData.url.trim()) {
          throw new Error('URL is required for SSE transport')
        }
        request.url = serverData.url
        request.transport = 'sse'
      } else {
        if (!serverData.command.trim()) {
          throw new Error('Command is required for stdio transport')
        }
        request.command = serverData.command
        request.transport = 'stdio'

        if (argsInput.trim()) {
          request.args = argsInput.split(',').map(arg => arg.trim()).filter(Boolean)
        }

        if (envInput.trim()) {
          try {
            request.env = JSON.parse(envInput)
          } catch {
            // Try to parse as key=value pairs
            const env: Record<string, string> = {}
            envInput.split(',').forEach(pair => {
              const [key, value] = pair.split('=').map(s => s.trim())
              if (key && value) {
                env[key] = value
              }
            })
            request.env = env
          }
        }
      }

      await onCreateServer(request)
      // Reset form
      setServerData({
        name: '',
        description: '',
        url: '',
        command: '',
        args: [],
        env: {},
        transport: 'sse',
        enabled: true,
      })
      setArgsInput('')
      setEnvInput('')
      onClose()
    } catch (error) {
      console.error('Failed to create server:', error)
      alert(error instanceof Error ? error.message : 'Failed to create server')
    } finally {
      setIsCreating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Add New MCP Server</h3>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Server Name</label>
                <input
                  type="text"
                  value={serverData.name}
                  onChange={(e) => setServerData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                  placeholder="e.g., My MCP Server"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Transport</label>
                <select
                  value={serverData.transport}
                  onChange={(e) => setServerData(prev => ({ ...prev, transport: e.target.value as any }))}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                >
                  <option value="sse">HTTP/SSE</option>
                  <option value="stdio">Command/Stdio</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Description (Optional)</label>
              <textarea
                value={serverData.description}
                onChange={(e) => setServerData(prev => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2 border rounded-md bg-background h-20 resize-none"
                placeholder="Describe what this server provides..."
              />
            </div>

            {serverData.transport === 'sse' ? (
              <div>
                <label className="block text-sm font-medium mb-2">Server URL</label>
                <input
                  type="url"
                  value={serverData.url}
                  onChange={(e) => setServerData(prev => ({ ...prev, url: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                  placeholder="https://example.com/sse"
                  required
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium mb-2">Command</label>
                  <input
                    type="text"
                    value={serverData.command}
                    onChange={(e) => setServerData(prev => ({ ...prev, command: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                    placeholder="npx"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Arguments (comma-separated)</label>
                  <input
                    type="text"
                    value={argsInput}
                    onChange={(e) => setArgsInput(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                    placeholder="@example/mcp-server, --option, value"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Environment Variables</label>
                  <textarea
                    value={envInput}
                    onChange={(e) => setEnvInput(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md bg-background h-16 resize-none"
                    placeholder='JSON: {"API_KEY": "value"} or KEY=value,KEY2=value2'
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    JSON format or comma-separated KEY=value pairs
                  </p>
                </div>
              </>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled"
                checked={serverData.enabled}
                onChange={(e) => setServerData(prev => ({ ...prev, enabled: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="enabled" className="text-sm">Enable server immediately</label>
            </div>

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
                disabled={isCreating || !serverData.name.trim()}
              >
                {isCreating ? 'Adding...' : 'Add Server'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default function ServersView() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'discovered' | 'custom' | 'marketplace'>('all')
  const [filterHealth, setFilterHealth] = useState<'all' | 'healthy' | 'error' | 'offline' | 'unknown'>('all')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selectedServer, setSelectedServer] = useState<MCPServer | null>(null)

  // Hooks
  const {
    servers,
    isLoading,
    isError,
    error,
    createServer,
    updateServer,
    deleteServer,
    testServerHealth,
    enableServer,
    disableServer,
    refreshServers,
  } = useServers()

  const {
    stats,
    healthyServers,
    errorServers,
    offlineServers,
    unknownServers,
    discoveredServers,
    customServers,
    marketplaceServers,
  } = useServerStats()

  const { testAllServers } = useServerHealth()
  const { searchServers, filterByType, filterByHealth } = useServerFilters()

  // Real-time updates
  useDashboardWebSocket()

  // Filtered servers
  const filteredServers = useMemo(() => {
    let filtered = servers

    // Filter by search query
    if (searchQuery) {
      filtered = searchServers(searchQuery)
    }

    // Filter by type
    if (filterType !== 'all') {
      filtered = filterByType(filterType)
    }

    // Filter by health
    if (filterHealth !== 'all') {
      filtered = filterByHealth(filterHealth)
    }

    return filtered
  }, [servers, searchQuery, filterType, filterHealth, searchServers, filterByType, filterByHealth])

  const getHealthStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <FaCircleCheck className="w-3 h-3 text-green-600" />
      case 'error':
        return <FaTriangleExclamation className="w-3 h-3 text-red-600" />
      case 'offline':
        return <FaClock className="w-3 h-3 text-gray-600" />
      default:
        return <FaQuestion className="w-3 h-3 text-yellow-600" />
    }
  }

  const getHealthStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-100 text-green-700'
      case 'error':
        return 'bg-red-100 text-red-700'
      case 'offline':
        return 'bg-gray-100 text-gray-700'
      default:
        return 'bg-yellow-100 text-yellow-700'
    }
  }

  const getServerTypeColor = (type: string) => {
    switch (type) {
      case 'discovered':
        return 'bg-blue-100 text-blue-700'
      case 'custom':
        return 'bg-purple-100 text-purple-700'
      case 'marketplace':
        return 'bg-orange-100 text-orange-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  const handleCreateServer = async (request: CreateServerRequest) => {
    await createServer(request)
  }

  const handleDeleteServer = async (serverId: string) => {
    if (confirm('Are you sure you want to delete this server? This action cannot be undone.')) {
      await deleteServer(serverId)
    }
  }

  const handleTestHealth = async (serverId: string) => {
    await testServerHealth(serverId)
  }

  const handleTestAllHealth = async () => {
    await testAllServers()
  }

  const handleToggleServer = async (server: MCPServer) => {
    if (server.enabled) {
      await disableServer(server.name)
    } else {
      await enableServer(server.name)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">MCP Servers</h2>
            <p className="text-sm text-muted-foreground">Loading servers...</p>
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
            <h2 className="text-xl font-semibold tracking-tight">MCP Servers</h2>
            <p className="text-sm text-red-600">Error loading servers: {error?.message}</p>
          </div>
          <button
            onClick={() => refreshServers()}
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
          <h2 className="text-xl font-semibold tracking-tight">MCP Servers</h2>
          <p className="text-sm text-muted-foreground">
            Manage and monitor your Model Context Protocol servers
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleTestAllHealth}
            className="btn btn-outline btn-sm flex items-center gap-2"
          >
            <FaHeartPulse className="w-3 h-3" />
            Test All
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="btn btn-primary btn-sm flex items-center gap-2"
          >
            <FaPlus className="w-3 h-3" />
            Add Server
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="card-basic text-center">
          <div className="text-2xl font-bold text-primary">{stats.total}</div>
          <div className="text-sm text-muted-foreground">Total Servers</div>
        </div>
        <div className="card-basic text-center">
          <div className="text-2xl font-bold text-green-600">{stats.healthDistribution.healthy}</div>
          <div className="text-sm text-muted-foreground">Healthy</div>
        </div>
        <div className="card-basic text-center">
          <div className="text-2xl font-bold text-red-600">{stats.healthDistribution.error}</div>
          <div className="text-sm text-muted-foreground">Errors</div>
        </div>
        <div className="card-basic text-center">
          <div className="text-2xl font-bold text-purple-600">{stats.totalTools || 0}</div>
          <div className="text-sm text-muted-foreground">Total Tools</div>
        </div>
        <div className="card-basic text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.typeDistribution.discovered}</div>
          <div className="text-sm text-muted-foreground">Discovered</div>
        </div>
        <div className="card-basic text-center">
          <div className="text-2xl font-bold text-orange-600">{Math.round(stats.avgToolsPerServer)}</div>
          <div className="text-sm text-muted-foreground">Avg Tools</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search servers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border rounded-md bg-background"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="px-3 py-2 border rounded-md bg-background"
          >
            <option value="all">All Types</option>
            <option value="discovered">Discovered</option>
            <option value="custom">Custom</option>
            <option value="marketplace">Marketplace</option>
          </select>
          <select
            value={filterHealth}
            onChange={(e) => setFilterHealth(e.target.value as any)}
            className="px-3 py-2 border rounded-md bg-background"
          >
            <option value="all">All Health</option>
            <option value="healthy">Healthy</option>
            <option value="error">Error</option>
            <option value="offline">Offline</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
      </div>

      {/* Servers Grid */}
      {filteredServers.length === 0 ? (
        <div className="card-basic text-center py-12">
          <FaServer className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No servers found</h3>
          <p className="text-muted-foreground mb-4">
            {servers.length === 0
              ? "Get started by adding your first MCP server"
              : "Try adjusting your search or filter criteria"
            }
          </p>
          {servers.length === 0 && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="btn btn-primary"
            >
              Add Your First Server
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredServers.map((server, index) => (
            <div key={server.id || `server-${index}`} className="card-basic group hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FaServer className="w-4 h-4 text-primary" />
                  <div>
                    <div className="font-medium">{server.name}</div>
                    <div className="flex gap-1 mt-1">
                      <span className={`text-xs px-2 py-1 rounded-md ${getHealthStatusColor(server.health_status)}`}>
                        {server.health_status}
                      </span>
                      <span className={`text-xs px-2 py-1 rounded-md ${getServerTypeColor(server.server_type)}`}>
                        {server.server_type}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getHealthStatusIcon(server.health_status)}
                  <button className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                    <FaEllipsisVertical className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {server.description && (
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                  {server.description}
                </p>
              )}

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tools:</span>
                  <span className="flex items-center gap-1">
                    <FaGear className="w-3 h-3" />
                    {server.tools_count || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Transport:</span>
                  <span className="text-xs px-2 py-1 rounded bg-gray-100">
                    {server.transport || 'Unknown'}
                  </span>
                </div>
                {server.last_health_check && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Last Check:</span>
                    <span className="text-xs">
                      {formatDistanceToNow(new Date(server.last_health_check), { addSuffix: true })}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center mt-4 pt-3 border-t">
                <div className="flex gap-1">
                  <button
                    onClick={() => handleTestHealth(server.id)}
                    className="text-xs px-2 py-1 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                  >
                    Test Health
                  </button>
                  <button
                    onClick={() => handleToggleServer(server)}
                    className={`text-xs px-2 py-1 rounded-md transition-colors ${
                      server.enabled
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                  >
                    {server.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
                <div className="flex gap-1">
                  <button className="text-muted-foreground hover:text-foreground p-1">
                    <FaPenToSquare className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDeleteServer(server.id)}
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

      {/* Create Server Modal */}
      <CreateServerModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreateServer={handleCreateServer}
      />
    </div>
  )
}
