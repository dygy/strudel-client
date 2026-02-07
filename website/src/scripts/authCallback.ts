/**
 * OAuth callback handler for authentication
 * This script runs on the auth callback page to complete the OAuth flow
 */
import { createSupabaseClient } from '../lib/supabaseClient';

async function handleCallback() {
  try {
    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

    console.log('🔥 OAuth callback - Using environment variables:', {
      supabaseUrl: supabaseUrl?.substring(0, 30) + '...',
      hasAnonKey: !!supabaseAnonKey,
    });

    // Validate environment variables
    if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder')) {
      console.error('🔥 OAuth callback - Invalid environment variables:', {
        supabaseUrl: supabaseUrl?.substring(0, 30) + '...',
        hasAnonKey: !!supabaseAnonKey,
      });
      window.location.href = '/login?error=config_error';
      return;
    }

    // Create Supabase client with environment variables
    const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);

    console.log('OAuth callback - Starting...');

    // Wait a bit for Supabase to process the OAuth callback
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check for session multiple times with retries
    let session = null;
    let attempts = 0;
    const maxAttempts = 5;

    while (!session && attempts < maxAttempts) {
      attempts++;
      console.log(`OAuth callback - Attempt ${attempts} to get session...`);

      const {
        data: { session: currentSession },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error('OAuth callback - Session error:', error);
      }

      if (currentSession) {
        session = currentSession;
        console.log('OAuth callback - Session found:', {
          userId: session.user?.id,
          userEmail: session.user?.email,
          accessToken: session.access_token ? 'present' : 'missing',
          expiresAt: session.expires_at,
        });
        break;
      }

      // Wait before retry
      if (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (session) {
      console.log('OAuth callback - Success! Setting cookies and redirecting to /repl');

      // Set cookies that the server can read
      document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=3600; secure; samesite=lax`;
      if (session.refresh_token) {
        document.cookie = `sb-refresh-token=${session.refresh_token}; path=/; max-age=86400; secure; samesite=lax`;
      }

      // Check if there's a redirect URL stored in sessionStorage
      const redirectUrl = sessionStorage.getItem('strudel_redirect_after_auth') || '/repl';
      sessionStorage.removeItem('strudel_redirect_after_auth');

      window.location.href = redirectUrl;
    } else {
      console.error('OAuth callback - No session found after all attempts');
      window.location.href = '/login?error=no_session';
    }
  } catch (error) {
    console.error('OAuth callback - Error:', error);
    window.location.href = '/login?error=callback_error';
  }
}

handleCallback();
