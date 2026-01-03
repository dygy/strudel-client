import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const POST: APIRoute = async ({ request }) => {
  try {
    console.log('API /library/batch-import - Starting batch import');

    // Get user from session
    const cookies = request.headers.get('cookie') || '';
    console.log('API /library/batch-import - Cookies received:', cookies ? 'present' : 'none');

    // Parse cookies manually
    const cookieObj: Record<string, string> = {};
    if (cookies) {
      cookies.split(';').forEach(cookie => {
        const [key, value] = cookie.trim().split('=');
        if (key && value) {
          cookieObj[key] = value;
        }
      });
    }

    // Find access token from cookies
    let accessToken = '';
    for (const [key, value] of Object.entries(cookieObj)) {
      if (key === 'sb-access-token' || key.includes('access-token')) {
        accessToken = value;
        console.log(`API /library/batch-import - Found access token in: ${key}`);
        break;
      }
    }

    if (!accessToken) {
      console.log('API /library/batch-import - No access token found');
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /library/batch-import - Attempting to verify access token...');

    // Get user from access token
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);

    if (userError || !user) {
      console.log('API /library/batch-import - User verification failed:', userError?.message);
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /library/batch-import - User verified:', user.id);

    // Parse request body
    const body = await request.json();
    const { tracks = [], folders = [] } = body;

    console.log('API /library/batch-import - Received data:', {
      tracksCount: tracks.length,
      foldersCount: folders.length
    });

    // Validate input
    if (!Array.isArray(tracks) || !Array.isArray(folders)) {
      return new Response(JSON.stringify({ error: 'Invalid data format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Start a transaction-like operation
    const results = {
      tracksCreated: 0,
      foldersCreated: 0,
      errors: []
    };

    try {
      // Create a mapping from old folder paths to new UUIDs
      const folderPathToUuidMap = new Map<string, string>();
      
      // First, create all folders (they need to exist before tracks can reference them)
      if (folders.length > 0) {
        console.log('API /library/batch-import - Creating folders...');
        
        // Check for existing folders to avoid duplicates
        const existingFolders = await supabase
          .from('folders')
          .select('id, path')
          .eq('user_id', user.id);

        const existingPaths = new Set(existingFolders.data?.map(f => f.path) || []);
        
        // Filter out folders that already exist
        const foldersToCreate = folders
          .filter(folder => !existingPaths.has(folder.path))
          .map(folder => {
            const newUuid = nanoid();
            folderPathToUuidMap.set(folder.path, newUuid);
            return {
              id: newUuid,
              name: folder.name,
              path: folder.path,
              parent: folder.parent ? folderPathToUuidMap.get(folder.parent) || null : null,
              user_id: user.id,
              created: new Date().toISOString()
            };
          });

        // Also map existing folders
        existingFolders.data?.forEach(folder => {
          folderPathToUuidMap.set(folder.path, folder.id);
        });

        if (foldersToCreate.length > 0) {
          const { data: createdFolders, error: foldersError } = await supabase
            .from('folders')
            .insert(foldersToCreate)
            .select();

          if (foldersError) {
            console.error('API /library/batch-import - Error creating folders:', foldersError);
            results.errors.push(`Folders: ${foldersError.message}`);
          } else {
            results.foldersCreated = createdFolders?.length || 0;
            console.log('API /library/batch-import - Created folders:', results.foldersCreated);
          }
        }
      }

      // Then, create all tracks
      if (tracks.length > 0) {
        console.log('API /library/batch-import - Creating tracks...');
        
        // Check for existing tracks to avoid duplicates
        const existingTracks = await supabase
          .from('tracks')
          .select('name, folder')
          .eq('user_id', user.id);

        const existingTrackKeys = new Set(
          existingTracks.data?.map(t => `${t.name}:${t.folder || 'root'}`) || []
        );
        
        const tracksToCreate = tracks
          .filter(track => {
            const trackKey = `${track.name}:${track.folder || 'root'}`;
            return !existingTrackKeys.has(trackKey);
          })
          .map(track => ({
            id: nanoid(), // Always generate new UUID for each import
            user_id: user.id,
            name: track.name,
            code: track.code || '',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            folder: track.folder ? folderPathToUuidMap.get(track.folder) || null : null, // Convert folder path to UUID
            is_multitrack: track.isMultitrack || false,
            steps: track.steps,
            active_step: track.activeStep || 0
          }));

        if (tracksToCreate.length > 0) {
          const { data: createdTracks, error: tracksError } = await supabase
            .from('tracks')
            .insert(tracksToCreate)
            .select();

          if (tracksError) {
            console.error('API /library/batch-import - Error creating tracks:', tracksError);
            results.errors.push(`Tracks: ${tracksError.message}`);
          } else {
            results.tracksCreated = createdTracks?.length || 0;
            console.log('API /library/batch-import - Created tracks:', results.tracksCreated);
          }
        }
      }

      console.log('API /library/batch-import - Batch import completed:', results);

      return new Response(JSON.stringify({
        success: true,
        results: {
          tracksCreated: results.tracksCreated,
          foldersCreated: results.foldersCreated,
          totalCreated: results.tracksCreated + results.foldersCreated,
          errors: results.errors
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (batchError) {
      console.error('API /library/batch-import - Batch operation failed:', batchError);
      return new Response(JSON.stringify({ 
        error: 'Batch import failed',
        details: batchError instanceof Error ? batchError.message : 'Unknown error',
        results
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('API /library/batch-import - Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};