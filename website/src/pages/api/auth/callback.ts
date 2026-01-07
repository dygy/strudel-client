import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  try {
    // Debug environment variables
    console.log('Auth callback API - Environment check:', {
      supabaseUrl: supabaseUrl?.substring(0, 30) + '...',
      hasServiceKey: !!supabaseServiceKey,
      serviceKeyLength: supabaseServiceKey?.length
    });

    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    const allParams = Object.fromEntries(url.searchParams.entries());
    
    console.log('Auth callback API - received params:', { 
      code: !!code, 
      error, 
      allParams,
      fullUrl: url.toString()
    });

    if (error) {
      console.error('OAuth error:', error);
      return redirect(`/login?error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      console.error('No authorization code provided - this might be a direct access to callback URL');
      console.log('Full URL:', url.toString());
      console.log('All search params:', allParams);
      
      // If no code and no error, this might be a direct access
      // Redirect to login with a specific error
      return redirect('/login?error=invalid_callback_access');
    }

    // Create Supabase client with service role key
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Auth callback API - attempting to exchange code for session...');
    console.log('Auth callback API - using Supabase URL:', supabaseUrl);
    console.log('Auth callback API - code length:', code?.length);

    // Exchange the code for a session
    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    console.log('Auth callback API - exchange result:', {
      hasData: !!data,
      hasSession: !!data?.session,
      hasUser: !!data?.session?.user,
      error: exchangeError?.message
    });

    if (exchangeError) {
      console.error('Error exchanging code for session:', {
        message: exchangeError.message,
        status: exchangeError.status,
        details: exchangeError
      });
      return redirect(`/login?error=${encodeURIComponent(exchangeError.message)}`);
    }

    if (!data.session) {
      console.error('No session returned from code exchange');
      return redirect('/login?error=no_session');
    }

    console.log('Auth callback API - session established for:', data.session.user.email);

    // Set HTTP-only cookies with the session tokens
    const maxAge = 60 * 60 * 24 * 7; // 7 days
    const isProduction = import.meta.env.PROD;

    console.log('Auth callback API - setting cookies (production mode:', isProduction, ')');

    cookies.set('sb-access-token', data.session.access_token, {
      httpOnly: true,
      secure: isProduction, // Only secure in production (HTTPS)
      sameSite: 'lax',
      maxAge,
      path: '/'
    });

    cookies.set('sb-refresh-token', data.session.refresh_token, {
      httpOnly: true,
      secure: isProduction, // Only secure in production (HTTPS)
      sameSite: 'lax',
      maxAge,
      path: '/'
    });

    // Store user info in a readable cookie for client-side use
    const userInfo = {
      id: data.session.user.id,
      email: data.session.user.email,
      name: (data.session.user as any).user_metadata?.full_name || data.session.user.email,
      avatar: (data.session.user as any).user_metadata?.avatar_url
    };

    cookies.set('sb-user', JSON.stringify(userInfo), {
      httpOnly: false, // Client needs to read this
      secure: isProduction, // Only secure in production (HTTPS)
      sameSite: 'lax',
      maxAge,
      path: '/'
    });

    console.log('Auth callback API - cookies set successfully');
    console.log('Auth callback API - user info:', userInfo);

    // Check if there's a track parameter to redirect to
    const trackParam = url.searchParams.get('state');
    let redirectUrl = '/repl';
    
    if (trackParam) {
      try {
        // The state parameter might contain the original URL
        const decodedState = decodeURIComponent(trackParam);
        if (decodedState.includes('track=')) {
          redirectUrl = decodedState;
        }
      } catch (error) {
        console.log('Error decoding state parameter:', error);
      }
    }

    console.log('Auth callback API - redirecting to:', redirectUrl);

    // Redirect to the main app
    return redirect(redirectUrl);

  } catch (error) {
    console.error('Auth callback API error:', error);
    return redirect('/login?error=callback_error');
  }
};