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

export const POST: APIRoute = async ({ request }) => {
  try {
    const user = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);

    // Parse request body
    const body = await request.json();
    const { name, code = '', folder, isMultitrack, steps, activeStep } = body;

    if (!name) {
      return new Response(JSON.stringify({ error: 'Track name is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate folder exists if provided
    if (folder) {
      const parentFolder = await treeManager.getNode(folder);
      if (!parentFolder) {
        return new Response(JSON.stringify({ error: 'Parent folder not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (parentFolder.type !== 'folder') {
        return new Response(JSON.stringify({ error: 'Parent must be a folder' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Create the track using TreeManager
    const newTrack = await treeManager.createNode({
      name,
      type: 'track',
      parentId: folder || null,
      code,
      isMultitrack: isMultitrack || false,
      steps: steps || [],
      activeStep: activeStep || 0
    });

    // Transform to UI format
    const transformedTrack = {
      id: newTrack.id,
      name: newTrack.name,
      code: (newTrack as any).code || '',
      created: newTrack.created,
      modified: newTrack.modified,
      folder: newTrack.parentId,
      isMultitrack: (newTrack as any).isMultitrack || false,
      steps: (newTrack as any).steps || [],
      activeStep: (newTrack as any).activeStep || 0,
      path: await treeManager.getPath(newTrack.id)
    };

    return new Response(JSON.stringify({ track: transformedTrack }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /tracks/create error:', error);
    
    const status = error.message?.includes('Authentication') || error.message?.includes('token') ? 401 : 500;
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error' 
    }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};