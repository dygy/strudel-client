import type { APIRoute } from 'astro';
import { db } from '../../../lib/supabase';
import { nanoid } from 'nanoid';

export const prerender = false;

async function getAuthenticatedUser(request: Request) {
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

export const POST: APIRoute = async ({ request }) => {
  try {
    const user = await getAuthenticatedUser(request);

    // Parse request body
    const body = await request.json();
    const { name, code = '', folder, isMultitrack, steps, activeStep } = body;

    if (!name) {
      return new Response(JSON.stringify({ error: 'Track name is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /tracks/create - creating track:', { name, folder, isMultitrack });

    // Create the track using the direct database approach
    const trackData = {
      id: nanoid(),
      name: name.trim(),
      code: code || '',
      folder: folder || null,
      isMultitrack: isMultitrack || false,
      steps: steps || [],
      activeStep: activeStep || 0,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };

    const { data: newTrack, error } = await db.tracks.create(trackData);

    if (error) {
      console.error('API /tracks/create - database error:', error);
      throw error;
    }

    if (!newTrack) {
      throw new Error('Failed to create track');
    }

    console.log('API /tracks/create - track created successfully:', newTrack.id);

    return new Response(JSON.stringify({ 
      success: true,
      track: newTrack 
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /tracks/create error:', error);
    
    const status = error.message?.includes('Authentication') || error.message?.includes('token') ? 401 : 500;
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error' 
    }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};