import type { APIRoute } from 'astro';
import { TreeManager } from '../../../lib/TreeManager';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY
);

async function getAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    // Try to get user from cookie-based auth
    const baseUrl = new URL(request.url).origin;
    const authResponse = await fetch(`${baseUrl}/api/auth/user`, {
      headers: { 'Cookie': request.headers.get('cookie') || '' }
    });

    if (!authResponse.ok) {
      throw new Error('Authentication failed');
    }

    const { user } = await authResponse.json();
    if (!user) {
      throw new Error('User not authenticated');
    }
    
    return user;
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Invalid token');
  }
  
  return user;
}

function createTreeManager(userId: string): TreeManager {
  return new TreeManager({
    userId,
    supabase
  });
}

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const user = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);

    // Parse request body
    const body = await request.json();
    const { trackId } = body;

    if (!trackId) {
      return new Response(JSON.stringify({ error: 'Track ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify the node exists and is a track
    const track = await treeManager.getNode(trackId);
    if (!track) {
      return new Response(JSON.stringify({ error: 'Track not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (track.type !== 'track') {
      return new Response(JSON.stringify({ error: 'Node is not a track' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete the track using TreeManager
    await treeManager.deleteNode(trackId, false); // Don't cascade for tracks

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /tracks/delete error:', error);
    
    const status = error.message?.includes('Authentication') || error.message?.includes('token') ? 401 : 500;
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error' 
    }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};