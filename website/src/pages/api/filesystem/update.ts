import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// PUT /api/filesystem/update - Update an existing node
export const PUT: APIRoute = async ({ request }) => {
  try {
    console.log('API /filesystem/update - Updating node');

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
    const { id, name, code, isMultitrack, steps, activeStep } = body;

    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing required field: id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Prepare update data
    const updateData: any = {
      modified: new Date().toISOString()
    };

    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code;
    if (isMultitrack !== undefined) updateData.is_multitrack = isMultitrack;
    if (steps !== undefined) updateData.steps = steps;
    if (activeStep !== undefined) updateData.active_step = activeStep;

    // Update the node
    const { data: updatedNode, error } = await supabase
      .from('file_system_nodes')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating node:', error);
      return new Response(JSON.stringify({ error: 'Failed to update node' }), {
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

    console.log('Node updated successfully:', updatedNode.id, updatedNode.name);

    return new Response(JSON.stringify({
      success: true,
      node: updatedNode
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /filesystem/update - Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};