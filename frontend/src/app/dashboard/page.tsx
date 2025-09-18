'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ThemeToggleButton } from '@/components/ui/theme-toggle-button'
import HubView, { type HubViewHandle } from '@/components/views/HubView'
import { ReactFlowProvider } from '@xyflow/react'
import AgentsView from '@/components/views/AgentsView'
import StacksView from '@/components/views/StacksView'
import ServersView from '@/components/views/ServersView'
import MCPImportModal from '@/components/views/modals/MCPImportModal'
import { GraphStateProvider } from '@/components/providers/GraphStateProvider'
import { Button } from '@/components/ui/button'
import Image from 'next/image'
import portalLogo from '../../../../assets/portal-logo.png'
import { Card, CardContent } from '@/components/ui/card'
import { 
  Layers, 
  Server, 
  Settings, 
  Book, 
  BarChart3, 
  Store, 
  LayoutDashboard,
  Plus,
  Zap
} from 'lucide-react'
import { FaUserTie } from 'react-icons/fa6'
import { cn } from '@/lib/utils'
import { useServers } from '@/hooks/useServers'
// Using a lightweight inline dropdown to avoid portal/fly-in artifacts

type TabKey = 'graph' | 'overview' | 'agents' | 'stacks' | 'servers' | 'analytics' | 'marketplace' | 'docs' | 'settings'

export default function DashboardPage() {
  const [active, setActive] = useState<TabKey>('graph')
  const [showImport, setShowImport] = useState(false)
  const hubRef = useRef<HubViewHandle | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [serverSubmenuOpen, setServerSubmenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement | null>(null)
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Get servers data for the dropdown
  const { servers } = useServers()

  // Debug servers data to identify issues
  useEffect(() => {
    if (servers && servers.length > 0) {
      console.log('🔍 SERVERS DEBUG:', {
        total: servers.length,
        withIds: servers.filter(s => s && s.id).length,
        withoutIds: servers.filter(s => !s || !s.id).length,
        sampleData: servers.slice(0, 3).map(s => ({
          id: s?.id,
          name: s?.name,
          hasId: !!s?.id
        }))
      })

      // Check for problematic servers
      const problematicServers = servers.filter(s => !s || !s.id)
      if (problematicServers.length > 0) {
        console.warn('⚠️ Found servers without IDs:', problematicServers)
      }
    }
  }, [servers])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!addOpen && !serverSubmenuOpen) return
      const el = addMenuRef.current
      if (el && !el.contains(e.target as Node)) {
        setAddOpen(false)
        setServerSubmenuOpen(false)
        // Clear any pending timeout
        if (submenuTimeoutRef.current) {
          clearTimeout(submenuTimeoutRef.current)
          submenuTimeoutRef.current = null
        }
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      // Clean up timeout on unmount
      if (submenuTimeoutRef.current) {
        clearTimeout(submenuTimeoutRef.current)
      }
    }
  }, [addOpen, serverSubmenuOpen])

  // Helper functions for submenu control
  const openServerSubmenu = () => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current)
      submenuTimeoutRef.current = null
    }

    // Debug server data when opening submenu
    console.log('🔍 Opening server submenu with servers:', {
      hasServers: !!servers,
      serversLength: servers?.length || 0,
      firstFewServers: servers?.slice(0, 3).map(s => ({ id: s?.id, name: s?.name })) || []
    })

    setServerSubmenuOpen(true)
  }

  const closeServerSubmenu = () => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current)
    }
    submenuTimeoutRef.current = setTimeout(() => {
      setServerSubmenuOpen(false)
    }, 150)
  }

  const navItems = useMemo(() => ([
    { key: 'graph' as const, label: 'Hub', icon: LayoutDashboard, description: 'Visual MCP management' },
    { key: 'agents' as const, label: 'My Agents', icon: FaUserTie as any, description: 'Register external agents' },
    { key: 'stacks' as const, label: 'MCP Stacks', icon: Layers, description: 'Manage agent stacks' },
    { key: 'servers' as const, label: 'MCP Servers', icon: Server, description: 'Available servers' },
    { key: 'analytics' as const, label: 'Analytics', icon: BarChart3, description: 'Usage insights' },
    { key: 'marketplace' as const, label: 'Marketplace', icon: Store, description: 'Browse MCPs' },
    { key: 'docs' as const, label: 'Integration', icon: Book, description: 'Setup guides' },
    { key: 'settings' as const, label: 'Settings', icon: Settings, description: 'Preferences' },
  ]), [])

  // Metrics strip removed to give full height to the graph

  return (
    <>
      <div className="min-h-screen bg-background">
        <div className="flex h-screen overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[260px] border-r border-border bg-card">
          <div className="flex h-full flex-col">
            {/* Logo */}
            <div className="flex items-center gap-3 px-6 py-5 border-b border-border">
              <div className="w-16 h-16 logo-pulse-glow">
                <div className="w-16 h-16 rounded-full overflow-hidden relative z-10">
                  <Image
                    src={portalLogo}
                    alt="MCP Portal Logo"
                    width={64}
                    height={64}
                    className="w-full h-full object-cover object-center"
                    priority
                  />
                </div>
              </div>
              <div>
                <h1 className="font-bold text-lg">MCP Portal</h1>
                <p className="text-xs text-muted-foreground">Control Center</p>
              </div>
            </div>
            
            {/* Navigation */}
            <nav className="flex-1 p-4 space-y-1">
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Main Menu</div>
              {navItems.map(({ key, label, icon: Icon, description }) => (
                <button
                  key={key}
                  onClick={() => setActive(key)}
                  className={cn(
                    "w-full group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                    active === key
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Icon className={cn(
                    "w-4 h-4 transition-transform duration-200",
                    active === key && "text-primary",
                    "group-hover:scale-110"
                  )} />
                  <div className="flex-1 text-left">
                    <div>{label}</div>
                    {active === key && (
                      <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
                    )}
                  </div>
                  {active === key && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  )}
                </button>
              ))}
            </nav>
            
            {/* Footer */}
            <div className="p-4 border-t border-border">
              <div className="rounded-xl bg-primary/10 p-4 border border-primary/20">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold text-primary">Pro Tip</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Ctrl+K</kbd> for quick actions
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Header Bar */}
          <header className="h-16 border-b border-border bg-background flex items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold">
                {navItems.find(item => item.key === active)?.label}
              </h1>
              <span className="text-sm text-muted-foreground">
                {navItems.find(item => item.key === active)?.description}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {/* Connect Agent Button for Agents tab */}
              {active === 'agents' && (
                <Button
                  onClick={() => window.location.href = '/agents/connect'}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                >
                  <FaUserTie className="w-4 h-4" />
                  Connect Agent
                </Button>
              )}

              {active === 'graph' ? (
                <div ref={addMenuRef} className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setAddOpen((v) => !v)}
                  >
                    <Plus className="w-4 h-4" />
                    Add
                  </Button>
                  {addOpen && (
                    <div className="absolute right-0 mt-2 z-50 min-w-[180px] rounded-xl border border-border bg-card p-1 shadow-xl">
                      {/* MCP Server with submenu */}
                      <div
                        className="relative"
                        onMouseEnter={openServerSubmenu}
                        onMouseLeave={closeServerSubmenu}
                      >
                        <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-accent flex items-center justify-between">
                          MCP Server
                          <span className="text-xs opacity-60">←</span>
                        </button>

                        {/* Server selection submenu */}
                        {serverSubmenuOpen && (
                          <div
                            className="absolute right-full top-0 mr-1 z-60 min-w-[250px] rounded-xl border border-border bg-card p-1 shadow-xl"
                            onMouseEnter={openServerSubmenu}
                            onMouseLeave={closeServerSubmenu}
                          >
                            {!servers || servers.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">
                                No servers available
                              </div>
                            ) : (
                              servers.map((server, index) => {
                                // Debug each server
                                console.log(`🔍 Server ${index}:`, {
                                  server,
                                  hasServer: !!server,
                                  hasId: !!server?.id,
                                  id: server?.id,
                                  name: server?.name
                                })

                                // Skip servers without basic data
                                if (!server) {
                                  console.warn(`⚠️ Skipping null server at index ${index}`)
                                  return null
                                }

                                return (
                                <button
                                  key={server.id || `server-${index}`}
                                  className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-accent flex items-center gap-2"
                                  onClick={() => {
                                    // Check server data and generate fallback ID if needed
                                    let serverIdToUse = server.id
                                    if (!server.id) {
                                      console.warn('⚠️ Server has no ID, using fallback:', server.name)
                                      serverIdToUse = server.name?.toLowerCase().replace(/\s+/g, '-') || `server-${index}`
                                      console.log('🔄 Generated fallback ID:', serverIdToUse)
                                    }
                                    console.log('\n🖱️ ============================')
                                    console.log('🖱️ DROPDOWN SERVER CLICKED')
                                    console.log('🖱️ ============================')
                                    console.log('🎯 Server:', server.name)
                                    console.log('🎯 Original ID:', server.id || '(none)')
                                    console.log('🎯 Using ID:', serverIdToUse)
                                    console.log('🔗 Current tab:', active)
                                    console.log('🔗 hubRef status:', !!hubRef.current)
                                    console.log('🔗 addServerById available:', !!hubRef.current?.addServerById)

                                    // Validate current tab
                                    if (active !== 'graph') {
                                      console.error('❌ CRITICAL: Not on graph tab! Current tab:', active)
                                      console.error('❌ HubView component not mounted, cannot add server')
                                      return
                                    }

                                    // Validate hubRef
                                    if (!hubRef.current) {
                                      console.error('❌ CRITICAL: hubRef.current is null!')
                                      console.error('❌ HubView component may not be properly mounted')
                                      return
                                    }

                                    // Validate addServerById function
                                    if (!hubRef.current.addServerById) {
                                      console.error('❌ CRITICAL: addServerById function not found!')
                                      console.error('❌ useImperativeHandle may not be working properly')
                                      return
                                    }

                                    // Execute the function with the determined ID
                                    console.log('✅ All validations passed, calling addServerById with ID:', serverIdToUse)
                                    try {
                                      hubRef.current.addServerById(serverIdToUse)
                                      console.log('✅ addServerById called successfully')
                                    } catch (error) {
                                      console.error('❌ CRITICAL: addServerById threw error:', error)
                                    }

                                    // Clear timeout and close menus
                                    if (submenuTimeoutRef.current) {
                                      clearTimeout(submenuTimeoutRef.current)
                                      submenuTimeoutRef.current = null
                                    }
                                    setServerSubmenuOpen(false)
                                    setAddOpen(false)

                                    console.log('🖱️ ============================')
                                    console.log('🖱️ DROPDOWN CLICK COMPLETE')
                                    console.log('🖱️ ============================\n')
                                  }}
                                  onMouseEnter={openServerSubmenu}
                                >
                                  {/* Status indicator dot */}
                                  <div
                                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                      server.health_status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
                                    }`}
                                  />
                                  <div className="flex-1">
                                    <div className="font-medium">{server.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {server.tools_count || 0} tools
                                    </div>
                                  </div>
                                </button>
                              )}).filter(Boolean) // Remove null entries
                            )}
                          </div>
                        )}
                      </div>

                      {/* Agent button */}
                      <button
                        className="mt-1 w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-accent"
                        onClick={() => {
                          hubRef.current?.addAgent()
                          setAddOpen(false)
                        }}
                      >
                        Agent
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
              <ThemeToggleButton />
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 overflow-y-auto p-6">
            <div className="h-full flex flex-col">
              {/* Graph Area Only */}
              <Card className="flex-1 overflow-hidden shadow-xl">
                <CardContent className="p-0 h-full">
                  {active === 'graph' && (
                    <div className="h-full flex flex-col">
                      <div className="flex-1 min-h-0">
                        <GraphStateProvider
                          storageKey="mcp-portal-hub-graph"
                          autoSave={true}
                          debounceMs={300}
                        >
                          <ReactFlowProvider>
                            <HubView ref={hubRef} />
                          </ReactFlowProvider>
                        </GraphStateProvider>
                      </div>
                    </div>
                  )}
                  
                  {active === 'agents' && (
                    <div className="p-6">
                      <div className="mb-6">
                        <h2 className="text-2xl font-bold mb-2">Registered Agents</h2>
                        <p className="text-muted-foreground">
                          Connect your Claude, Cursor, Kiro, and other agents to dedicated MCP stacks
                        </p>
                      </div>
                      <AgentsView />
                    </div>
                  )}
                  
                  {active === 'stacks' && (
                    <div className="p-6">
                      <div className="mb-6">
                        <h2 className="text-2xl font-bold mb-2">MCP Stacks</h2>
                        <p className="text-muted-foreground">
                          Manage collections of MCP servers assigned to each agent
                        </p>
                      </div>
                      <StacksView />
                    </div>
                  )}
                  
                  {active === 'servers' && (
                    <div className="p-6 h-full overflow-y-auto scrollbar-primary">
                      <div className="mb-6">
                        <h2 className="text-2xl font-bold mb-2">Available MCP Servers</h2>
                        <p className="text-muted-foreground">
                          Browse and configure your MCP server inventory
                        </p>
                      </div>
                      <ServersView />
                    </div>
                  )}
                  
                  {active === 'analytics' && (
                    <div className="flex flex-col items-center justify-center py-24">
                      <div className="w-20 h-20 rounded-2xl bg-purple-500 flex items-center justify-center mb-6 shadow-lg">
                        <BarChart3 className="w-10 h-10 text-white" />
                      </div>
                      <h3 className="text-2xl font-bold mb-2">Analytics Dashboard</h3>
                      <p className="text-muted-foreground text-center max-w-md">
                        Track usage metrics, performance insights, and agent activity across your MCP infrastructure
                      </p>
                      <Button variant="outline" className="mt-6">
                        Coming Soon
                      </Button>
                    </div>
                  )}
                  
                  {active === 'marketplace' && (
                    <div className="flex flex-col items-center justify-center py-24">
                      <div className="w-20 h-20 rounded-2xl bg-green-500 flex items-center justify-center mb-6 shadow-lg">
                        <Store className="w-10 h-10 text-white" />
                      </div>
                      <h3 className="text-2xl font-bold mb-2">MCP Marketplace</h3>
                      <p className="text-muted-foreground text-center max-w-md">
                        Discover and install pre-built MCP servers from Smithery.ai and the community
                      </p>
                      <Button variant="glow" className="mt-6">
                        Browse Marketplace
                      </Button>
                    </div>
                  )}
                  
                  {active === 'docs' && (
                    <div className="flex flex-col items-center justify-center py-24">
                      <div className="w-20 h-20 rounded-2xl bg-blue-500 flex items-center justify-center mb-6 shadow-lg">
                        <Book className="w-10 h-10 text-white" />
                      </div>
                      <h3 className="text-2xl font-bold mb-2">Integration Guides</h3>
                      <p className="text-muted-foreground text-center max-w-md">
                        Step-by-step instructions to connect your agents to MCP Portal endpoints
                      </p>
                      <div className="flex gap-3 mt-6">
                        <Button variant="outline">Claude Setup</Button>
                        <Button variant="outline">Cursor Setup</Button>
                        <Button variant="outline">API Docs</Button>
                      </div>
                    </div>
                  )}
                  
                  {active === 'settings' && (
                    <div className="flex flex-col items-center justify-center py-24">
                      <div className="w-20 h-20 rounded-2xl bg-gray-500 flex items-center justify-center mb-6 shadow-lg">
                        <Settings className="w-10 h-10 text-white" />
                      </div>
                      <h3 className="text-2xl font-bold mb-2">Settings & Preferences</h3>
                      <p className="text-muted-foreground text-center max-w-md">
                        Manage your account, billing, API keys, and system preferences
                      </p>
                      <div className="flex gap-3 mt-6">
                        <Button variant="outline">Account</Button>
                        <Button variant="outline">Billing</Button>
                        <Button variant="outline">API Keys</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </main>
        </div>
      </div>
    </div>

    <MCPImportModal
      open={showImport}
      onClose={() => setShowImport(false)}
      onSelect={() => setShowImport(false)}
      onImport={() => setShowImport(false)}
    />
    </>
  )
}
