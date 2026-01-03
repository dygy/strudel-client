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

    // Parse the request body
    const { tracks } = await request.json();
    
    // Validate required fields
    if (!Array.isArray(tracks)) {
      return new Response(JSON.stringify({ error: 'Tracks must be an array' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Convert UI format to database format and add user_id
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

    // Bulk insert tracks
    const { data, error } = await supabase
      .from('tracks')
      .insert(dbTracks)
      .select();

    if (error) {
      console.error('Database error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Convert database format back to UI format
    const convertedTracks = data?.map(track => ({
      ...track,
      isMultitrack: track.is_multitrack,
      activeStep: track.active_step
    })) || [];

    return new Response(JSON.stringify({ data: convertedTracks }), {
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