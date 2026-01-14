/**
 * Shared authentication utility for API endpoints
 * Checks both Authorization header and cookies for access token
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

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
        cookies.split(';').forEach(cookie => {
          const [key, value] = cookie.trim().split('=');
          if (key && value) {
            cookieMap.set(key, decodeURIComponent(value));
          }
        });

        // Look for Supabase auth cookies
        cookieMap.forEach((value, key) => {
          // Access token should be a JWT (starts with eyJ and has dots)
          if ((key.includes('access') || key.includes('auth-token') || key.startsWith('sb-access')) && value.includes('.')) {
            accessToken = value;
            console.log('API Auth - Found access token in cookie:', key);
          }
        });
      }
    }

    if (!accessToken) {
      console.log('API Auth - No access token found in headers or cookies');
      throw new Error('No access token found');
    }

    // Create Supabase client with anon key and verify the access token
    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
    
    const { data: { user }, error } = await supabaseAnon.auth.getUser(accessToken);

    if (error || !user) {
      console.log('API Auth - Authentication failed:', error?.message || 'No user returned');
      throw new Error('Authentication failed: ' + (error?.message || 'No user returned'));
    }

    return { user, accessToken };
  } catch (error) {
    console.error('API Auth - getAuthenticatedUser error:', error);
    throw error;
  }
}
