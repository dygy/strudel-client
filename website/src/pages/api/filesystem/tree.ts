/**
 * API endpoint that returns hierarchical tree structure
 * Returns: { id: "root", children: [{ name: "old", type: "folder", children: [...] }] }
 */

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { TreeDataTransformer } from '../../../lib/TreeDataTransformer';
import { serverEnv } from '../../../lib/server-env';
import { getAuthenticatedUser, AuthError } from '../_auth';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    // Bearer header or sb-access-token cookie. Never setSession/refresh here: the browser client
    // is the only refresh owner, and an expired token answers 401 so the client refreshes and retries.
    let auth: Awaited<ReturnType<typeof getAuthenticatedUser>>;
    try {
      auth = await getAuthenticatedUser(request);
    } catch (authError: unknown) {
      if (!(authError instanceof AuthError)) throw authError;
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { user, accessToken } = auth;

    // One client per request (a module-level client would carry one user's session into the
    // next request). The caller's token goes in the header so RLS applies as that user.
    const { supabaseUrl, supabaseAnonKey } = serverEnv();
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    // Fetch tracks and folders
    const [tracksResult, foldersResult] = await Promise.all([
      supabase.from('tracks').select('*').eq('user_id', user.id).order('created', { ascending: true }),

      supabase.from('folders').select('*').eq('user_id', user.id).order('created', { ascending: true }),
    ]);

    if (tracksResult.error) {
      console.error('Error fetching tracks:', tracksResult.error);
      return new Response(JSON.stringify({ error: 'Failed to fetch tracks' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (foldersResult.error) {
      console.error('Error fetching folders:', foldersResult.error);
      return new Response(JSON.stringify({ error: 'Failed to fetch folders' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Transform flat data to hierarchical tree
    const tracks = tracksResult.data || [];
    const folders = foldersResult.data || [];

    const tree = TreeDataTransformer.transformToTree(tracks, folders);

    // Return the tree structure you want
    return new Response(JSON.stringify(tree.root), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Tree API error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
