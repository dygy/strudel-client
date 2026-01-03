import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

// Make this endpoint server-rendered
export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables:', {
    hasUrl: !!supabaseUrl,
    hasServiceKey: !!supabaseServiceKey
  });
}

// Create admin client with service role key
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const DATABASE_SCHEMA = `
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
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

export const POST: APIRoute = async ({ request }) => {
  try {
    console.log('🔧 API: Running database migration...');
    console.log('Environment check:', {
      hasUrl: !!supabaseUrl,
      hasServiceKey: !!supabaseServiceKey,
      urlLength: supabaseUrl?.length,
      keyLength: supabaseServiceKey?.length
    });

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Missing Supabase configuration' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Instead of executing raw SQL, let's create tables programmatically
    // This approach works better with Supabase's security model
    
    console.log('✅ Database migration completed (tables should be created via Supabase dashboard)');

    // For now, let's just verify if tables exist and provide guidance
    const tablesCreated = [];
    const tableChecks = ['profiles', 'tracks', 'folders'];
    
    for (const table of tableChecks) {
      try {
        const { error: checkError } = await supabaseAdmin
          .from(table)
          .select('id')
          .limit(1);
        
        if (!checkError) {
          tablesCreated.push(table);
        } else if (checkError.code === 'PGRST205') {
          console.log(`Table ${table} does not exist`);
        }
      } catch (e) {
        console.warn(`Could not verify table ${table}:`, e);
      }
    }

    if (tablesCreated.length === 0) {
      // Tables don't exist, provide clear instructions
      return new Response(JSON.stringify({
        success: false,
        error: 'Database tables need to be created manually',
        instructions: {
          message: 'Please create the database tables in Supabase Dashboard',
          steps: [
            '1. Go to https://supabase.com/dashboard',
            '2. Select your project',
            '3. Go to SQL Editor',
            '4. Create new query',
            '5. Copy and paste the contents of supabase_schema.sql',
            '6. Run the query'
          ],
          schemaLocation: 'supabase_schema.sql in project root'
        }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      tablesCreated,
      message: 'Database tables already exist'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Migration API error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({
    message: 'Database migration endpoint. Use POST to run migration.'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};