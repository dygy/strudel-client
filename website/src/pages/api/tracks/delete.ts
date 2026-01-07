import type { APIRoute } from 'astro';
import { db } from '../../../lib/supabase';

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

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const user = await getAuthenticatedUser(request);

    // Parse request body
    const body = await request.json();
    const { trackId } = body;

    if (!trackId) {
      return new Response(JSON.stringify({ error: 'Track ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('API /tracks/delete - deleting track:', trackId, 'for user:', user.id);

    // Delete the track using the legacy tracks table
    const { data: deletedTrack, error } = await db.tracks.delete(trackId);

    if (error) {
      console.error('API /tracks/delete - database error:', error);
      
      if (error.code === 'PGRST116') {
        return new Response(JSON.stringify({ error: 'Track not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      throw error;
    }

    console.log('API /tracks/delete - track deleted successfully:', trackId);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API /tracks/delete error:', error);
    
    const status = error.message?.includes('Authentication') || error.message?.includes('token') ? 401 : 500;
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error' 
    }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};