import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST /api/filesystem/create - Create a new node (folder or track)
export const POST: APIRoute = async ({ request }) => {
  try {
    console.log('API /filesystem/create - Creating new node');

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
    const { id, name, type, parentId, code, isMultitrack, steps, activeStep } = body;

    if (!id || !name || !type) {
      return new Response(JSON.stringify({ error: 'Missing required fields: id, name, type' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!['folder', 'track'].includes(type)) {
      return new Response(JSON.stringify({ error: 'Invalid type. Must be "folder" or "track"' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = new Date().toISOString();

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

    // Insert the node
    const { data: newNode, error } = await supabase
      .from('file_system_nodes')
      .insert(nodeData)
      .select()
      .single();

    if (error) {
      console.error('Error creating node:', error);
      return new Response(JSON.stringify({ error: 'Failed to create node' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('Node created successfully:', newNode.id, newNode.name);

    return new Response(JSON.stringify({
      success: true,
      node: newNode
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /filesystem/create - Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};