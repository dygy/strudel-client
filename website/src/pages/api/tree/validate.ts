import type { APIRoute } from 'astro';
import { TreeManager } from '../../../lib/TreeManager';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { userClient } from '../_userClient';

export const prerender = false;

/**
 * Create TreeManager instance for user
 */
function createTreeManager(userId: string, accessToken: string) {
  // TreeManager takes a config object; passing the client positionally left config.supabase
  // undefined, so it fell back to process.env (absent on Workers) and every call was a 500.
  // As the user, so RLS applies (the service-role key belongs to /api/admin/* only).
  return new TreeManager({ userId, supabase: userClient(accessToken) });
}

// GET /api/tree/validate - Validate tree integrity
export const GET: APIRoute = async ({ request }) => {
  try {
    const { user, accessToken } = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id, accessToken);

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
