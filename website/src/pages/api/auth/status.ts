import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getUserMetadata } from '../../../types/supabase';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const GET: APIRoute = async ({ cookies }) => {
  try {
    // Check for auth cookies
    const accessToken = cookies.get('sb-access-token')?.value;
    const refreshToken = cookies.get('sb-refresh-token')?.value;
    const userCookie = cookies.get('sb-user')?.value;

    if (!accessToken || !refreshToken || !userCookie) {
      return new Response(JSON.stringify({ 
        authenticated: false,
        user: null 
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse user data
    let user;
    try {
      user = JSON.parse(userCookie);
    } catch (error) {
      console.error('Error parsing user cookie:', error);
      return new Response(JSON.stringify({ 
        authenticated: false,
        user: null 
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate token with Supabase
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const { data: { user: validatedUser }, error } = await supabase.auth.getUser(accessToken);

    if (error || !validatedUser) {
      console.log('Token validation failed:', error?.message);
      
      // Try to refresh the token
      try {
        const { data, error: refreshError } = await supabase.auth.refreshSession({
          refresh_token: refreshToken,
        });

        if (refreshError || !data.session) {
          // Clear invalid cookies
          cookies.delete('sb-access-token', { path: '/' });
          cookies.delete('sb-refresh-token', { path: '/' });
          cookies.delete('sb-user', { path: '/' });
          
          return new Response(JSON.stringify({ 
            authenticated: false,
            user: null 
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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
          authenticated: true,
          user: {
            id: data.session.user.id,
            email: data.session.user.email,
            user_metadata: getUserMetadata(data.session.user),
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
        return new Response(JSON.stringify({ 
          authenticated: false,
          user: null 
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // User is authenticated
    return new Response(JSON.stringify({ 
      authenticated: true,
      user: {
        id: validatedUser.id,
        email: validatedUser.email,
        user_metadata: getUserMetadata(validatedUser),
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error checking auth status:', error);
    return new Response(JSON.stringify({ 
      authenticated: false,
      user: null,
      error: 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};