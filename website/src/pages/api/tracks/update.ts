import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

async function getAuthenticatedUser(request: Request) {
  try {
    const cookies = request.headers.get('cookie') || '';
    
    console.log('UPDATE API - cookies received:', cookies.substring(0, 100) + '...');
    
    if (!cookies) {
      console.log('UPDATE API - No cookies found');
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

    console.log('UPDATE API - Parsed cookie keys:', Array.from(cookieMap.keys()));

    // Look for Supabase auth cookies
    let accessToken = null;

    // Try different cookie patterns that Supabase might use
    cookieMap.forEach((value, key) => {
      // Access token should be a JWT (starts with eyJ and has dots)
      if ((key.includes('access') || key.includes('auth-token') || key.startsWith('sb-access')) && value.includes('.')) {
        accessToken = value;
        console.log('UPDATE API - Found access token in:', key);
      }
    });

    if (!accessToken) {
      console.log('UPDATE API - No access token found in cookies');
      throw new Error('No access token found');
    }

    console.log('UPDATE API - Attempting to verify access token...');

    // Create Supabase client with anon key and verify the access token
    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
    
    const { data: { user }, error } = await supabaseAnon.auth.getUser(accessToken);

    console.log('UPDATE API - getUser result:', {
      hasUser: !!user,
      userId: user?.id,
      userEmail: user?.email,
      error: error?.message
    });

    if (error || !user) {
      console.log('UPDATE API - Authentication failed:', error?.message || 'No user returned');
      throw new Error('Authentication failed: ' + (error?.message || 'No user returned'));
    }

    return { user, accessToken };
  } catch (error) {
    console.error('UPDATE API - getAuthenticatedUser error:', error);
    throw error;
  }
}

export const PUT: APIRoute = async ({ request }) => {
  try {
    const { user, accessToken } = await getAuthenticatedUser(request);

    // Parse request body
    const body = await request.json();
    const { trackId, updates } = body;

    if (!trackId) {
      return new Response(JSON.stringify({ error: 'Track ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /tracks/update - updating track:', trackId, 'for user:', user.id, 'with updates:', updates);

    // Update the track directly using Supabase service role client
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Update the track with service role (bypasses RLS)
    const { data: updatedTrack, error } = await supabaseService
      .from('tracks')
      .update({
        ...updates,
        modified: new Date().toISOString()
      })
      .eq('id', trackId)
      .eq('user_id', user.id) // Still check user_id for security
      .select()
      .single();

    if (error) {
      console.error('API /tracks/update - database error:', error);
      
      if (error.code === 'PGRST116') {
        return new Response(JSON.stringify({ error: 'Track not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      throw error;
    }

    if (!updatedTrack) {
      return new Response(JSON.stringify({ error: 'Track not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /tracks/update - track updated successfully:', updatedTrack.id);

    return new Response(JSON.stringify({ 
      success: true,
      track: updatedTrack 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /tracks/update error:', error);
    
    const status = error.message?.includes('Authentication') || error.message?.includes('token') ? 401 : 500;
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error' 
    }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};