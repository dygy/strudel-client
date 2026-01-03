import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const DELETE: APIRoute = async ({ request }) => {
  try {
    console.log('API /folders/delete-all - Starting delete all folders');

    // Get user from session
    const cookies = request.headers.get('cookie') || '';
    console.log('API /folders/delete-all - Cookies received:', cookies ? 'present' : 'none');

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

    const cookieKeys = Object.keys(cookieObj);
    console.log('API /folders/delete-all - Parsed cookie keys:', cookieKeys);

    // Find access token from cookies
    let accessToken = '';
    for (const [key, value] of Object.entries(cookieObj)) {
      console.log(`API /folders/delete-all - Checking cookie: ${key} ${value.substring(0, 20)}...`);
      if (key === 'sb-access-token' || key.includes('access-token')) {
        accessToken = value;
        console.log(`API /folders/delete-all - Found access token in: ${key}`);
        break;
      }
    }

    if (!accessToken) {
      console.log('API /folders/delete-all - No access token found');
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /folders/delete-all - Attempting to verify access token...');

    // Get user from access token
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);

    if (userError || !user) {
      console.log('API /folders/delete-all - User verification failed:', userError?.message);
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /folders/delete-all - User verified:', user.id);

    // Delete all folders for this user
    const { error: deleteError } = await supabase
      .from('folders')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('API /folders/delete-all - Delete error:', deleteError);
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /folders/delete-all - All folders deleted successfully');

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /folders/delete-all - Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};