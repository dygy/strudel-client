/**
 * Tree-Based File System API: Statistics and Analytics
 * Provides tree statistics and node analytics
 */

import type { APIRoute } from 'astro';
import { TreeManager } from '@src/lib/TreeManager.ts';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '../../../lib/server-env';
import { getAuthenticatedUser, AuthError } from '../_auth';

export const prerender = false;

// Cloudflare supplies vars and secrets per request rather than at build
// time, so the client is created on first use instead of at module scope.
let supabaseClient: ReturnType<typeof createClient> | undefined;
function getSupabase() {
  if (!supabaseClient) {
    const { supabaseUrl, supabaseAnonKey: supabaseKey } = serverEnv();
    supabaseClient = createClient(supabaseUrl, supabaseKey);
  }
  return supabaseClient;
}

function createTreeManager(userId: string): TreeManager {
  return new TreeManager({
    userId,
    supabase: getSupabase(),
  });
}

// GET /api/tree/stats - Get tree statistics
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const { user } = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);

    const nodeId = url.searchParams.get('nodeId');

    if (nodeId) {
      // Get statistics for specific node
      const nodeStats = await treeManager.getNodeStats(nodeId);
      const node = await treeManager.getNode(nodeId);

      if (!node) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Node not found',
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          nodeStats: {
            ...nodeStats,
            path: await treeManager.getPath(nodeId),
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } else {
      // Get overall tree statistics
      const treeStats = await treeManager.getTreeStats();

      return new Response(
        JSON.stringify({
          success: true,
          treeStats,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  } catch (error) {
    console.error('Tree stats error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to get statistics',
      }),
      {
        status: error instanceof AuthError ? 401 : 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
