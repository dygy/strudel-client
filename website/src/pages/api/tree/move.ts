/**
 * Tree-Based File System API: Move Operations
 * Handles moving nodes within the tree hierarchy
 */

import type { APIRoute } from 'astro';
import { TreeManager } from '../../../lib/TreeManager';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '../../../lib/server-env';
import { readJsonObject, invalidDataResponse } from '../../../lib/apiBody';
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

// POST /api/tree/move - Move node to new parent
export const POST: APIRoute = async ({ request }) => {
  try {
    const { user } = await getAuthenticatedUser(request);
    const treeManager = createTreeManager(user.id);

    // Unparseable or non-object bodies are refused with 400, not a 500.
    const body = await readJsonObject(request);
    if (!body) {
      return invalidDataResponse();
    }
    const { nodeId, newParentId } = body;

    if (!nodeId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Node ID is required',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Validate the move operation
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

    // If newParentId is provided, validate it exists and is a folder
    if (newParentId) {
      const newParent = await treeManager.getNode(newParentId);
      if (!newParent) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'New parent not found',
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (newParent.type !== 'folder') {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'New parent must be a folder',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
    }

    // Perform the move
    await treeManager.moveNode(nodeId, newParentId || null);

    // Get updated node with new path
    const updatedNode = await treeManager.getNode(nodeId);
    const nodeWithPath = {
      ...updatedNode,
      path: await treeManager.getPath(nodeId),
    };

    return new Response(
      JSON.stringify({
        success: true,
        node: nodeWithPath,
        message: 'Node moved successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Tree move error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to move node',
      }),
      {
        status: error instanceof AuthError ? 401 : 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
