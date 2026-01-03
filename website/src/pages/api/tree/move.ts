/**
 * Tree-Based File System API: Move Operations
 * Handles moving nodes within the tree hierarchy
 */

import type { APIRoute } from 'astro';
import { TreeManager } from '../../../lib/TreeManager';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY
);

async function getAuthenticatedUser(request: Request) {
  const cookies = request.headers.get('cookie') || '';
  
  if (!cookies) {
    throw new Error('No authentication cookies found');
  }

  // Parse cookies to get Supabase session tokens
  const cookieMap = new Map();
  cookies.split(';').forEach(cookie => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) {
      cookieMap.set(key, decodeURIComponent(value));
    }
  });

  // Look for the specific Supabase access token cookie set by auth callback
  const accessToken = cookieMap.get('sb-access-token');

  if (!accessToken) {
    throw new Error('No access token found in cookies');
  }

  // Verify the access token using anon client (same as auth/user.ts)
  const supabaseAnon = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY
  );
  const { data: { user }, error } = await supabaseAnon.auth.getUser(accessToken);
  
  if (error || !user) {
    throw new Error('Invalid session');
  }
  
  return user;
}

function createTreeManager(userId: string): TreeManager {
  return new TreeManager({
    userId,
    supabase
  });
}

// POST /api/tree/move - Move node to new parent
export const POST: APIRoute = async ({ request }) => {
  try {
    const user = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);
    
    const body = await request.json();
    const { nodeId, newParentId } = body;
    
    if (!nodeId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Node ID is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validate the move operation
    const node = await treeManager.getNode(nodeId);
    if (!node) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Node not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // If newParentId is provided, validate it exists and is a folder
    if (newParentId) {
      const newParent = await treeManager.getNode(newParentId);
      if (!newParent) {
        return new Response(JSON.stringify({
          success: false,
          error: 'New parent not found'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      if (newParent.type !== 'folder') {
        return new Response(JSON.stringify({
          success: false,
          error: 'New parent must be a folder'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Perform the move
    await treeManager.moveNode(nodeId, newParentId || null);
    
    // Get updated node with new path
    const updatedNode = await treeManager.getNode(nodeId);
    const nodeWithPath = {
      ...updatedNode,
      path: await treeManager.getPath(nodeId)
    };
    
    return new Response(JSON.stringify({
      success: true,
      node: nodeWithPath,
      message: 'Node moved successfully'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Tree move error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to move node'
    }), {
      status: error.message?.includes('authorization') ? 401 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};