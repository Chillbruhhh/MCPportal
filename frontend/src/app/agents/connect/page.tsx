'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FaUserTie, FaCopy, FaCheck, FaQrcode, FaExternalLinkAlt, FaCode, FaDownload } from 'react-icons/fa'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'react-hot-toast'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAgents } from '@/hooks/useAgents'

type AgentType = 'claude-code' | 'cursor' | 'kiro' | 'custom'

interface AgentConfig {
  type: AgentType
  name: string
  displayName: string
  description: string
  icon: string
  color: string
  setupInstructions: string[]
}

const AGENT_CONFIGS: AgentConfig[] = [
  {
    type: 'claude-code',
    name: 'claude-code',
    displayName: 'Claude Code',
    description: 'Connect your Claude Code IDE agent for seamless MCP integration',
    icon: '🤖',
    color: 'bg-blue-500',
    setupInstructions: [
      'Open Claude Code settings',
      'Navigate to MCP Servers configuration',
      'Add the generated configuration',
      'Restart Claude Code to connect'
    ]
  },
  {
    type: 'cursor',
    name: 'cursor',
    displayName: 'Cursor IDE',
    description: 'Connect your Cursor IDE agent for enhanced development workflow',
    icon: '⚡',
    color: 'bg-purple-500',
    setupInstructions: [
      'Open Cursor preferences',
      'Go to Extensions > MCP Servers',
      'Paste the generated configuration',
      'Reload window to activate connection'
    ]
  },
  {
    type: 'kiro',
    name: 'kiro',
    displayName: 'Kiro Agent',
    description: 'Connect your Kiro AI agent for advanced automation capabilities',
    icon: '🔥',
    color: 'bg-orange-500',
    setupInstructions: [
      'Access Kiro agent configuration',
      'Add MCP server to agent config',
      'Apply the generated settings',
      'Restart agent service'
    ]
  },
  {
    type: 'custom',
    name: 'custom',
    displayName: 'Custom Agent',
    description: 'Connect any MCP-compatible agent or custom implementation',
    icon: '⚙️',
    color: 'bg-green-500',
    setupInstructions: [
      'Configure your agent\'s MCP client',
      'Use the generated token and URL',
      'Implement MCP protocol handshake',
      'Test connection with health check'
    ]
  }
]

interface GeneratedToken {
  token: string
  tokenId: string
  agentType: AgentType
  agentName: string
  expiresAt?: string
}

export default function AgentConnectPage() {
  const [selectedAgent, setSelectedAgent] = useState<AgentConfig | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedToken, setGeneratedToken] = useState<GeneratedToken | null>(null)
  const [customAgentName, setCustomAgentName] = useState('')
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set())
  const [showQRCode, setShowQRCode] = useState(false)

  const { createAgentToken } = useAgents()

  // Keyboard shortcuts
  useHotkeys('esc', () => {
    setSelectedAgent(null)
    setGeneratedToken(null)
  })

  useHotkeys('ctrl+c', (e) => {
    if (generatedToken) {
      e.preventDefault()
      copyToClipboard('config', generateMCPConfig())
    }
  })

  const handleAgentSelect = (agent: AgentConfig) => {
    setSelectedAgent(agent)
    setCustomAgentName(agent.type === 'custom' ? '' : `My ${agent.displayName}`)
  }

  const handleGenerateToken = async () => {
    if (!selectedAgent) return

    setIsGenerating(true)
    try {
      const agentName = customAgentName || `My ${selectedAgent.displayName}`

      const response = await createAgentToken({
        name: agentName,
        agent_type: selectedAgent.type,
        expires_in_days: 365 // 1 year expiration
      })

      setGeneratedToken({
        token: response.token,
        tokenId: response.token_id,
        agentType: selectedAgent.type,
        agentName: agentName,
        expiresAt: response.expires_at
      })

      toast.success('Agent token generated successfully!')
    } catch (error) {
      console.error('Failed to generate token:', error)
      toast.error('Failed to generate agent token')
    } finally {
      setIsGenerating(false)
    }
  }

  const generateMCPConfig = () => {
    if (!generatedToken || !selectedAgent) return ''

    return JSON.stringify({
      mcpServers: {
        "mcp-portal": {
          command: "mcp-portal-client",
          args: ["--connect"],
          env: {
            MCP_PORTAL_URL: "http://localhost:8025",
            MCP_PORTAL_TOKEN: generatedToken.token,
            AGENT_TYPE: generatedToken.agentType,
            AGENT_NAME: generatedToken.agentName
          }
        }
      }
    }, null, 2)
  }

  const generateCurlCommand = () => {
    if (!generatedToken) return ''

    return `curl -X POST http://localhost:8025/api/v1/agents/connect-via-mcp \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${generatedToken.token}" \\
  -d '{"agent_name": "${generatedToken.agentName}", "agent_type": "${generatedToken.agentType}"}'`
  }

  const copyToClipboard = async (type: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedItems(prev => new Set(prev).add(type))
      toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} copied to clipboard!`)

      // Remove copied state after 2 seconds
      setTimeout(() => {
        setCopiedItems(prev => {
          const newSet = new Set(prev)
          newSet.delete(type)
          return newSet
        })
      }, 2000)
    } catch (error) {
      toast.error('Failed to copy to clipboard')
    }
  }

  const downloadConfig = () => {
    if (!generatedToken || !selectedAgent) return

    const config = generateMCPConfig()
    const blob = new Blob([config], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mcp-portal-${selectedAgent.type}-config.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast.success('Configuration downloaded!')
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <FaUserTie className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold">Connect Agent</h1>
              <p className="text-sm text-muted-foreground">
                Generate tokens to connect your agents to MCP Portal
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {!selectedAgent ? (
            <motion.div
              key="agent-selection"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto"
            >
              <div className="text-center mb-8">
                <h2 className="text-xl font-semibold mb-2">Choose Your Agent</h2>
                <p className="text-muted-foreground">
                  Select the type of agent you want to connect to MCP Portal
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {AGENT_CONFIGS.map((agent) => (
                  <motion.div
                    key={agent.type}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="card-basic cursor-pointer group hover:shadow-lg transition-all duration-200"
                    onClick={() => handleAgentSelect(agent)}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-xl ${agent.color} flex items-center justify-center text-white text-xl font-bold group-hover:scale-110 transition-transform`}>
                        {agent.icon}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                          {agent.displayName}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {agent.description}
                        </p>
                        <div className="mt-3 flex items-center gap-2 text-xs text-primary">
                          <span>Connect now</span>
                          <FaExternalLinkAlt className="w-3 h-3" />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ) : !generatedToken ? (
            <motion.div
              key="token-generation"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto"
            >
              <div className="card-basic">
                <div className="flex items-center gap-4 mb-6">
                  <div className={`w-16 h-16 rounded-xl ${selectedAgent.color} flex items-center justify-center text-white text-2xl`}>
                    {selectedAgent.icon}
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold">{selectedAgent.displayName}</h2>
                    <p className="text-muted-foreground">{selectedAgent.description}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Agent Name</label>
                    <input
                      type="text"
                      value={customAgentName}
                      onChange={(e) => setCustomAgentName(e.target.value)}
                      placeholder={`My ${selectedAgent.displayName}`}
                      className="w-full px-3 py-2 border rounded-md bg-background focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      This name will be displayed in the MCP Portal dashboard
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setSelectedAgent(null)}
                      className="btn btn-outline flex-1"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleGenerateToken}
                      disabled={isGenerating || !customAgentName.trim()}
                      className="btn btn-primary flex-1 flex items-center justify-center gap-2"
                    >
                      {isGenerating ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <FaCode className="w-4 h-4" />
                          Generate Token
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="token-display"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-4xl mx-auto"
            >
              <div className="text-center mb-6">
                <div className={`w-20 h-20 rounded-full ${selectedAgent.color} flex items-center justify-center text-white text-3xl mx-auto mb-4`}>
                  {selectedAgent.icon}
                </div>
                <h2 className="text-2xl font-semibold mb-2">Token Generated!</h2>
                <p className="text-muted-foreground">
                  Your {selectedAgent.displayName} agent is ready to connect
                </p>
              </div>

              {/* Token Information */}
              <div className="card-basic mb-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <FaUserTie className="w-4 h-4" />
                  Agent Information
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Agent Name:</span>
                    <div className="font-medium">{generatedToken.agentName}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Agent Type:</span>
                    <div className="font-medium">{generatedToken.agentType}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Token ID:</span>
                    <div className="font-mono text-xs">{generatedToken.tokenId}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Expires:</span>
                    <div className="font-medium">
                      {generatedToken.expiresAt
                        ? new Date(generatedToken.expiresAt).toLocaleDateString()
                        : 'Never'
                      }
                    </div>
                  </div>
                </div>
              </div>

              {/* MCP Configuration */}
              <div className="card-basic mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold flex items-center gap-2">
                    <FaCode className="w-4 h-4" />
                    MCP Configuration
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyToClipboard('config', generateMCPConfig())}
                      className="btn btn-outline btn-sm flex items-center gap-2"
                    >
                      {copiedItems.has('config') ? (
                        <>
                          <FaCheck className="w-3 h-3 text-green-600" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <FaCopy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </button>
                    <button
                      onClick={downloadConfig}
                      className="btn btn-outline btn-sm flex items-center gap-2"
                    >
                      <FaDownload className="w-3 h-3" />
                      Download
                    </button>
                  </div>
                </div>
                <pre className="bg-muted p-4 rounded-md overflow-x-auto text-sm">
                  <code>{generateMCPConfig()}</code>
                </pre>
              </div>

              {/* Setup Instructions */}
              <div className="card-basic mb-6">
                <h3 className="font-semibold mb-4">Setup Instructions</h3>
                <ol className="space-y-2">
                  {selectedAgent.setupInstructions.map((instruction, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <span className="w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0">
                        {index + 1}
                      </span>
                      <span className="text-sm">{instruction}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Advanced Options */}
              <div className="card-basic">
                <h3 className="font-semibold mb-4">Advanced Options</h3>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">cURL Command</h4>
                    <div className="flex items-center gap-2">
                      <pre className="bg-muted p-3 rounded-md overflow-x-auto text-xs flex-1">
                        <code>{generateCurlCommand()}</code>
                      </pre>
                      <button
                        onClick={() => copyToClipboard('curl', generateCurlCommand())}
                        className="btn btn-outline btn-sm"
                      >
                        {copiedItems.has('curl') ? <FaCheck className="text-green-600" /> : <FaCopy />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-center gap-4 mt-8">
                <button
                  onClick={() => {
                    setGeneratedToken(null)
                    setSelectedAgent(null)
                  }}
                  className="btn btn-outline"
                >
                  Connect Another Agent
                </button>
                <button
                  onClick={() => window.location.href = '/dashboard'}
                  className="btn btn-primary"
                >
                  Go to Dashboard
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* QR Code Modal */}
      <Dialog open={showQRCode} onOpenChange={setShowQRCode}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>QR Code Configuration</DialogTitle>
          </DialogHeader>
          <div className="text-center py-8">
            <FaQrcode className="w-24 h-24 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              QR code generation coming soon for mobile configuration
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}