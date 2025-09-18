'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { MCPServer, MCPStack } from '@/lib/api'
import { useStacks } from '@/hooks/useStacks'
import { toast } from 'react-hot-toast'
import { FaChevronDown, FaChevronRight, FaLayerGroup, FaServer } from 'react-icons/fa6'
import { FaTools } from 'react-icons/fa'

interface StackServerInspectorProps {
  stack: MCPStack | null
  open: boolean
  onClose: () => void
}

type ToolPermissionMap = Record<string, Record<string, boolean>>

type ToolConfigEntry = {
  key: string
  label: string
  description?: string
  prefixedName?: string
}

const statusTone: Record<string, { dot: string; text: string }> = {
  healthy: { dot: 'bg-emerald-500', text: 'text-emerald-600' },
  error: { dot: 'bg-red-500', text: 'text-red-600' },
  offline: { dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
  unknown: { dot: 'bg-amber-400', text: 'text-amber-600' },
}

function getStatusTone(status?: string) {
  return statusTone[status ?? 'unknown'] ?? statusTone.unknown
}

function normaliseServerId(server: MCPServer): string | null {
  if (server.id) return String(server.id)
  if (server.name) return server.name
  return null
}

function extractToolConfig(server: MCPServer): ToolConfigEntry[] {
  if (Array.isArray(server.discovered_tools) && server.discovered_tools.length > 0) {
    return server.discovered_tools.map((tool) => ({
      key: tool.original_name,
      label: tool.prefixed_name || tool.original_name,
      description: tool.description,
      prefixedName: tool.prefixed_name,
    }))
  }

  if (server.tools_config && typeof server.tools_config === 'object') {
    return Object.entries(server.tools_config).map(([toolName, definition]) => {
      const description =
        definition && typeof definition === 'object' && 'description' in definition
          ? String(definition.description)
          : undefined

      return { key: toolName, label: toolName, description }
    })
  }

  return []
}

function buildInitialPermissions(stack: MCPStack | null): ToolPermissionMap {
  if (!stack) return {}

  const map: ToolPermissionMap = {}

  stack.servers?.forEach((server) => {
    const serverId = normaliseServerId(server)
    if (!serverId) return

    const toolEntries = extractToolConfig(server)
    const existingPermissions = server.tool_permissions ?? {}
    const merged: Record<string, boolean> = {}

    toolEntries.forEach((tool) => {
      merged[tool.key] = existingPermissions[tool.key] ?? true
    })

    // Preserve any stored permissions even if the tool is not in tools_config anymore
    Object.entries(existingPermissions).forEach(([toolName, enabled]) => {
      if (!(toolName in merged)) {
        merged[toolName] = enabled
      }
    })

    map[serverId] = merged
  })

  return map
}

export function StackServerInspector({ stack, open, onClose }: StackServerInspectorProps) {
  const { assignServersToStack } = useStacks()
  const [toolPermissions, setToolPermissions] = useState<ToolPermissionMap>({})
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({})
  const [pendingServerId, setPendingServerId] = useState<string | null>(null)

  useEffect(() => {
    if (open && stack) {
      setToolPermissions(buildInitialPermissions(stack))
      setExpandedServers({})
    }
    if (!open) {
      setPendingServerId(null)
    }
  }, [open, stack])

const totalTools = useMemo(() => {
    if (!stack?.servers) return 0
    return stack.servers.reduce((count, server) => count + (server.discovered_tools?.length ?? server.tools_count ?? 0), 0)
  }, [stack])

  const handleRegisterTools = useCallback((serverId: string, toolNames: string[]) => {
    setToolPermissions((prev) => {
      const current = prev[serverId] ?? {}
      let changed = false
      const updated = { ...current }

      toolNames.forEach((tool) => {
        if (!(tool in updated)) {
          updated[tool] = true
          changed = true
        }
      })

      if (!changed) {
        return prev
      }

      return {
        ...prev,
        [serverId]: updated,
      }
    })
  }, [])

  const handleToggleTool = useCallback(
    async (server: MCPServer, toolName: string, nextValue: boolean) => {
      const serverId = normaliseServerId(server)
      if (!stack || !serverId) return

      const previousPermissions = { ...(toolPermissions[serverId] ?? {}) }
      const updatedServerPermissions = {
        ...previousPermissions,
        [toolName]: nextValue,
      }

      setToolPermissions((prev) => ({
        ...prev,
        [serverId]: updatedServerPermissions,
      }))
      setPendingServerId(serverId)

      try {
        const updatedStack = await assignServersToStack(String(stack.id), {
          server_ids: [serverId],
          tool_permissions: { [serverId]: updatedServerPermissions },
        })

        setToolPermissions(buildInitialPermissions(updatedStack))
        toast.success(`Updated tool access for ${toolName}`)
      } catch (error) {
        console.error('Failed to update tool permissions', error)
        setToolPermissions((prev) => ({
          ...prev,
          [serverId]: previousPermissions,
        }))
        toast.error('Failed to update tool permissions')
      } finally {
        setPendingServerId(null)
      }
    },
    [assignServersToStack, stack, toolPermissions]
  )

  const toggleExpanded = useCallback((serverId: string) => {
    setExpandedServers((prev) => ({
      ...prev,
      [serverId]: !prev[serverId],
    }))
  }, [])

  const stackServers = stack?.servers ?? []

  useEffect(() => {
    if (!stack?.servers) return

    stack.servers.forEach((server) => {
      const serverId = normaliseServerId(server)
      if (!serverId) return

      const toolNames = extractToolConfig(server).map((tool) => tool.key)
      if (toolNames.length > 0) {
        handleRegisterTools(serverId, toolNames)
      }
    })
  }, [handleRegisterTools, stack])

  return (
    <Dialog open={open} onOpenChange={(isOpen) => (!isOpen ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FaLayerGroup className="h-5 w-5 text-primary" />
            {stack?.name ?? 'Stack'}
          </DialogTitle>
          <DialogDescription>
            Manage MCP servers assigned to this stack and control tool access per server.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <div className="text-sm text-muted-foreground">Servers</div>
              <div className="text-2xl font-semibold text-primary">{stackServers.length}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <div className="text-sm text-muted-foreground">Total Tools</div>
              <div className="text-2xl font-semibold text-primary">{totalTools}</div>
            </div>
          </div>

          <Separator />

          <div className="max-h-[48vh] overflow-y-auto pr-3 scrollbar-primary">
            <div className="space-y-4">
              {stackServers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
                  No servers are assigned to this stack yet.
                </div>
              ) : (
                stackServers.map((server) => {
                  const serverId = normaliseServerId(server)
                  if (!serverId) return null

                  const tone = getStatusTone(server.health_status)
                  const isExpanded = expandedServers[serverId] ?? false
                  const toolEntries = extractToolConfig(server)
                  const serverPermissions = toolPermissions[serverId] ?? {}
                  const isSaving = pendingServerId === serverId

                  return (
                    <div key={serverId} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(serverId)}
                        className="flex w-full items-center justify-between text-left"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-1 h-2.5 w-2.5 rounded-full ${tone.dot}`} aria-hidden />
                          <div>
                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                              <FaServer className="h-4 w-4 text-primary" />
                              {server.name}
                            </div>
                            <div className={`text-xs ${tone.text}`}>
                              {server.health_status ? server.health_status.toUpperCase() : 'UNKNOWN'}
                            </div>
                          </div>
                        </div>
                        {isExpanded ? (
                          <FaChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <FaChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>

                      {server.description && (
                        <p className="mt-2 text-sm text-muted-foreground">{server.description}</p>
                      )}

                      {isExpanded && (
                        <div className="mt-4 space-y-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                            <FaTools className="h-3 w-3" />
                            Tools
                          </div>

                          {toolEntries.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                              This server has not reported any tools yet.
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {toolEntries.map((tool) => {
                                const isEnabled = serverPermissions[tool.key] ?? true
                                return (
                                  <label
                                    key={tool.key}
                                    className="flex items-start gap-3 rounded-lg border border-border bg-background p-3 hover:bg-muted"
                                  >
                                    <input
                                      type="checkbox"
                                      className="mt-1 h-4 w-4 accent-primary"
                                      checked={isEnabled}
                                      disabled={isSaving}
                                      onChange={(event) =>
                                        handleToggleTool(server, tool.key, event.target.checked)
                                      }
                                    />
                                    <div className="flex-1">
                                      <div className="text-sm font-medium text-foreground">
                                        {tool.label}
                                        {tool.prefixedName && tool.prefixedName !== tool.label && (
                                          <span className="ml-2 text-xs text-muted-foreground">
                                            {tool.prefixedName}
                                          </span>
                                        )}
                                      </div>
                                      {tool.description && (
                                        <div className="text-xs text-muted-foreground">{tool.description}</div>
                                      )}
                                    </div>
                                  </label>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default StackServerInspector
