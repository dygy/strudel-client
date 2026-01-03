import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { TreeDataTransformer } from '../../../lib/TreeDataTransformer';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    // Try to get access token from Astro cookies first (direct API calls)
    let accessToken = cookies.get('sb-access-token')?.value;
    
    // If not found, try parsing from request headers (SSR calls)
    if (!accessToken) {
      const cookieHeader = request.headers.get('cookie') || '';
      const cookieMap = new Map();
      cookieHeader.split(';').forEach(cookie => {
        const [key, value] = cookie.trim().split('=');
        if (key && value) {
          cookieMap.set(key, decodeURIComponent(value));
        }
      });
      accessToken = cookieMap.get('sb-access-token');
    }
    
    if (!accessToken) {
      console.log('API tracks/list - No access token found');
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create Supabase client with service role key for server-side operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user token
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !user) {
      console.log('API tracks/list - User verification failed:', userError?.message || 'No user returned');
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log('API tracks/list - User verified:', user.id);
    
    // Use direct Supabase queries to get data from old tables (like folders/list does)
    // TODO: Switch to TreeManager once data is migrated to tree_nodes table
    
    // Get tracks from old tracks table
    const { data: tracksData, error: tracksError } = await supabase
      .from('tracks')
      .select('*')
      .eq('user_id', user.id)
      .order('modified', { ascending: false });

    if (tracksError) {
      console.error('Error fetching tracks:', tracksError);
      return new Response(JSON.stringify({ error: tracksError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get folders from old folders table  
    const { data: foldersData, error: foldersError } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', user.id)
      .order('created', { ascending: true });

    if (foldersError) {
      console.error('Error fetching folders:', foldersError);
      return new Response(JSON.stringify({ error: foldersError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API tracks/list - Raw data:', {
      tracksCount: tracksData?.length || 0,
      foldersCount: foldersData?.length || 0,
      allFolders: foldersData?.map(f => ({ id: f.id, name: f.name, path: f.path, parent: f.parent }))
    });

    // Convert to expected format for TreeDataTransformer
    const tracks = (tracksData || []).map(track => ({
      id: track.id,
      name: track.name,
      code: track.code || '',
      created: track.created,
      modified: track.modified,
      folder: track.folder,
      isMultitrack: track.is_multitrack || false,
      steps: track.steps || [],
      activeStep: track.active_step || 0,
      user_id: track.user_id,
    }));

    const folders = (foldersData || []).map(folder => ({
      id: folder.id,
      name: folder.name,
      path: folder.path,
      parent: folder.parent,
      created: folder.created,
      user_id: folder.user_id,
    }));

    // Transform flat data to hierarchical tree structure
    const tree = TreeDataTransformer.transformToTree(tracks, folders);
    
    console.log('API tracks/list - Transformed tree:', {
      rootChildren: tree.root.children?.length || 0,
      totalTracks: tracks.length,
      totalFolders: folders.length,
      allChildren: tree.root.children?.map(c => ({ 
        id: c.id, 
        name: c.name, 
        type: c.type, 
        path: c.path,
        childrenCount: c.children?.length || 0,
        childrenNames: c.children?.map(child => child.name) || []
      }))
    });
    
    // Return hierarchical tree structure: { id: "root", children: [...] }
    return new Response(JSON.stringify(tree.root), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

  } catch (error) {
    console.error('API tracks/list error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};