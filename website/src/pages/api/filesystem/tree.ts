/**
 * API endpoint that returns hierarchical tree structure
 * Returns: { id: "root", children: [{ name: "old", type: "folder", children: [...] }] }
 */

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { TreeDataTransformer } from '../../../lib/TreeDataTransformer';

const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY
);

export const GET: APIRoute = async ({ request, cookies }) => {
  try {
    // Get user session
    const sessionCookie = cookies.get('sb-access-token');
    if (!sessionCookie) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Set auth header
    supabase.auth.setSession({
      access_token: sessionCookie.value,
      refresh_token: cookies.get('sb-refresh-token')?.value || ''
    });

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch tracks and folders
    const [tracksResult, foldersResult] = await Promise.all([
      supabase
        .from('tracks')
        .select('*')
        .eq('user_id', user.id)
        .order('created', { ascending: true }),
      
      supabase
        .from('folders')
        .select('*')
        .eq('user_id', user.id)
        .order('created', { ascending: true })
    ]);

    if (tracksResult.error) {
      console.error('Error fetching tracks:', tracksResult.error);
      return new Response(JSON.stringify({ error: 'Failed to fetch tracks' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (foldersResult.error) {
      console.error('Error fetching folders:', foldersResult.error);
      return new Response(JSON.stringify({ error: 'Failed to fetch folders' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
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
        'Cache-Control': 'no-cache'
      }
    });

  } catch (error) {
    console.error('Tree API error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};