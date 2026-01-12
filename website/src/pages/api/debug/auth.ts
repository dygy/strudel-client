import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const GET: APIRoute = async ({ request }) => {
  try {
    const cookies = request.headers.get('cookie') || '';
    
    console.log('DEBUG AUTH - Full cookies:', cookies);
    
    // Parse cookies
    const cookieMap = new Map();
    cookies.split(';').forEach(cookie => {
      const [key, value] = cookie.trim().split('=');
      if (key && value) {
        cookieMap.set(key, decodeURIComponent(value));
      }
    });
    
    const cookieInfo = Array.from(cookieMap.entries()).map(([key, value]) => ({
      key,
      valuePreview: value.substring(0, 50) + (value.length > 50 ? '...' : ''),
      isJWT: value.includes('.') && value.startsWith('eyJ'),
      length: value.length
    }));
    
    // Try to find and decode JWT tokens
    const jwtTokens = [];
    for (const [key, value] of cookieMap) {
      if (value.includes('.') && value.startsWith('eyJ')) {
        try {
          // Decode JWT header (first part)
          const headerPart = value.split('.')[0];
          const decodedHeader = JSON.parse(atob(headerPart));
          
          jwtTokens.push({
            cookieKey: key,
            header: decodedHeader,
            tokenPreview: value.substring(0, 50) + '...'
          });
        } catch (e) {
          jwtTokens.push({
            cookieKey: key,
            error: 'Failed to decode JWT header',
            tokenPreview: value.substring(0, 50) + '...'
          });
        }
      }
    }
    
    // Test Supabase client
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    let supabaseTest = null;
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      supabaseTest = {
        hasSession: !!session,
        sessionUser: session?.user?.id || null,
        error: error?.message || null
      };
    } catch (e) {
      supabaseTest = {
        error: e.message
      };
    }
    
    return new Response(JSON.stringify({
      cookieCount: cookieMap.size,
      cookies: cookieInfo,
      jwtTokens,
      supabaseTest,
      environment: {
        hasSupabaseUrl: !!supabaseUrl,
        hasAnonKey: !!supabaseAnonKey,
        supabaseUrlPreview: supabaseUrl?.substring(0, 30) + '...'
      }
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message,
      stack: error.stack
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};