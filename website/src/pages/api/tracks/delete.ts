import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

async function getAuthenticatedUser(request: Request) {
  try {
    const cookies = request.headers.get('cookie') || '';
    
    console.log('DELETE API - cookies received:', cookies.substring(0, 100) + '...');
    
    if (!cookies) {
      console.log('DELETE API - No cookies found');
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

    console.log('DELETE API - Parsed cookie keys:', Array.from(cookieMap.keys()));

    // Look for Supabase auth cookies
    let accessToken = null;

    // Try different cookie patterns that Supabase might use
    for (const [key, value] of cookieMap) {
      // Access token should be a JWT (starts with eyJ and has dots)
      if ((key.includes('access') || key.includes('auth-token') || key.startsWith('sb-access')) && value.includes('.')) {
        accessToken = value;
        console.log('DELETE API - Found access token in:', key);
        console.log('DELETE API - Token preview:', value.substring(0, 50) + '...');
        break;
      }
    }

    if (!accessToken) {
      console.log('DELETE API - No access token found in cookies');
      throw new Error('No access token found');
    }

    console.log('DELETE API - Attempting to verify access token...');

    // Create Supabase client with anon key and verify the access token
    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
    
    // First try to get the user with the access token
    let { data: { user }, error } = await supabaseAnon.auth.getUser(accessToken);

    // If the token is invalid, try to refresh the session
    if (error && error.message?.includes('JWT')) {
      console.log('DELETE API - JWT error, attempting session refresh...');
      
      // Look for refresh token in cookies
      let refreshToken = null;
      for (const [key, value] of cookieMap) {
        if (key.includes('refresh') && value.length > 10) {
          refreshToken = value;
          console.log('DELETE API - Found refresh token in:', key);
          break;
        }
      }
      
      if (refreshToken) {
        try {
          const { data: sessionData, error: refreshError } = await supabaseAnon.auth.refreshSession({
            refresh_token: refreshToken
          });
          
          if (!refreshError && sessionData.session) {
            console.log('DELETE API - Session refreshed successfully');
            // Try again with the new access token
            const { data: { user: refreshedUser }, error: newError } = await supabaseAnon.auth.getUser(sessionData.session.access_token);
            if (!newError && refreshedUser) {
              user = refreshedUser;
              error = null;
              accessToken = sessionData.session.access_token;
            }
          }
        } catch (refreshErr) {
          console.log('DELETE API - Session refresh failed:', refreshErr);
        }
      }
    }

    console.log('DELETE API - getUser result:', {
      hasUser: !!user,
      userId: user?.id,
      userEmail: user?.email,
      error: error?.message,
      errorCode: error?.code,
      errorStatus: error?.status
    });

    if (error || !user) {
      console.log('DELETE API - Authentication failed:', error?.message || 'No user returned');
      
      // Provide more specific error information
      if (error?.message?.includes('JWT') || error?.message?.includes('token')) {
        throw new Error(`Authentication failed: invalid JWT: ${error.message}`);
      }
      
      throw new Error('Authentication failed: ' + (error?.message || 'No user returned'));
    }

    return { user, accessToken };
  } catch (error) {
    console.error('DELETE API - getAuthenticatedUser error:', error);
    throw error;
  }
}

export const DELETE: APIRoute = async ({ request }) => {
  try {
    // Try the cookie-based authentication first
    let user, accessToken;
    
    try {
      const authResult = await getAuthenticatedUser(request);
      user = authResult.user;
      accessToken = authResult.accessToken;
    } catch (authError) {
      console.log('DELETE API - Cookie auth failed, trying alternative method:', authError.message);
      
      // Alternative: Try to get session from Supabase directly
      const cookies = request.headers.get('cookie') || '';
      const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
      
      // Parse cookies for Supabase session
      const cookieMap = new Map();
      cookies.split(';').forEach(cookie => {
        const [key, value] = cookie.trim().split('=');
        if (key && value) {
          cookieMap.set(key, decodeURIComponent(value));
        }
      });
      
      // Look for session cookies
      let sessionToken = null;
      let refreshToken = null;
      
      for (const [key, value] of cookieMap) {
        if (key.includes('access') || key.includes('session')) {
          sessionToken = value;
        }
        if (key.includes('refresh')) {
          refreshToken = value;
        }
      }
      
      if (sessionToken && refreshToken) {
        try {
          // Set the session manually
          const { data: sessionData, error: sessionError } = await supabaseAnon.auth.setSession({
            access_token: sessionToken,
            refresh_token: refreshToken
          });
          
          if (!sessionError && sessionData.user) {
            user = sessionData.user;
            accessToken = sessionToken;
            console.log('DELETE API - Alternative auth successful');
          } else {
            throw new Error('Session validation failed: ' + (sessionError?.message || 'No user'));
          }
        } catch (sessionErr) {
          throw new Error('Authentication failed: ' + authError.message);
        }
      } else {
        throw new Error('Authentication failed: ' + authError.message);
      }
    }

    // Parse request body
    const body = await request.json();
    const { trackId } = body;

    if (!trackId) {
      return new Response(JSON.stringify({ error: 'Track ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /tracks/delete - deleting track:', trackId, 'for user:', user.id);

    // Delete the track directly using Supabase service role client
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Delete the track with service role (bypasses RLS)
    const { data: deletedTrack, error } = await supabaseService
      .from('tracks')
      .delete()
      .eq('id', trackId)
      .eq('user_id', user.id); // Still check user_id for security

    if (error) {
      console.error('API /tracks/delete - database error:', error);
      
      if (error.code === 'PGRST116') {
        return new Response(JSON.stringify({ error: 'Track not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      throw error;
    }

    console.log('API /tracks/delete - track deleted successfully:', trackId);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /tracks/delete error:', error);
    
    const status = error.message?.includes('Authentication') || error.message?.includes('token') ? 401 : 500;
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error' 
    }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};