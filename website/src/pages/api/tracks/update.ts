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

export const PUT: APIRoute = async ({ request }) => {
  try {
    const user = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);

    // Parse request body
    const body = await request.json();
    const { trackId, updates } = body;

    if (!trackId) {
      return new Response(JSON.stringify({ error: 'Track ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get the existing track to verify ownership and type
    const existingTrack = await treeManager.getNode(trackId);
    
    if (!existingTrack) {
      return new Response(JSON.stringify({ error: 'Track not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (existingTrack.type !== 'track') {
      return new Response(JSON.stringify({ error: 'Node is not a track' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update the track using TreeManager
    const updatedTrack = await treeManager.updateNode(trackId, {
      name: updates.name,
      code: updates.code,
      isMultitrack: updates.isMultitrack,
      steps: updates.steps,
      activeStep: updates.activeStep,
      parentId: updates.folder, // Map folder to parentId
      metadata: updates.metadata
    });

    // Transform to UI format
    const transformedTrack = {
      id: updatedTrack.id,
      name: updatedTrack.name,
      code: (updatedTrack as any).code || '',
      created: updatedTrack.created,
      modified: updatedTrack.modified,
      folder: updatedTrack.parentId,
      isMultitrack: (updatedTrack as any).isMultitrack || false,
      steps: (updatedTrack as any).steps || [],
      activeStep: (updatedTrack as any).activeStep || 0,
      path: await treeManager.getPath(updatedTrack.id)
    };

    return new Response(JSON.stringify({ track: transformedTrack }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /tracks/update error:', error);
    
    const status = error.message?.includes('Authentication') || error.message?.includes('token') ? 401 : 500;
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error' 
    }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};