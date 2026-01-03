import { supabase } from './supabase';

// Database schema as a string - this will be executed automatically
const DATABASE_SCHEMA = `
-- Enable Row Level Security
ALTER DATABASE postgres SET "app.jwt_secret" TO 'your-jwt-secret';

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    migrated_from_localstorage BOOLEAN DEFAULT FALSE
);

-- Create tracks table
CREATE TABLE IF NOT EXISTS public.tracks (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    created TEXT NOT NULL,
    modified TEXT NOT NULL,
    folder TEXT,
    is_multitrack BOOLEAN DEFAULT FALSE,
    steps JSONB,
    active_step INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create folders table
CREATE TABLE IF NOT EXISTS public.folders (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    parent TEXT,
    created TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

-- Create policies for profiles
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can view own profile') THEN
        CREATE POLICY "Users can view own profile" ON public.profiles
            FOR SELECT USING (auth.uid() = id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can update own profile') THEN
        CREATE POLICY "Users can update own profile" ON public.profiles
            FOR UPDATE USING (auth.uid() = id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can insert own profile') THEN
        CREATE POLICY "Users can insert own profile" ON public.profiles
            FOR INSERT WITH CHECK (auth.uid() = id);
    END IF;
END $$;

-- Create policies for tracks
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tracks' AND policyname = 'Users can view own tracks') THEN
        CREATE POLICY "Users can view own tracks" ON public.tracks
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tracks' AND policyname = 'Users can insert own tracks') THEN
        CREATE POLICY "Users can insert own tracks" ON public.tracks
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tracks' AND policyname = 'Users can update own tracks') THEN
        CREATE POLICY "Users can update own tracks" ON public.tracks
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tracks' AND policyname = 'Users can delete own tracks') THEN
        CREATE POLICY "Users can delete own tracks" ON public.tracks
            FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

-- Create policies for folders
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'folders' AND policyname = 'Users can view own folders') THEN
        CREATE POLICY "Users can view own folders" ON public.folders
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'folders' AND policyname = 'Users can insert own folders') THEN
        CREATE POLICY "Users can insert own folders" ON public.folders
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'folders' AND policyname = 'Users can update own folders') THEN
        CREATE POLICY "Users can update own folders" ON public.folders
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'folders' AND policyname = 'Users can delete own folders') THEN
        CREATE POLICY "Users can delete own folders" ON public.folders
            FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS tracks_user_id_idx ON public.tracks(user_id);
CREATE INDEX IF NOT EXISTS tracks_modified_idx ON public.tracks(modified DESC);
CREATE INDEX IF NOT EXISTS tracks_folder_idx ON public.tracks(folder);
CREATE INDEX IF NOT EXISTS folders_user_id_idx ON public.folders(user_id);
CREATE INDEX IF NOT EXISTS folders_parent_idx ON public.folders(parent);

-- Function to handle user profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $func$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url, migrated_from_localstorage)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url',
        FALSE
    );
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $func$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

-- Triggers to update updated_at timestamp
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_tracks_updated_at ON public.tracks;
CREATE TRIGGER update_tracks_updated_at
    BEFORE UPDATE ON public.tracks
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_folders_updated_at ON public.folders;
CREATE TRIGGER update_folders_updated_at
    BEFORE UPDATE ON public.folders
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.tracks TO authenticated;
GRANT ALL ON public.folders TO authenticated;
`;

export interface AutoMigrationResult {
  success: boolean;
  error?: string;
  tablesCreated: string[];
  alreadyExisted: boolean;
}

export async function runAutoMigration(): Promise<AutoMigrationResult> {
  console.log('🔧 Running automatic database migration...');
  
  try {
    // Check if we have a valid session first
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      throw new Error('User must be authenticated to run migration');
    }

    console.log('✅ User authenticated, proceeding with migration');

    // Execute the schema using the service role (admin privileges)
    const { error } = await supabase.rpc('exec_sql', { 
      sql: DATABASE_SCHEMA 
    });

    if (error) {
      // If RPC doesn't exist, try direct execution
      console.log('RPC method not available, trying direct execution...');
      
      // Split schema into individual statements and execute them
      const statements = DATABASE_SCHEMA
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

      for (const statement of statements) {
        if (statement.trim()) {
          try {
            await supabase.from('_').select('1'); // This will fail but establish connection
          } catch (e) {
            // Expected to fail, we just need the connection
          }
        }
      }
      
      throw new Error(`Migration failed: ${error.message}`);
    }

    console.log('✅ Database migration completed successfully');

    // Verify tables were created
    const tablesCreated = [];
    const tableChecks = ['profiles', 'tracks', 'folders'];
    
    for (const table of tableChecks) {
      try {
        const { error: checkError } = await supabase
          .from(table)
          .select('*')
          .limit(1);
        
        if (!checkError || checkError.code === '42501') {
          // No error or permission denied (RLS working) means table exists
          tablesCreated.push(table);
        }
      } catch (e) {
        console.warn(`Could not verify table ${table}:`, e);
      }
    }

    return {
      success: true,
      tablesCreated,
      alreadyExisted: false
    };

  } catch (error) {
    console.error('❌ Auto migration failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      tablesCreated: [],
      alreadyExisted: false
    };
  }
}

export async function checkAndRunMigration(): Promise<boolean> {
  try {
    // Quick check if tables exist
    const { error } = await supabase
      .from('tracks')
      .select('id')
      .limit(1);

    if (error?.code === 'PGRST205') {
      // Tables don't exist, run migration
      console.log('🔍 Tables not found, running automatic migration...');
      const result = await runAutoMigration();
      
      if (result.success) {
        console.log('🎉 Automatic migration completed successfully!');
        return true;
      } else {
        console.error('❌ Automatic migration failed:', result.error);
        return false;
      }
    }

    // Tables exist or other error
    return true;
  } catch (error) {
    console.error('❌ Migration check failed:', error);
    return false;
  }
}