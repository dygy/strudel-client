import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from '../_auth';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

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

    // First, fetch the track to get its name for logging
    const { data: trackToDelete, error: fetchError } = await supabaseService
      .from('tracks')
      .select('name')
      .eq('id', trackId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !trackToDelete) {
      console.error('API /tracks/delete - track not found:', trackId);
      return new Response(JSON.stringify({ error: 'Track not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /tracks/delete - deleting track:', trackToDelete.name, 'ID:', trackId);

    // Delete the track with service role (bypasses RLS)
    const { error } = await supabaseService
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

    console.log('API /tracks/delete - track deleted successfully:', trackToDelete.name, 'ID:', trackId);

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