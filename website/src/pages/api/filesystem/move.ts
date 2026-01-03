import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST /api/filesystem/move - Move a node to a new parent
export const POST: APIRoute = async ({ request }) => {
  try {
    console.log('API /filesystem/move - Moving node');

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
    const { nodeId, newParentId } = body;

    if (!nodeId) {
      return new Response(JSON.stringify({ error: 'Missing required field: nodeId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate that we can't move a node to itself
    if (nodeId === newParentId) {
      return new Response(JSON.stringify({ error: 'Cannot move node to itself' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // If newParentId is provided, validate that it exists and is a folder
    if (newParentId) {
      const { data: parentNode, error: parentError } = await supabase
        .from('file_system_nodes')
        .select('type')
        .eq('id', newParentId)
        .eq('user_id', user.id)
        .single();

      if (parentError || !parentNode) {
        return new Response(JSON.stringify({ error: 'Parent node not found or access denied' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (parentNode.type !== 'folder') {
        return new Response(JSON.stringify({ error: 'Parent must be a folder' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // TODO: Add cycle detection for more complex validation
    // For now, the database foreign key constraint will prevent basic cycles

    // Update the node's parent
    const { data: updatedNode, error: updateError } = await supabase
      .from('file_system_nodes')
      .update({
        parent_id: newParentId || null,
        modified: new Date().toISOString()
      })
      .eq('id', nodeId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error('Error moving node:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to move node' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!updatedNode) {
      return new Response(JSON.stringify({ error: 'Node not found or access denied' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('Node moved successfully:', updatedNode.id, 'to parent:', newParentId || 'root');

    return new Response(JSON.stringify({
      success: true,
      node: updatedNode
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /filesystem/move - Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};