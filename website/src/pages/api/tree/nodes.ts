/**
 * Tree-Based File System API: Node Operations
 * Handles CRUD operations for tree nodes using TreeManager
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

// GET /api/tree/nodes - List nodes (with optional parent filter)
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const user = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);
    
    const parentId = url.searchParams.get('parent');
    const search = url.searchParams.get('search');
    const type = url.searchParams.get('type') as 'folder' | 'track' | null;
    const maxDepth = url.searchParams.get('maxDepth');
    
    let nodes;
    
    if (search) {
      // Search nodes
      const searchResult = await treeManager.searchNodes({
        term: search,
        type: type || undefined,
        maxDepth: maxDepth ? parseInt(maxDepth) : undefined
      });
      nodes = searchResult.nodes;
    } else if (parentId !== null) {
      // Get children of specific parent (or root if parentId is 'null')
      const actualParentId = parentId === 'null' ? null : parentId;
      nodes = await treeManager.getChildren(actualParentId);
    } else {
      // Get all nodes
      nodes = await treeManager.getAllNodes();
    }
    
    // Add computed path for each node
    const nodesWithPaths = await Promise.all(
      nodes.map(async (node) => ({
        ...node,
        path: await treeManager.getPath(node.id)
      }))
    );
    
    return new Response(JSON.stringify({
      success: true,
      nodes: nodesWithPaths
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Tree nodes GET error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to get nodes'
    }), {
      status: error.message?.includes('authorization') ? 401 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// POST /api/tree/nodes - Create new node
export const POST: APIRoute = async ({ request }) => {
  try {
    const user = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);
    
    const body = await request.json();
    const { name, type, parentId, code, isMultitrack, steps, activeStep, metadata } = body;
    
    if (!name || !type) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Name and type are required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (!['folder', 'track'].includes(type)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Type must be folder or track'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const node = await treeManager.createNode({
      name,
      type,
      parentId: parentId || null,
      code,
      isMultitrack,
      steps,
      activeStep,
      metadata
    });
    
    // Add computed path
    const nodeWithPath = {
      ...node,
      path: await treeManager.getPath(node.id)
    };
    
    return new Response(JSON.stringify({
      success: true,
      node: nodeWithPath
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Tree nodes POST error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to create node'
    }), {
      status: error.message?.includes('authorization') ? 401 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// PUT /api/tree/nodes - Update node
export const PUT: APIRoute = async ({ request }) => {
  try {
    const user = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);
    
    const body = await request.json();
    const { nodeId, ...updates } = body;
    
    if (!nodeId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Node ID is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const node = await treeManager.updateNode(nodeId, updates);
    
    // Add computed path
    const nodeWithPath = {
      ...node,
      path: await treeManager.getPath(node.id)
    };
    
    return new Response(JSON.stringify({
      success: true,
      node: nodeWithPath
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Tree nodes PUT error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to update node'
    }), {
      status: error.message?.includes('authorization') ? 401 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// DELETE /api/tree/nodes - Delete node
export const DELETE: APIRoute = async ({ request }) => {
  try {
    const user = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);
    
    const body = await request.json();
    const { nodeId, cascade = true } = body;
    
    if (!nodeId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Node ID is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    await treeManager.deleteNode(nodeId, cascade);
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Node deleted successfully'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Tree nodes DELETE error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to delete node'
    }), {
      status: error.message?.includes('authorization') ? 401 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};