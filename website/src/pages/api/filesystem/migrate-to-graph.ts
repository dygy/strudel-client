import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const POST: APIRoute = async ({ request }) => {
  try {
    console.log('API /filesystem/migrate-to-graph - Starting migration to graph-based file system');

    // Get user from session
    const cookies = request.headers.get('cookie') || '';
    
    // Parse cookies manually
    const cookieObj: Record<string, string> = {};
    if (cookies) {
      cookies.split(';').forEach(cookie => {
        const [key, value] = cookie.trim().split('=');
        if (key && value) {
          cookieObj[key] = value;
        }
      });
    }

    // Find access token from cookies
    let accessToken = '';
    for (const [key, value] of Object.entries(cookieObj)) {
      if (key === 'sb-access-token' || key.includes('access-token')) {
        accessToken = value;
        break;
      }
    }

    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get user from access token
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /filesystem/migrate-to-graph - User verified:', user.id);

    // Step 1: Load existing data from legacy tables
    const { data: existingTracks, error: tracksError } = await supabase
      .from('tracks')
      .select('*')
      .eq('user_id', user.id);

    const { data: existingFolders, error: foldersError } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', user.id);

    if (tracksError || foldersError) {
      console.error('Error loading existing data:', { tracksError, foldersError });
      return new Response(JSON.stringify({ error: 'Failed to load existing data' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('Loaded existing data:', {
      tracks: existingTracks?.length || 0,
      folders: existingFolders?.length || 0
    });

    // Step 2: Create graph nodes from existing data
    const nodesToCreate: any[] = [];
    const pathToNodeId: Record<string, string> = {};

    // Create folder nodes first (they need to exist before tracks can reference them)
    if (existingFolders) {
      for (const folder of existingFolders) {
        const nodeId = nanoid();
        pathToNodeId[folder.path] = nodeId;
        
        // Find parent node ID if this folder has a parent
        let parentId = null;
        if (folder.parent && pathToNodeId[folder.parent]) {
          parentId = pathToNodeId[folder.parent];
        }

        nodesToCreate.push({
          id: nodeId,
          user_id: user.id,
          name: folder.name,
          type: 'folder',
          parent_id: parentId,
          created: folder.created,
          modified: folder.created, // folders don't have modified field
          code: null,
          is_multitrack: false,
          steps: null,
          active_step: 0
        });
      }
    }

    // Create track nodes
    if (existingTracks) {
      for (const track of existingTracks) {
        const nodeId = nanoid();
        
        // Find parent node ID if this track is in a folder
        let parentId = null;
        if (track.folder && pathToNodeId[track.folder]) {
          parentId = pathToNodeId[track.folder];
        }

        nodesToCreate.push({
          id: nodeId,
          user_id: user.id,
          name: track.name,
          type: 'track',
          parent_id: parentId,
          created: track.created,
          modified: track.modified,
          code: track.code,
          is_multitrack: track.is_multitrack || false,
          steps: track.steps,
          active_step: track.active_step || 0
        });
      }
    }

    console.log('Created graph nodes:', nodesToCreate.length);

    // Step 3: Insert all nodes into the graph table
    if (nodesToCreate.length > 0) {
      const { data: createdNodes, error: insertError } = await supabase
        .from('file_system_nodes')
        .insert(nodesToCreate)
        .select();

      if (insertError) {
        console.error('Error inserting graph nodes:', insertError);
        return new Response(JSON.stringify({ error: 'Failed to create graph nodes' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      console.log('Successfully created graph nodes:', createdNodes?.length || 0);
    }

    // Step 4: Verify the migration by loading the graph structure
    const { data: graphNodes, error: graphError } = await supabase
      .from('file_system_nodes')
      .select('*')
      .eq('user_id', user.id)
      .order('created', { ascending: true });

    if (graphError) {
      console.error('Error verifying graph structure:', graphError);
      return new Response(JSON.stringify({ error: 'Failed to verify migration' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Build the graph structure for verification
    const nodeMap = new Map();
    const rootNodes: any[] = [];

    // First pass: create all nodes
    graphNodes?.forEach(node => {
      nodeMap.set(node.id, {
        ...node,
        children: []
      });
    });

    // Second pass: build parent-child relationships
    graphNodes?.forEach(node => {
      if (node.parent_id && nodeMap.has(node.parent_id)) {
        nodeMap.get(node.parent_id).children.push(nodeMap.get(node.id));
      } else {
        rootNodes.push(nodeMap.get(node.id));
      }
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Successfully migrated to graph-based file system',
      results: {
        nodesCreated: nodesToCreate.length,
        foldersCreated: nodesToCreate.filter(n => n.type === 'folder').length,
        tracksCreated: nodesToCreate.filter(n => n.type === 'track').length,
        graphStructure: rootNodes.map(node => ({
          id: node.id,
          name: node.name,
          type: node.type,
          childrenCount: node.children.length
        }))
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /filesystem/migrate-to-graph - Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};