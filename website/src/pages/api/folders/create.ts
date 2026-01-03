import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    console.log('API folders/create - Request received');
    
    // Try to get access token from Astro cookies first (direct API calls)
    let accessToken = cookies.get('sb-access-token')?.value;
    console.log('API folders/create - Astro cookie token:', accessToken ? 'present' : 'missing');
    
    // If not found, try parsing from request headers (frontend fetch calls)
    if (!accessToken) {
      const cookieHeader = request.headers.get('cookie') || '';
      console.log('API folders/create - Cookie header:', cookieHeader.substring(0, 100) + '...');
      
      const cookieMap = new Map();
      cookieHeader.split(';').forEach(cookie => {
        const [key, value] = cookie.trim().split('=');
        if (key && value) {
          cookieMap.set(key, decodeURIComponent(value));
        }
      });
      
      console.log('API folders/create - Parsed cookie keys:', Array.from(cookieMap.keys()));
      accessToken = cookieMap.get('sb-access-token');
      console.log('API folders/create - Header token:', accessToken ? 'present' : 'missing');
    }
    
    if (!accessToken) {
      console.log('API folders/create - No access token found anywhere');
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create Supabase client with service role key for server-side operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user token
    console.log('API folders/create - Verifying token...');
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    
    if (userError || !user) {
      console.log('API folders/create - Token verification failed:', userError?.message || 'No user returned');
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log('API folders/create - User verified:', user.id);

    // Parse the request body
    const folderData = await request.json();
    
    // Validate required fields
    if (!folderData.name || !folderData.id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create the folder in the database
    const { data, error } = await supabase
      .from('folders')
      .insert({
        id: folderData.id,
        user_id: user.id,
        name: folderData.name,
        path: folderData.path,
        parent: folderData.parent || null, // Ensure null instead of undefined for root
        created: folderData.created || new Date().toISOString()
      })
      .select()
      .maybeSingle(); // Use maybeSingle() instead of single()

    if (error) {
      console.error('Database error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ data }), {
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