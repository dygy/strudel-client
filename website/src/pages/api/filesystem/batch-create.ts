import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST /api/filesystem/batch-create - Create multiple nodes in a single transaction
export const POST: APIRoute = async ({ request }) => {
  try {
    console.log('API /filesystem/batch-create - Creating multiple nodes');

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

    // Parse request body
    const body = await request.json();
    const { nodes } = body;

    if (!Array.isArray(nodes) || nodes.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing or empty nodes array' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = new Date().toISOString();
    const nodesToInsert: any[] = [];

    // Validate and prepare nodes for insertion
    for (const node of nodes) {
      const { id, name, type, parentId, code, isMultitrack, steps, activeStep } = node;

      if (!id || !name || !type) {
        return new Response(JSON.stringify({ 
          error: `Invalid node: missing required fields (id, name, type) in node: ${JSON.stringify(node)}` 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (!['folder', 'track'].includes(type)) {
        return new Response(JSON.stringify({ 
          error: `Invalid node type "${type}". Must be "folder" or "track"` 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Prepare node data
      const nodeData: any = {
        id,
        user_id: user.id,
        name,
        type,
        parent_id: parentId || null,
        created: now,
        modified: now
      };

      // Add track-specific fields
      if (type === 'track') {
        nodeData.code = code || '';
        nodeData.is_multitrack = isMultitrack || false;
        nodeData.steps = steps || null;
        nodeData.active_step = activeStep || 0;
      }

      nodesToInsert.push(nodeData);
    }

    console.log(`Batch creating ${nodesToInsert.length} nodes`);

    // Insert all nodes in a single batch
    const { data: createdNodes, error } = await supabase
      .from('file_system_nodes')
      .insert(nodesToInsert)
      .select();

    if (error) {
      console.error('Error batch creating nodes:', error);
      return new Response(JSON.stringify({ error: 'Failed to create nodes' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const foldersCreated = createdNodes?.filter(n => n.type === 'folder').length || 0;
    const tracksCreated = createdNodes?.filter(n => n.type === 'track').length || 0;

    console.log(`Batch creation completed: ${foldersCreated} folders, ${tracksCreated} tracks`);

    return new Response(JSON.stringify({
      success: true,
      results: {
        totalCreated: createdNodes?.length || 0,
        foldersCreated,
        tracksCreated,
        nodes: createdNodes
      }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /filesystem/batch-create - Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};