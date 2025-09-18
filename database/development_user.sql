-- Development User Setup for MCP Portal
-- This script creates a development user in auth.users to satisfy foreign key constraints

-- Function to safely create a development user
CREATE OR REPLACE FUNCTION create_development_user_if_needed(dev_user_id UUID DEFAULT '00000000-0000-0000-0000-000000000000')
RETURNS VOID AS $$
BEGIN
  -- Check if the development user already exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = dev_user_id) THEN
    -- Create the development user with minimal required fields
    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin
    ) VALUES (
      dev_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'dev@mcpportal.local',
      '$2a$10$placeholder', -- Placeholder password hash
      NOW(),
      NOW(),
      NOW(),
      '{"provider": "development"}',
      '{"name": "Development User"}',
      false
    );

    RAISE NOTICE 'Created development user with ID: %', dev_user_id;
  ELSE
    RAISE NOTICE 'Development user already exists with ID: %', dev_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the development user
SELECT create_development_user_if_needed();

-- Grant necessary permissions for development
-- (This may need to be adjusted based on your Supabase setup)
COMMENT ON FUNCTION create_development_user_if_needed(UUID) IS 'Creates a development user in auth.users if it does not exist';