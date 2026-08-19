import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '../../../lib/server-env';

export const prerender = false;

// Cloudflare supplies vars and secrets per request rather than at build
// time, so the client is created on first use instead of at module scope.
let supabaseClient: ReturnType<typeof createClient> | undefined;
function getSupabase() {
  if (!supabaseClient) {
    const { supabaseUrl, supabaseServiceKey: supabaseKey } = serverEnv();
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables');
    }
    supabaseClient = createClient(supabaseUrl, supabaseKey);
  }
  return supabaseClient;
}

// GET /api/filesystem/nodes - Get all nodes for user (returns graph structure)
export const GET: APIRoute = async ({ request }) => {
  try {
    console.log('API /filesystem/nodes - Getting graph structure');

    // Get user from session
    const cookies = request.headers.get('cookie') || '';

    // Parse cookies manually
    const cookieObj: Record<string, string> = {};
    if (cookies) {
      cookies.split(';').forEach((cookie) => {
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
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get user from access token
    const {
      data: { user },
      error: userError,
    } = await getSupabase().auth.getUser(accessToken);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Load all nodes for the user
    const { data: nodes, error } = await getSupabase()
      .from('file_system_nodes')
      .select('*')
      .eq('user_id', user.id)
      .order('created', { ascending: true });

    if (error) {
      console.error('Error loading nodes:', error);
      return new Response(JSON.stringify({ error: 'Failed to load nodes' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build the graph structure
    const nodeMap = new Map();
    const rootNodes: any[] = [];

    // First pass: create all nodes with children arrays
    nodes?.forEach((node) => {
      nodeMap.set(node.id, {
        ...node,
        children: [],
      });
    });

    // Second pass: build parent-child relationships
    nodes?.forEach((node) => {
      const nodeWithChildren = nodeMap.get(node.id);
      if (node.parent_id && nodeMap.has(node.parent_id)) {
        nodeMap.get(node.parent_id).children.push(nodeWithChildren);
      } else {
        rootNodes.push(nodeWithChildren);
      }
    });

    console.log('Built graph structure:', {
      totalNodes: nodes?.length || 0,
      rootNodes: rootNodes.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        nodes: rootNodes,
        totalNodes: nodes?.length || 0,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('API /filesystem/nodes - Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
