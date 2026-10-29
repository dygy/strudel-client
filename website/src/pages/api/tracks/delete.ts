import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { serverEnv } from '../../../lib/server-env';
import { readJsonObject, invalidDataResponse } from '../../../lib/apiBody';

export const prerender = false;

export const DELETE: APIRoute = async ({ request }) => {
  try {
    // Bearer header or sb-access-token cookie. An AuthError becomes a 401 below, on which the client
    // refreshes its own session and retries. No setSession/refresh fallback here: refresh tokens are
    // single-use and the browser client is the only refresh owner.
    const { user } = await getAuthenticatedUser(request);

    // Parse request body
    // Unparseable or non-object bodies are refused with 400, not a 500.
    const body = await readJsonObject(request);
    if (!body) {
      return invalidDataResponse();
    }
    const { trackId } = body;

    if (!trackId) {
      return new Response(JSON.stringify({ error: 'Track ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('API /tracks/delete - deleting track:', trackId, 'for user:', user.id);

    // Delete the track directly using Supabase service role client
    const supabaseService = createClient(serverEnv().supabaseUrl, serverEnv().supabaseServiceKey);

    // First, fetch the track to get its name for logging
    const { data: trackToDelete, error: fetchError } = await supabaseService
      .from('tracks')
      .select('name')
      .eq('id', trackId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !trackToDelete) {
      console.error('API /tracks/delete - track not found:', trackId);
      return new Response(JSON.stringify({ error: 'Track not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('API /tracks/delete - deleting track:', trackToDelete.name, 'ID:', trackId);

    // Delete the track with service role (bypasses RLS)
    const { error } = await supabaseService.from('tracks').delete().eq('id', trackId).eq('user_id', user.id); // Still check user_id for security

    if (error) {
      console.error('API /tracks/delete - database error:', error);

      if (error.code === 'PGRST116') {
        return new Response(JSON.stringify({ error: 'Track not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw error;
    }

    console.log('API /tracks/delete - track deleted successfully:', trackToDelete.name, 'ID:', trackId);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('API /tracks/delete error:', error);

    const status = error instanceof AuthError ? 401 : 500;

    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error',
      }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};
