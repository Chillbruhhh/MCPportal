-- MCP Portal Database Schema
-- Supabase PostgreSQL Schema for Agent Management, MCP Stacks, and Server Configuration

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table is handled by Supabase Auth automatically

-- agents table - Connected agents (Claude Code, Cursor, Kiro, etc.)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'claude-code', 'cursor', 'kiro', 'custom'
  token_hash TEXT NOT NULL UNIQUE,
  last_connected TIMESTAMP,
  status TEXT DEFAULT 'offline', -- 'online', 'offline', 'error'
  assigned_stack_id UUID,
  settings JSONB DEFAULT '{}', -- Agent-specific configuration
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- mcp_stacks table - Collections of MCP servers assigned to agents
CREATE TABLE mcp_stacks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  server_configs JSONB DEFAULT '[]', -- Array of MCP server configurations
  template_name TEXT, -- If created from template ('development', 'data-analysis', 'web-scraping')
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add foreign key constraint for agent assigned_stack_id
ALTER TABLE agents ADD CONSTRAINT fk_agents_stack
  FOREIGN KEY (assigned_stack_id) REFERENCES mcp_stacks(id) ON DELETE SET NULL;

-- mcp_servers table - Available MCP servers (discovered, custom, marketplace)
CREATE TABLE mcp_servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  server_type TEXT DEFAULT 'discovered', -- 'discovered', 'custom', 'marketplace'
  connection_config JSONB NOT NULL, -- Server connection details (stdio/http config)
  tools_config JSONB DEFAULT '{}', -- Enabled/disabled tools and configurations
  health_status TEXT DEFAULT 'unknown', -- 'healthy', 'error', 'offline', 'unknown'
  last_health_check TIMESTAMP,
  icon_url TEXT, -- Optional icon for UI
  documentation_url TEXT, -- Link to server documentation
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- stack_server_assignments table - Many-to-many relationship between stacks and servers
CREATE TABLE stack_server_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stack_id UUID REFERENCES mcp_stacks(id) ON DELETE CASCADE,
  server_id UUID REFERENCES mcp_servers(id) ON DELETE CASCADE,
  server_config JSONB DEFAULT '{}', -- Stack-specific server configuration overrides
  tool_permissions JSONB DEFAULT '{}', -- Specific tool enable/disable for this stack
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(stack_id, server_id) -- Prevent duplicate assignments
);

-- agent_tokens table - Authentication tokens for agents
CREATE TABLE agent_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT, -- Optional human-readable token name
  agent_type TEXT, -- Intended agent type hint
  last_used TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMP, -- Optional token expiration
  created_at TIMESTAMP DEFAULT NOW()
);

-- agent_access_logs table - Security monitoring and usage tracking
CREATE TABLE agent_access_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  server_name TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  error_message TEXT,
  request_data JSONB, -- Request parameters (sanitized)
  response_size INTEGER, -- Response size in bytes
  duration_ms INTEGER, -- Request duration in milliseconds
  created_at TIMESTAMP DEFAULT NOW()
);

-- dashboard_layouts table - Save user's custom hub graph layouts
CREATE TABLE dashboard_layouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT DEFAULT 'default',
  layout_data JSONB NOT NULL, -- React Flow nodes and edges
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, name) -- One layout per name per user
);

-- Create indexes for performance
CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE INDEX idx_agents_token_hash ON agents(token_hash);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_mcp_stacks_user_id ON mcp_stacks(user_id);
CREATE INDEX idx_mcp_stacks_agent_id ON mcp_stacks(agent_id);
CREATE INDEX idx_mcp_servers_user_id ON mcp_servers(user_id);
CREATE INDEX idx_mcp_servers_type ON mcp_servers(server_type);
CREATE INDEX idx_stack_server_assignments_stack_id ON stack_server_assignments(stack_id);
CREATE INDEX idx_stack_server_assignments_server_id ON stack_server_assignments(server_id);
CREATE INDEX idx_agent_tokens_user_id ON agent_tokens(user_id);
CREATE INDEX idx_agent_tokens_hash ON agent_tokens(token_hash);
CREATE INDEX idx_agent_access_logs_agent_id ON agent_access_logs(agent_id);
CREATE INDEX idx_agent_access_logs_created_at ON agent_access_logs(created_at);
CREATE INDEX idx_dashboard_layouts_user_id ON dashboard_layouts(user_id);

-- Row Level Security (RLS) policies
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_stacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stack_server_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_layouts ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Users can only access their own data
CREATE POLICY "Users can view own agents" ON agents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own agents" ON agents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own agents" ON agents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own agents" ON agents FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own stacks" ON mcp_stacks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own stacks" ON mcp_stacks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own stacks" ON mcp_stacks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own stacks" ON mcp_stacks FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own servers" ON mcp_servers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own servers" ON mcp_servers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own servers" ON mcp_servers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own servers" ON mcp_servers FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own stack assignments" ON stack_server_assignments FOR SELECT
  USING (EXISTS (SELECT 1 FROM mcp_stacks WHERE id = stack_id AND user_id = auth.uid()));
CREATE POLICY "Users can insert own stack assignments" ON stack_server_assignments FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM mcp_stacks WHERE id = stack_id AND user_id = auth.uid()));
CREATE POLICY "Users can update own stack assignments" ON stack_server_assignments FOR UPDATE
  USING (EXISTS (SELECT 1 FROM mcp_stacks WHERE id = stack_id AND user_id = auth.uid()));
CREATE POLICY "Users can delete own stack assignments" ON stack_server_assignments FOR DELETE
  USING (EXISTS (SELECT 1 FROM mcp_stacks WHERE id = stack_id AND user_id = auth.uid()));

CREATE POLICY "Users can view own tokens" ON agent_tokens FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own tokens" ON agent_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own tokens" ON agent_tokens FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own tokens" ON agent_tokens FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own access logs" ON agent_access_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM agents WHERE id = agent_id AND user_id = auth.uid()));

CREATE POLICY "Users can view own layouts" ON dashboard_layouts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own layouts" ON dashboard_layouts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own layouts" ON dashboard_layouts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own layouts" ON dashboard_layouts FOR DELETE USING (auth.uid() = user_id);

-- Functions for common operations
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at timestamps
CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mcp_stacks_updated_at BEFORE UPDATE ON mcp_stacks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mcp_servers_updated_at BEFORE UPDATE ON mcp_servers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dashboard_layouts_updated_at BEFORE UPDATE ON dashboard_layouts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Utility function to get agent's accessible tools
CREATE OR REPLACE FUNCTION get_agent_accessible_tools(agent_token_hash TEXT)
RETURNS TABLE (
  server_name TEXT,
  tool_name TEXT,
  tool_config JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.name as server_name,
    tool.key as tool_name,
    tool.value as tool_config
  FROM agents a
  JOIN mcp_stacks st ON a.assigned_stack_id = st.id
  JOIN stack_server_assignments ssa ON st.id = ssa.stack_id
  JOIN mcp_servers s ON ssa.server_id = s.id
  CROSS JOIN LATERAL jsonb_each(s.tools_config) as tool
  WHERE a.token_hash = agent_token_hash
    AND a.status = 'online'
    AND st.is_active = true
    AND s.health_status = 'healthy'
    AND (ssa.tool_permissions->tool.key)::boolean IS NOT FALSE; -- Allow if not explicitly disabled
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log agent access attempts
CREATE OR REPLACE FUNCTION log_agent_access(
  agent_token_hash TEXT,
  tool_name TEXT,
  server_name TEXT,
  success BOOLEAN,
  error_message TEXT DEFAULT NULL,
  request_size INTEGER DEFAULT NULL,
  response_size INTEGER DEFAULT NULL,
  duration_ms INTEGER DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  agent_uuid UUID;
BEGIN
  SELECT id INTO agent_uuid FROM agents WHERE token_hash = agent_token_hash;

  INSERT INTO agent_access_logs (
    agent_id, tool_name, server_name, success, error_message,
    response_size, duration_ms
  ) VALUES (
    agent_uuid, tool_name, server_name, success, error_message,
    response_size, duration_ms
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Default MCP stack templates: seeded per user via helper function below.
-- Do NOT insert with a fixed 0000-... user_id; it violates FK to auth.users.
-- Use the function `create_default_stacks_for_current_user()` from an
-- authenticated session to create templates for the current user.

CREATE OR REPLACE FUNCTION create_default_stacks_for_current_user()
RETURNS void AS $$
DECLARE
  uid uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null; call from an authenticated context';
  END IF;
  INSERT INTO mcp_stacks (user_id, name, description, template_name, server_configs) VALUES
    (uid, 'Development Stack', 'Common tools for software development', 'development', '[]'),
    (uid, 'Data Analysis Stack', 'Tools for data science and analysis', 'data-analysis', '[]'),
    (uid, 'Web Scraping Stack', 'Tools for web scraping and automation', 'web-scraping', '[]'),
    (uid, 'Content Creation Stack', 'Tools for content writing and media', 'content-creation', '[]');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments for documentation
COMMENT ON TABLE agents IS 'Connected AI agents (Claude Code, Cursor, Kiro, etc.)';
COMMENT ON TABLE mcp_stacks IS 'Collections of MCP servers assigned to specific agents';
COMMENT ON TABLE mcp_servers IS 'Available MCP servers (discovered, custom, or from marketplace)';
COMMENT ON TABLE stack_server_assignments IS 'Many-to-many relationship between stacks and servers';
COMMENT ON TABLE agent_tokens IS 'Authentication tokens for agent connections';
COMMENT ON TABLE agent_access_logs IS 'Security and usage monitoring logs';
COMMENT ON TABLE dashboard_layouts IS 'Saved React Flow graph layouts per user';

COMMENT ON COLUMN agents.type IS 'Agent type: claude-code, cursor, kiro, custom';
COMMENT ON COLUMN agents.status IS 'Connection status: online, offline, error';
COMMENT ON COLUMN mcp_servers.server_type IS 'Server source: discovered, custom, marketplace';
COMMENT ON COLUMN mcp_servers.health_status IS 'Health check status: healthy, error, offline, unknown';
