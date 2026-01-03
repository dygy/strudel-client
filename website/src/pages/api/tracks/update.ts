import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY
);

async function getAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    // Try to get user from cookie-based auth
    const baseUrl = new URL(request.url).origin;
    const authResponse = await fetch(`${baseUrl}/api/auth/user`, {
      headers: { 'Cookie': request.headers.get('cookie') || '' }
    });

    if (!authResponse.ok) {
      throw new Error('Authentication failed');
    }

    const { user } = await authResponse.json();
    if (!user) {
      throw new Error('User not authenticated');
    }
    
    return user;
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Invalid token');
  }
  
  return user;
}

export const PUT: APIRoute = async ({ request }) => {
  try {
    const user = await getAuthenticatedUser(request);

    // Parse request body
    const body = await request.json();
    const { trackId, updates } = body;

    if (!trackId) {
      return new Response(JSON.stringify({ error: 'Track ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create Supabase client with service role for database operations
    const supabaseAdmin = createClient(
      import.meta.env.PUBLIC_SUPABASE_URL,
      import.meta.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Update the track in the tracks table
    const updateData: any = {};
    
    if (updates.folder !== undefined) {
      updateData.folder = updates.folder;
    }
    if (updates.name !== undefined) {
      updateData.name = updates.name;
    }
    if (updates.code !== undefined) {
      updateData.code = updates.code;
    }
    if (updates.isMultitrack !== undefined) {
      updateData.isMultitrack = updates.isMultitrack;
    }
    if (updates.steps !== undefined) {
      updateData.steps = updates.steps;
    }
    if (updates.activeStep !== undefined) {
      updateData.activeStep = updates.activeStep;
    }
    
    // Always update modified timestamp
    updateData.modified = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('tracks')
      .update(updateData)
      .eq('id', trackId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return new Response(JSON.stringify({ error: 'Track not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ track: data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /tracks/update error:', error);
    
    const status = error.message?.includes('Authentication') || error.message?.includes('token') ? 401 : 500;
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error' 
    }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};