-- Enhanced Tree-Based File System Schema for Strudel
-- Optimized for scalable hierarchical structures supporting millions of nodes

-- Drop existing tree tables if they exist (for clean migration)
DROP TABLE IF EXISTS public.tree_relationships CASCADE;
DROP TABLE IF EXISTS public.tree_metadata CASCADE;

-- Enhanced tree_nodes table with optimizations
DROP TABLE IF EXISTS public.tree_nodes CASCADE;
CREATE TABLE public.tree_nodes (
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

-- Optimized indexes for tree operations
CREATE INDEX idx_tree_nodes_user_id ON tree_nodes(user_id);
CREATE INDEX idx_tree_nodes_parent_id ON tree_nodes(parent_id);
CREATE INDEX idx_tree_nodes_type ON tree_nodes(type);
CREATE INDEX idx_tree_nodes_user_parent ON tree_nodes(user_id, parent_id);
CREATE INDEX idx_tree_nodes_path_array ON tree_nodes USING GIN(path_array);
CREATE INDEX idx_tree_nodes_depth ON tree_nodes(depth);
CREATE INDEX idx_tree_nodes_name ON tree_nodes(name);
CREATE INDEX idx_tree_nodes_metadata ON tree_nodes USING GIN(metadata);

-- Adjacency list optimization table (for very large trees)
CREATE TABLE tree_relationships (
  ancestor_id TEXT REFERENCES tree_nodes(id) ON DELETE CASCADE,
  descendant_id TEXT REFERENCES tree_nodes(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id)
);

CREATE INDEX idx_tree_rel_ancestor ON tree_relationships(ancestor_id);
CREATE INDEX idx_tree_rel_descendant ON tree_relationships(descendant_id);
CREATE INDEX idx_tree_rel_depth ON tree_relationships(depth);

-- Tree metadata and statistics
CREATE TABLE tree_metadata (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  total_nodes INTEGER DEFAULT 0,
  max_depth INTEGER DEFAULT 0,
  last_modified TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  statistics JSONB DEFAULT '{}'
);

-- Enable Row Level Security
ALTER TABLE tree_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tree_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tree_metadata ENABLE ROW LEVEL SECURITY;

-- Create policies for tree_nodes
CREATE POLICY "Users can view own tree nodes" ON tree_nodes
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tree nodes" ON tree_nodes
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tree nodes" ON tree_nodes
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tree nodes" ON tree_nodes
    FOR DELETE USING (auth.uid() = user_id);

-- Create policies for tree_relationships
CREATE POLICY "Users can view own tree relationships" ON tree_relationships
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM tree_nodes 
            WHERE id = ancestor_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert own tree relationships" ON tree_relationships
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM tree_nodes 
            WHERE id = ancestor_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update own tree relationships" ON tree_relationships
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM tree_nodes 
            WHERE id = ancestor_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own tree relationships" ON tree_relationships
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM tree_nodes 
            WHERE id = ancestor_id AND user_id = auth.uid()
        )
    );

-- Create policies for tree_metadata
CREATE POLICY "Users can view own tree metadata" ON tree_metadata
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tree metadata" ON tree_metadata
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tree metadata" ON tree_metadata
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tree metadata" ON tree_metadata
    FOR DELETE USING (auth.uid() = user_id);

-- Function to update materialized path and depth
CREATE OR REPLACE FUNCTION update_tree_path()
RETURNS TRIGGER AS $$
DECLARE
    parent_path TEXT[];
    parent_depth INTEGER;
BEGIN
    -- Handle deletion
    IF TG_OP = 'DELETE' THEN
        -- Update tree metadata
        UPDATE tree_metadata 
        SET total_nodes = total_nodes - 1,
            last_modified = NOW()
        WHERE user_id = OLD.user_id;
        
        RETURN OLD;
    END IF;
    
    -- Calculate path and depth
    IF NEW.parent_id IS NULL THEN
        NEW.path_array := ARRAY[NEW.name];
        NEW.depth := 0;
    ELSE
        SELECT path_array, depth INTO parent_path, parent_depth
        FROM tree_nodes WHERE id = NEW.parent_id;
        
        NEW.path_array := parent_path || NEW.name;
        NEW.depth := parent_depth + 1;
    END IF;
    
    -- Handle insertion
    IF TG_OP = 'INSERT' THEN
        -- Update tree metadata
        INSERT INTO tree_metadata (user_id, total_nodes, max_depth, last_modified)
        VALUES (NEW.user_id, 1, NEW.depth, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            total_nodes = tree_metadata.total_nodes + 1,
            max_depth = GREATEST(tree_metadata.max_depth, NEW.depth),
            last_modified = NOW();
            
        -- Insert into relationships table for fast ancestor queries
        INSERT INTO tree_relationships (ancestor_id, descendant_id, depth)
        VALUES (NEW.id, NEW.id, 0);
        
        -- Insert relationships to all ancestors
        IF NEW.parent_id IS NOT NULL THEN
            INSERT INTO tree_relationships (ancestor_id, descendant_id, depth)
            SELECT ancestor_id, NEW.id, depth + 1
            FROM tree_relationships
            WHERE descendant_id = NEW.parent_id;
        END IF;
    END IF;
    
    -- Handle updates (parent changes)
    IF TG_OP = 'UPDATE' AND OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
        -- Remove old relationships
        DELETE FROM tree_relationships WHERE descendant_id = NEW.id AND ancestor_id != NEW.id;
        
        -- Add new relationships
        INSERT INTO tree_relationships (ancestor_id, descendant_id, depth)
        VALUES (NEW.id, NEW.id, 0);
        
        IF NEW.parent_id IS NOT NULL THEN
            INSERT INTO tree_relationships (ancestor_id, descendant_id, depth)
            SELECT ancestor_id, NEW.id, depth + 1
            FROM tree_relationships
            WHERE descendant_id = NEW.parent_id;
        END IF;
        
        -- Update all descendants' paths and relationships
        WITH RECURSIVE descendants AS (
            SELECT id, path_array, depth FROM tree_nodes WHERE parent_id = NEW.id
            UNION ALL
            SELECT t.id, t.path_array, t.depth
            FROM tree_nodes t
            JOIN descendants d ON t.parent_id = d.id
        )
        UPDATE tree_nodes 
        SET path_array = NEW.path_array || array_remove(path_array, path_array[1:NEW.depth+1]),
            depth = NEW.depth + (depth - OLD.depth)
        WHERE id IN (SELECT id FROM descendants);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to maintain materialized paths and relationships
CREATE TRIGGER tree_path_trigger
    BEFORE INSERT OR UPDATE OR DELETE ON tree_nodes
    FOR EACH ROW EXECUTE FUNCTION update_tree_path();

-- Function to prevent cycles
CREATE OR REPLACE FUNCTION prevent_tree_cycles()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if the new parent would create a cycle
    IF NEW.parent_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM tree_relationships 
        WHERE ancestor_id = NEW.id AND descendant_id = NEW.parent_id
    ) THEN
        RAISE EXCEPTION 'Cannot create cycle: node % cannot be a child of %', NEW.id, NEW.parent_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to prevent cycles
CREATE TRIGGER prevent_cycles_trigger
    BEFORE INSERT OR UPDATE ON tree_nodes
    FOR EACH ROW EXECUTE FUNCTION prevent_tree_cycles();

-- Function to update updated_at timestamp
CREATE TRIGGER update_tree_nodes_updated_at
    BEFORE UPDATE ON tree_nodes
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Grant necessary permissions
GRANT ALL ON tree_nodes TO authenticated;
GRANT ALL ON tree_relationships TO authenticated;
GRANT ALL ON tree_metadata TO authenticated;

-- Utility functions for tree operations

-- Get all descendants of a node
CREATE OR REPLACE FUNCTION get_descendants(node_id TEXT, max_depth INTEGER DEFAULT NULL)
RETURNS TABLE(id TEXT, name TEXT, type TEXT, depth INTEGER, path TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT t.id, t.name, t.type, r.depth, array_to_string(t.path_array, '/') as path
    FROM tree_nodes t
    JOIN tree_relationships r ON t.id = r.descendant_id
    WHERE r.ancestor_id = node_id 
      AND r.descendant_id != node_id
      AND (max_depth IS NULL OR r.depth <= max_depth)
    ORDER BY r.depth, t.name;
END;
$$ LANGUAGE plpgsql;

-- Get all ancestors of a node
CREATE OR REPLACE FUNCTION get_ancestors(node_id TEXT)
RETURNS TABLE(id TEXT, name TEXT, type TEXT, depth INTEGER, path TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT t.id, t.name, t.type, r.depth, array_to_string(t.path_array, '/') as path
    FROM tree_nodes t
    JOIN tree_relationships r ON t.id = r.ancestor_id
    WHERE r.descendant_id = node_id 
      AND r.ancestor_id != node_id
    ORDER BY r.depth DESC;
END;
$$ LANGUAGE plpgsql;

-- Get tree statistics for a user
CREATE OR REPLACE FUNCTION get_tree_stats(user_uuid UUID)
RETURNS JSONB AS $$
DECLARE
    stats JSONB;
BEGIN
    SELECT jsonb_build_object(
        'totalNodes', COUNT(*),
        'totalFolders', COUNT(*) FILTER (WHERE type = 'folder'),
        'totalTracks', COUNT(*) FILTER (WHERE type = 'track'),
        'maxDepth', COALESCE(MAX(depth), 0),
        'averageDepth', COALESCE(AVG(depth), 0),
        'rootNodes', COUNT(*) FILTER (WHERE parent_id IS NULL)
    ) INTO stats
    FROM tree_nodes
    WHERE user_id = user_uuid;
    
    RETURN stats;
END;
$$ LANGUAGE plpgsql;
-- Execute batch operations atomically
CREATE OR REPLACE FUNCTION execute_batch_operations(
    operations JSONB,
    user_uuid UUID
)
RETURNS VOID AS $
DECLARE
    op JSONB;
    op_type TEXT;
    node_data JSONB;
BEGIN
    -- Process each operation in the batch
    FOR op IN SELECT * FROM jsonb_array_elements(operations)
    LOOP
        op_type := op->>'type';
        node_data := op->'data';
        
        CASE op_type
            WHEN 'create' THEN
                INSERT INTO tree_nodes (
                    id, user_id, name, type, parent_id, created, modified,
                    code, is_multitrack, steps, active_step, metadata
                ) VALUES (
                    COALESCE(node_data->>'id', gen_random_uuid()::text),
                    user_uuid,
                    node_data->>'name',
                    node_data->>'type',
                    NULLIF(node_data->>'parentId', 'null'),
                    COALESCE(node_data->>'created', NOW()::text),
                    COALESCE(node_data->>'modified', NOW()::text),
                    node_data->>'code',
                    COALESCE((node_data->>'isMultitrack')::boolean, false),
                    node_data->'steps',
                    COALESCE((node_data->>'activeStep')::integer, 0),
                    COALESCE(node_data->'metadata', '{}'::jsonb)
                );
                
            WHEN 'update' THEN
                UPDATE tree_nodes SET
                    name = COALESCE(node_data->>'name', name),
                    parent_id = CASE 
                        WHEN node_data ? 'parentId' THEN NULLIF(node_data->>'parentId', 'null')
                        ELSE parent_id 
                    END,
                    code = COALESCE(node_data->>'code', code),
                    is_multitrack = COALESCE((node_data->>'isMultitrack')::boolean, is_multitrack),
                    steps = COALESCE(node_data->'steps', steps),
                    active_step = COALESCE((node_data->>'activeStep')::integer, active_step),
                    metadata = COALESCE(node_data->'metadata', metadata),
                    modified = NOW()::text
                WHERE id = op->>'nodeId' AND user_id = user_uuid;
                
            WHEN 'delete' THEN
                DELETE FROM tree_nodes 
                WHERE id = op->>'nodeId' AND user_id = user_uuid;
                
            WHEN 'move' THEN
                UPDATE tree_nodes SET
                    parent_id = NULLIF(node_data->>'newParentId', 'null'),
                    modified = NOW()::text
                WHERE id = op->>'nodeId' AND user_id = user_uuid;
        END CASE;
    END LOOP;
END;
$ LANGUAGE plpgsql;