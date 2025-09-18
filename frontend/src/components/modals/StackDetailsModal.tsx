'use client'

import React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import {
  FaLayerGroup,
  FaServer,
  FaTools,
  FaCog,
  FaCheckCircle,
  FaExclamationTriangle,
  FaTimesCircle,
  FaQuestionCircle
} from 'react-icons/fa'
import type { MCPStack, MCPServer } from '@/lib/api'

interface StackDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  stack: MCPStack | null
  servers?: MCPServer[]
}

export function StackDetailsModal({ isOpen, onClose, stack, servers = [] }: StackDetailsModalProps) {
  if (!stack) return null

  const getHealthStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <FaCheckCircle className="w-4 h-4 text-green-500" />
      case 'error':
        return <FaTimesCircle className="w-4 h-4 text-red-500" />
      case 'offline':
        return <FaExclamationTriangle className="w-4 h-4 text-gray-500" />
      default:
        return <FaQuestionCircle className="w-4 h-4 text-yellow-500" />
    }
  }

  const getHealthStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-100 text-green-700 border-green-200'
      case 'error':
        return 'bg-red-100 text-red-700 border-red-200'
      case 'offline':
        return 'bg-gray-100 text-gray-700 border-gray-200'
      default:
        return 'bg-yellow-100 text-yellow-700 border-yellow-200'
    }
  }

  const getStackStatus = () => {
    if (!stack.is_active) return { text: 'Inactive', color: 'bg-gray-100 text-gray-700' }
    return stack.agent_id
      ? { text: 'Active', color: 'bg-green-100 text-green-700' }
      : { text: 'Ready', color: 'bg-yellow-100 text-yellow-700' }
  }

  const stackStatus = getStackStatus()

  // Calculate total tools across all servers
  const totalTools = servers.reduce((count, server) => {
    // Assuming server has a tools_count property or tools array
    return count + (server.tools?.length || 0)
  }, 0)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FaLayerGroup className="w-5 h-5 text-primary" />
            {stack.name}
            <Badge className={stackStatus.color}>
              {stackStatus.text}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {stack.description || 'MCP Stack containing multiple servers and tools'}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6">
            {/* Stack Overview */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">Servers</div>
                <div className="text-2xl font-bold text-primary">{servers.length}</div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Total Tools</div>
                <div className="text-2xl font-bold text-primary">{totalTools}</div>
              </div>
            </div>

            <Separator />

            {/* Servers List */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <FaServer className="w-4 h-4" />
                <h3 className="font-medium">MCP Servers ({servers.length})</h3>
              </div>

              {servers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No servers assigned to this stack
                </div>
              ) : (
                <div className="space-y-3">
                  {servers.map((server, index) => (
                    <div key={server.id || index} className="border rounded-lg p-4 space-y-3">
                      {/* Server Header */}
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <FaServer className="w-4 h-4 text-blue-600" />
                            <span className="font-medium">{server.name}</span>
                            <Badge
                              variant="outline"
                              className={getHealthStatusColor(server.health_status || 'unknown')}
                            >
                              {getHealthStatusIcon(server.health_status || 'unknown')}
                              {server.health_status || 'unknown'}
                            </Badge>
                          </div>
                          {server.description && (
                            <p className="text-sm text-muted-foreground">{server.description}</p>
                          )}
                        </div>
                      </div>

                      {/* Server Tools */}
                      {server.tools && server.tools.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <FaTools className="w-3 h-3" />
                            <span className="text-sm font-medium">Tools ({server.tools.length})</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {server.tools.slice(0, 6).map((tool, toolIndex) => (
                              <Badge key={toolIndex} variant="secondary" className="text-xs">
                                {tool.name || `tool-${toolIndex}`}
                              </Badge>
                            ))}
                            {server.tools.length > 6 && (
                              <Badge variant="outline" className="text-xs">
                                +{server.tools.length - 6} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Server Configuration */}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <FaCog className="w-3 h-3" />
                          Type: {server.server_type || 'unknown'}
                        </div>
                        {server.url && (
                          <div className="truncate">
                            URL: {server.url}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Stack Metadata */}
            <Separator />
            <div className="space-y-2 text-sm text-muted-foreground">
              {stack.template_name && (
                <div>Template: {stack.template_name}</div>
              )}
              {stack.created_at && (
                <div>Created: {new Date(stack.created_at).toLocaleDateString()}</div>
              )}
              {stack.agent_id && (
                <div>Assigned to Agent: {stack.agent_id}</div>
              )}
            </div>
          </div>
        </ScrollArea>

        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}