import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export const GET: APIRoute = async ({ request }) => {
  try {
    const cookies = request.headers.get('cookie') || '';
    
    console.log('API /auth/user - All cookies:', cookies);
    
    if (!cookies) {
      console.log('API /auth/user - No cookies found');
      return new Response(JSON.stringify({ user: null, session: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse cookies to get Supabase session tokens
    const cookieMap = new Map();
    cookies.split(';').forEach(cookie => {
      const [key, value] = cookie.trim().split('=');
      if (key && value) {
        cookieMap.set(key, decodeURIComponent(value));
      }
    });

    console.log('API /auth/user - Parsed cookie keys:', Array.from(cookieMap.keys()));

    // Look for Supabase auth cookies
    let accessToken = null;
    let refreshToken = null;

    // Try different cookie patterns that Supabase might use
    for (const [key, value] of cookieMap) {
      console.log('API /auth/user - Checking cookie:', key, value.substring(0, 20) + '...');
      
      // Access token should be a JWT (starts with eyJ and has dots)
      if ((key.includes('access') || key.includes('auth-token') || key.startsWith('sb-access')) && value.includes('.')) {
        accessToken = value;
        console.log('API /auth/user - Found access token in:', key);
      }
      // Refresh token is typically shorter and doesn't have dots
      else if (key.includes('refresh') && !value.includes('.')) {
        refreshToken = value;
        console.log('API /auth/user - Found refresh token in:', key);
      }
    }

    if (!accessToken) {
      console.log('API /auth/user - No access token found in cookies');
      return new Response(JSON.stringify({ user: null, session: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /auth/user - Attempting to verify access token...');

    // Create Supabase client with anon key and set the session
    const supabaseAnon = createClient(supabaseUrl, import.meta.env.PUBLIC_SUPABASE_ANON_KEY);
    
    // Verify the access token using anon client
    const { data: { user }, error } = await supabaseAnon.auth.getUser(accessToken);

    console.log('API /auth/user - getUser result:', {
      hasUser: !!user,
      userId: user?.id,
      userEmail: user?.email,
      error: error?.message
    });

    if (error || !user) {
      console.log('API /auth/user - Authentication failed:', error?.message || 'No user returned');
      return new Response(JSON.stringify({ user: null, session: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Return user information (without sensitive data)
    return new Response(JSON.stringify({
      user: {
        id: user.id,
        email: user.email,
        name: (user as any).user_metadata?.full_name || user.email,
        avatar: (user as any).user_metadata?.avatar_url
      },
      session: {
        access_token: accessToken, // Only return for server-side use
        expires_at: user.last_sign_in_at
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /auth/user error:', error);
    return new Response(JSON.stringify({ 
      user: null, 
      session: null,
      error: 'Internal server error' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};