/**
 * Tree-Based File System API: Statistics and Analytics
 * Provides tree statistics and node analytics
 */

import type { APIRoute } from 'astro';
import { TreeManager } from '@src/lib/TreeManager.ts';
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

  // Look for Supabase auth cookies
  let accessToken = null;

  // Try different cookie patterns that Supabase might use
  for (const [key, value] of cookieMap) {
    // Access token should be a JWT (starts with eyJ and has dots)
    if ((key.includes('access') || key.includes('auth-token') || key.startsWith('sb-access')) && value.includes('.')) {
      accessToken = value;
      break;
    }
  }

  if (!accessToken) {
    throw new Error('No access token found in cookies');
  }

  // Verify the access token
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  
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

// GET /api/tree/stats - Get tree statistics
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const user = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);

    const nodeId = url.searchParams.get('nodeId');

    if (nodeId) {
      // Get statistics for specific node
      const nodeStats = await treeManager.getNodeStats(nodeId);
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

      return new Response(JSON.stringify({
        success: true,
        nodeStats: {
          ...nodeStats,
          path: await treeManager.getPath(nodeId)
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      // Get overall tree statistics
      const treeStats = await treeManager.getTreeStats();

      return new Response(JSON.stringify({
        success: true,
        treeStats
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('Tree stats error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to get statistics'
    }), {
      status: error.message?.includes('authorization') ? 401 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
