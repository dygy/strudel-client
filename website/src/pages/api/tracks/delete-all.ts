import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export const DELETE: APIRoute = async ({ cookies }) => {
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

    // Delete all tracks for the user
    const { error: tracksError } = await supabase
      .from('tracks')
      .delete()
      .eq('user_id', user.id);

    if (tracksError) {
      console.error('Database error deleting tracks:', tracksError);
      return new Response(JSON.stringify({ error: tracksError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete all folders for the user
    const { error: foldersError } = await supabase
      .from('folders')
      .delete()
      .eq('user_id', user.id);

    if (foldersError) {
      console.error('Database error deleting folders:', foldersError);
      return new Response(JSON.stringify({ error: foldersError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true }), {
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