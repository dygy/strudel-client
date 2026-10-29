/**
 * Shared authentication utility for API endpoints
 * Checks both Authorization header and cookies for access token
 */

import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '../../lib/server-env';
import { isInvalidSessionError } from '../../lib/authErrorKind';

/**
 * Thrown when a request has no valid session. Routes map it to 401 by type, never by
 * message text: the client only refreshes the session and retries on a 401.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * The auth service couldn't be asked (network error, 5xx). Deliberately NOT an AuthError, so routes
 * answer 500 and the client keeps the user signed in ("unknown") instead of treating it as a 401.
 */
export class AuthServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

export { isInvalidSessionError };

export async function getAuthenticatedUser(request: Request) {
  try {
    let accessToken = null;

    // First, try to get token from Authorization header (preferred method after refresh)
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7);
      console.log('API Auth - Found access token in Authorization header');
    }

    // If no Authorization header, fall back to cookies
    if (!accessToken) {
      const cookies = request.headers.get('cookie') || '';

      if (cookies) {
        // Parse cookies to get Supabase session tokens
        const cookieMap = new Map();
        cookies.split(';').forEach((cookie) => {
          const [key, value] = cookie.trim().split('=');
          if (key && value) {
            cookieMap.set(key, decodeURIComponent(value));
          }
        });

        // Look for Supabase auth cookies
        cookieMap.forEach((value, key) => {
          // Access token should be a JWT (starts with eyJ and has dots)
          if (
            (key.includes('access') || key.includes('auth-token') || key.startsWith('sb-access')) &&
            value.includes('.')
          ) {
            accessToken = value;
            console.log('API Auth - Found access token in cookie:', key);
          }
        });
      }
    }

    if (!accessToken) {
      console.log('API Auth - No access token found in headers or cookies');
      throw new AuthError('No access token found');
    }

    // Create Supabase client with anon key and verify the access token
    const supabaseAnon = createClient(serverEnv().supabaseUrl, serverEnv().supabaseAnonKey);

    const {
      data: { user },
      error,
    } = await supabaseAnon.auth.getUser(accessToken);

    if (error && !isInvalidSessionError(error)) {
      // Supabase unreachable / 5xx: auth-js *returns* AuthRetryableFetchError from getUser instead
      // of throwing. That says nothing about the session, so it must not become a 401/"signed out".
      console.error('API Auth - Could not verify the session (auth service error):', error);
      throw new AuthServiceError('Could not verify the session: ' + (error.message || 'auth service error'));
    }

    if (error || !user) {
      console.log('API Auth - Authentication failed:', error?.message || 'No user returned');
      throw new AuthError('Authentication failed: ' + (error?.message || 'No user returned'));
    }

    return { user, accessToken };
  } catch (error) {
    console.error('API Auth - getAuthenticatedUser error:', error);
    throw error;
  }
}
