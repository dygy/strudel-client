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

-- Create unified file system nodes table (graph-based)
CREATE TABLE IF NOT EXISTS public.file_system_nodes (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('folder', 'track')),
    parent_id TEXT REFERENCES file_system_nodes(id) ON DELETE CASCADE,
    created TEXT NOT NULL,
    modified TEXT NOT NULL,
    
    -- Track-specific fields (NULL for folders)
    code TEXT,
    is_multitrack BOOLEAN DEFAULT FALSE,
    steps JSONB,
    active_step INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enhanced tree_nodes table with optimizations (new scalable system)
CREATE TABLE IF NOT EXISTS public.tree_nodes (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('folder', 'track')),
  parent_id TEXT REFERENCES tree_nodes(id) ON DELETE CASCADE,
  created TEXT NOT NULL,
  modified TEXT NOT NULL,
  
  -- Track-specific fields
  code TEXT,
  is_multitrack BOOLEAN DEFAULT FALSE,
  steps JSONB,
  active_step INTEGER DEFAULT 0,
  
  -- Metadata for extensibility
  metadata JSONB DEFAULT '{}',
  
  -- Materialized path for fast queries (optional optimization)
  path_array TEXT[],
  depth INTEGER,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Adjacency list optimization table (for very large trees)
CREATE TABLE IF NOT EXISTS public.tree_relationships (
  ancestor_id TEXT REFERENCES tree_nodes(id) ON DELETE CASCADE,
  descendant_id TEXT REFERENCES tree_nodes(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id)
);

-- Tree metadata and statistics
CREATE TABLE IF NOT EXISTS public.tree_metadata (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  total_nodes INTEGER DEFAULT 0,
  max_depth INTEGER DEFAULT 0,
  last_modified TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  statistics JSONB DEFAULT '{}'
);

-- Legacy tables for backward compatibility during migration
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
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Ensure unique track names within the same folder for the same user
    CONSTRAINT unique_track_name_per_folder UNIQUE (user_id, name, folder)
);

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
ALTER TABLE public.file_system_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tree_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tree_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tree_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

-- Create policies for profiles
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Create policies for tree_nodes
CREATE POLICY "Users can view own tree nodes" ON public.tree_nodes
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tree nodes" ON public.tree_nodes
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tree nodes" ON public.tree_nodes
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tree nodes" ON public.tree_nodes
    FOR DELETE USING (auth.uid() = user_id);

-- Create policies for tree_relationships
CREATE POLICY "Users can view own tree relationships" ON public.tree_relationships
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM tree_nodes 
            WHERE id = ancestor_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert own tree relationships" ON public.tree_relationships
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM tree_nodes 
            WHERE id = ancestor_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update own tree relationships" ON public.tree_relationships
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM tree_nodes 
            WHERE id = ancestor_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own tree relationships" ON public.tree_relationships
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM tree_nodes 
            WHERE id = ancestor_id AND user_id = auth.uid()
        )
    );

-- Create policies for tree_metadata
CREATE POLICY "Users can view own tree metadata" ON public.tree_metadata
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tree metadata" ON public.tree_metadata
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tree metadata" ON public.tree_metadata
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tree metadata" ON public.tree_metadata
    FOR DELETE USING (auth.uid() = user_id);

-- Create policies for tracks
CREATE POLICY "Users can view own tracks" ON public.tracks
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tracks" ON public.tracks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tracks" ON public.tracks
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tracks" ON public.tracks
    FOR DELETE USING (auth.uid() = user_id);

-- Create policies for folders
CREATE POLICY "Users can view own folders" ON public.folders
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own folders" ON public.folders
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own folders" ON public.folders
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own folders" ON public.folders
    FOR DELETE USING (auth.uid() = user_id);

-- Indexes for graph operations
CREATE INDEX IF NOT EXISTS idx_nodes_user_id ON public.file_system_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON public.file_system_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON public.file_system_nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_user_parent ON public.file_system_nodes(user_id, parent_id);

-- Optimized indexes for tree operations
CREATE INDEX IF NOT EXISTS idx_tree_nodes_user_id ON public.tree_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_parent_id ON public.tree_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_type ON public.tree_nodes(type);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_user_parent ON public.tree_nodes(user_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_path_array ON public.tree_nodes USING GIN(path_array);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_depth ON public.tree_nodes(depth);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_name ON public.tree_nodes(name);
CREATE INDEX IF NOT EXISTS idx_tree_nodes_metadata ON public.tree_nodes USING GIN(metadata);

CREATE INDEX IF NOT EXISTS idx_tree_rel_ancestor ON public.tree_relationships(ancestor_id);
CREATE INDEX IF NOT EXISTS idx_tree_rel_descendant ON public.tree_relationships(descendant_id);
CREATE INDEX IF NOT EXISTS idx_tree_rel_depth ON public.tree_relationships(depth);

-- Legacy indexes for backward compatibility
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
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tracks_updated_at
    BEFORE UPDATE ON public.tracks
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_folders_updated_at
    BEFORE UPDATE ON public.folders
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.tracks TO authenticated;
GRANT ALL ON public.folders TO authenticated;
GRANT ALL ON public.file_system_nodes TO authenticated;
GRANT ALL ON public.tree_nodes TO authenticated;
GRANT ALL ON public.tree_relationships TO authenticated;
GRANT ALL ON public.tree_metadata TO authenticated;