import type { APIRoute } from 'astro';
import { serverEnv } from '../../lib/server-env';

export const prerender = false;

export const GET: APIRoute = async () => {
  // Get environment variables
  const supabaseUrl = serverEnv().supabaseUrl;
  const supabaseKey = serverEnv().supabaseAnonKey;

  // Check if we have real configuration
  const hasRealConfig = supabaseUrl !== 'https://placeholder.supabase.co' && supabaseKey !== 'placeholder-key';

  const config = {
    supabaseUrl: supabaseUrl || 'undefined',
    supabaseKeyPrefix: supabaseKey ? supabaseKey.substring(0, 20) + '...' : 'undefined',
    hasRealConfig,
    isPlaceholder: supabaseUrl === 'https://placeholder.supabase.co',
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(config, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
};
