import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Get the session from cookies
    const accessToken = cookies.get('sb-access-token')?.value;
    if (!accessToken) {
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
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse the request body (localStorage data)
    const { tracks, folders } = await request.json();

    const results = {
      tracks: { success: 0, errors: [] as any[] },
      folders: { success: 0, errors: [] as any[] },
    };

    // Migrate tracks
    if (tracks && Array.isArray(tracks) && tracks.length > 0) {
      try {
        // Convert UI format to database format
        const dbTracks = tracks.map(track => {
          const dbTrack: any = { ...track, user_id: user.id };
          
          // Convert UI fields to database fields
          if (track.isMultitrack !== undefined) {
            dbTrack.is_multitrack = track.isMultitrack;
            delete dbTrack.isMultitrack;
          }
          
          if (track.activeStep !== undefined) {
            dbTrack.active_step = track.activeStep;
            delete dbTrack.activeStep;
          }
          
          return dbTrack;
        });

        const { data, error } = await supabase
          .from('tracks')
          .insert(dbTracks)
          .select();

        if (error) {
          results.tracks.errors.push(error);
        } else {
          results.tracks.success = data?.length || 0;
        }
      } catch (error) {
        results.tracks.errors.push(error);
      }
    }

    // Migrate folders
    if (folders && Array.isArray(folders) && folders.length > 0) {
      try {
        const foldersWithUserId = folders.map(folder => ({ ...folder, user_id: user.id }));

        const { data, error } = await supabase
          .from('folders')
          .insert(foldersWithUserId)
          .select();

        if (error) {
          results.folders.errors.push(error);
        } else {
          results.folders.success = data?.length || 0;
        }
      } catch (error) {
        results.folders.errors.push(error);
      }
    }

    // Set migration flag in user profile
    try {
      await supabase
        .from('profiles')
        .update({
          migrated_from_localstorage: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);
    } catch (error) {
      console.error('Error setting migration flag:', error);
      // Don't fail the migration if we can't set the flag
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};