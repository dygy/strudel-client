import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  // Get environment variables
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
  const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  
  // Check if we have real configuration
  const hasRealConfig = supabaseUrl !== 'https://placeholder.supabase.co' && supabaseKey !== 'placeholder-key';
  
  const config = {
    supabaseUrl: supabaseUrl || 'undefined',
    supabaseKeyPrefix: supabaseKey ? supabaseKey.substring(0, 20) + '...' : 'undefined',
    hasRealConfig,
    isPlaceholder: supabaseUrl === 'https://placeholder.supabase.co',
    timestamp: new Date().toISOString()
  };
  
  return new Response(JSON.stringify(config, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
};