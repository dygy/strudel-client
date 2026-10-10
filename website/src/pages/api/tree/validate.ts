import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { TreeManager } from '../../../lib/TreeManager';
import { serverEnv } from '../../../lib/server-env';
import { getAuthenticatedUser, AuthError } from '../_auth';

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

/**
 * Create TreeManager instance for user
 */
function createTreeManager(userId: string) {
  // TreeManager takes a config object; passing the client positionally left config.supabase
  // undefined, so it fell back to process.env (absent on Workers) and every call was a 500.
  return new TreeManager({ userId, supabase: getSupabase() });
}

// GET /api/tree/validate - Validate tree integrity
export const GET: APIRoute = async ({ request }) => {
  try {
    const { user } = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);

    const validation = await treeManager.validateTree();
    const cycles = await treeManager.detectCycles();
    const orphans = await treeManager.findOrphans();
    // getPath is async: awaiting it here, otherwise every orphan's path serialises as {}.
    const orphansWithPaths = await Promise.all(
      orphans.map(async (node) => ({ ...node, path: await treeManager.getPath(node.id) })),
    );

    return new Response(
      JSON.stringify({
        success: true,
        validation: {
          ...validation,
          cycles,
          orphans: orphansWithPaths,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Tree validation error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Validation failed',
      }),
      {
        status: error instanceof AuthError ? 401 : 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
