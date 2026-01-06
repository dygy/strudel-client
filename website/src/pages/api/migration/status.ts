import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export const GET: APIRoute = async ({ request }) => {
  try {
    // Get user from auth API
    const baseUrl = new URL(request.url).origin;
    const authResponse = await fetch(`${baseUrl}/api/auth/user`, {
      headers: { 'Cookie': request.headers.get('cookie') || '' }
    });

    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { user } = await authResponse.json();
    if (!user) {
      return new Response(JSON.stringify({ error: 'User not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create Supabase client with service role key
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase configuration:', { supabaseUrl: !!supabaseUrl, supabaseServiceKey: !!supabaseServiceKey });
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user has any tracks (indicates migration has happened)
    const { data: tracks, error: tracksError } = await supabase
      .from('tracks')
      .select('id')
      .eq('user_id', user.id)
      .limit(1);

    if (tracksError) {
      console.error('Error checking for migrated tracks:', tracksError);
      return new Response(JSON.stringify({ error: tracksError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Also check the profile migration flag
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('migrated_from_localstorage')
      .eq('id', user.id)
      .maybeSingle(); // Use maybeSingle() instead of single()

    if (profileError && profileError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking profile migration flag:', profileError);
    }

    // User has migrated if they have tracks OR the migration flag is set
    const hasTracks = tracks && tracks.length > 0;
    const migrationFlagSet = profile?.migrated_from_localstorage === true;
    const hasMigrated = hasTracks || migrationFlagSet;

    return new Response(JSON.stringify({ 
      hasMigrated,
      hasTracks,
      migrationFlagSet 
    }), {
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