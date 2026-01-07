import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

async function getAuthenticatedUser(request: Request) {
  try {
    const cookies = request.headers.get('cookie') || '';
    
    console.log('CREATE API - cookies received:', cookies.substring(0, 100) + '...');
    
    if (!cookies) {
      console.log('CREATE API - No cookies found');
      throw new Error('No cookies found');
    }

    // Parse cookies to get Supabase session tokens
    const cookieMap = new Map();
    cookies.split(';').forEach(cookie => {
      const [key, value] = cookie.trim().split('=');
      if (key && value) {
        cookieMap.set(key, decodeURIComponent(value));
      }
    });

    console.log('CREATE API - Parsed cookie keys:', Array.from(cookieMap.keys()));

    // Look for Supabase auth cookies
    let accessToken = null;

    // Try different cookie patterns that Supabase might use
    cookieMap.forEach((value, key) => {
      // Access token should be a JWT (starts with eyJ and has dots)
      if ((key.includes('access') || key.includes('auth-token') || key.startsWith('sb-access')) && value.includes('.')) {
        accessToken = value;
        console.log('CREATE API - Found access token in:', key);
      }
    });

    if (!accessToken) {
      console.log('CREATE API - No access token found in cookies');
      throw new Error('No access token found');
    }

    console.log('CREATE API - Attempting to verify access token...');

    // Create Supabase client with anon key and verify the access token
    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
    
    const { data: { user }, error } = await supabaseAnon.auth.getUser(accessToken);

    console.log('CREATE API - getUser result:', {
      hasUser: !!user,
      userId: user?.id,
      userEmail: user?.email,
      error: error?.message
    });

    if (error || !user) {
      console.log('CREATE API - Authentication failed:', error?.message || 'No user returned');
      throw new Error('Authentication failed: ' + (error?.message || 'No user returned'));
    }

    return { user, accessToken };
  } catch (error) {
    console.error('CREATE API - getAuthenticatedUser error:', error);
    throw error;
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { user, accessToken } = await getAuthenticatedUser(request);

    // Parse request body
    const body = await request.json();
    const { name, code = '', folder, isMultitrack, steps, activeStep } = body;

    if (!name) {
      return new Response(JSON.stringify({ error: 'Track name is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /tracks/create - creating track for user:', user.id, { name, folder, isMultitrack });

    // Create the track directly using Supabase service role client
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Create the track with service role (bypasses RLS)
    const trackData = {
      id: nanoid(),
      user_id: user.id,
      name: name.trim(),
      code: code || '',
      folder: folder || null,
      is_multitrack: isMultitrack || false,
      steps: steps || [],
      active_step: activeStep || 0,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };

    const { data: newTrack, error } = await supabaseService
      .from('tracks')
      .insert(trackData)
      .select()
      .single();

    if (error) {
      console.error('API /tracks/create - database error:', error);
      throw error;
    }

    if (!newTrack) {
      throw new Error('Failed to create track');
    }

    console.log('API /tracks/create - track created successfully:', newTrack.id);

    return new Response(JSON.stringify({ 
      success: true,
      track: newTrack 
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /tracks/create error:', error);
    
    const status = error.message?.includes('Authentication') || error.message?.includes('token') ? 401 : 500;
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error' 
    }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};