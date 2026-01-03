/**
 * Tree-Based File System API: Search Operations
 * Handles advanced search and query operations
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

// GET /api/tree/search - Search nodes with advanced filters
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const user = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);
    
    // Parse search parameters
    const term = url.searchParams.get('term');
    const type = url.searchParams.get('type') as 'folder' | 'track' | null;
    const parentId = url.searchParams.get('parentId');
    const tags = url.searchParams.get('tags')?.split(',').filter(Boolean);
    const pattern = url.searchParams.get('pattern');
    const maxDepth = url.searchParams.get('maxDepth');
    const includeMetadata = url.searchParams.get('includeMetadata') === 'true';
    
    const searchQuery = {
      term: term || undefined,
      type: type || undefined,
      parentId: parentId === 'null' ? null : parentId || undefined,
      tags: tags || undefined,
      pattern: pattern || undefined,
      maxDepth: maxDepth ? parseInt(maxDepth) : undefined,
      includeMetadata
    };
    
    const searchResult = await treeManager.searchNodes(searchQuery);
    
    // Add computed paths to results
    const nodesWithPaths = await Promise.all(
      searchResult.nodes.map(async (node) => ({
        ...node,
        path: await treeManager.getPath(node.id)
      }))
    );
    
    return new Response(JSON.stringify({
      success: true,
      result: {
        ...searchResult,
        nodes: nodesWithPaths
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Tree search error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Search failed'
    }), {
      status: error.message?.includes('authorization') ? 401 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// POST /api/tree/search - Advanced search with complex queries
export const POST: APIRoute = async ({ request }) => {
  try {
    const user = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);
    
    const body = await request.json();
    const { query, options = {} } = body;
    
    if (!query) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Search query is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    let results;
    
    if (options.searchType === 'path') {
      // Search by path
      const node = await treeManager.findByPath(query);
      results = {
        nodes: node ? [node] : [],
        totalCount: node ? 1 : 0,
        searchTime: 0,
        query: { term: query }
      };
    } else if (options.searchType === 'pattern') {
      // Search by regex pattern
      const nodes = await treeManager.findByPattern(query);
      results = {
        nodes,
        totalCount: nodes.length,
        searchTime: 0,
        query: { pattern: query }
      };
    } else {
      // Standard search
      results = await treeManager.searchNodes(query);
    }
    
    // Add computed paths to results
    const nodesWithPaths = await Promise.all(
      results.nodes.map(async (node) => ({
        ...node,
        path: await treeManager.getPath(node.id)
      }))
    );
    
    return new Response(JSON.stringify({
      success: true,
      result: {
        ...results,
        nodes: nodesWithPaths
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Tree search POST error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Search failed'
    }), {
      status: error.message?.includes('authorization') ? 401 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};