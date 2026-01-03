import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getUserMetadata } from '../../../types/supabase';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const POST: APIRoute = async ({ cookies }) => {
  console.log('Token refresh API endpoint called');
  
  try {
    const refreshToken = cookies.get('sb-refresh-token')?.value;
    
    if (!refreshToken) {
      console.log('No refresh token found in cookies');
      return new Response(JSON.stringify({ error: 'No refresh token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create a Supabase client for server-side use
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    console.log('Refreshing session with refresh token...');
    
    // Refresh the session
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error) {
      console.error('Error refreshing session:', error);
      // Clear invalid cookies
      cookies.delete('sb-access-token', { path: '/' });
      cookies.delete('sb-refresh-token', { path: '/' });
      cookies.delete('sb-user', { path: '/' });
      
      return new Response(JSON.stringify({ error: error.message }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!data.session) {
      console.error('No session returned from refresh');
      return new Response(JSON.stringify({ error: 'No session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('Session refreshed successfully for user:', data.session.user.email);

    // Update cookies with new tokens
    const maxAge = 60 * 60 * 24 * 30; // 30 days
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      maxAge,
      path: '/',
    };

    cookies.set('sb-access-token', data.session.access_token, cookieOptions);
    cookies.set('sb-refresh-token', data.session.refresh_token, cookieOptions);
    cookies.set('sb-user', JSON.stringify({
      id: data.session.user.id,
      email: data.session.user.email,
      user_metadata: getUserMetadata(data.session.user),
    }), {
      secure: true,
      sameSite: 'lax' as const,
      maxAge,
      path: '/',
    });

    return new Response(JSON.stringify({ 
      success: true,
      user: {
        id: data.session.user.id,
        email: data.session.user.email,
        user_metadata: getUserMetadata(data.session.user),
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Unexpected error during token refresh:', error);
    return new Response(JSON.stringify({ error: 'Refresh failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};