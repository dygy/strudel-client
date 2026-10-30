import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { userClient } from '../_userClient';

export const prerender = false;

export const DELETE: APIRoute = async ({ request }) => {
  try {
    // Bearer header, then cookie (api/_auth.ts); as the user, so RLS applies.
    const { user, accessToken } = await getAuthenticatedUser(request);
    const supabase = userClient(accessToken);

    // Delete all tracks for the user
    const { error: tracksError } = await supabase.from('tracks').delete().eq('user_id', user.id);

    if (tracksError) {
      console.error('Database error deleting tracks:', tracksError);
      return new Response(JSON.stringify({ error: tracksError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Delete all folders for the user
    const { error: foldersError } = await supabase.from('folders').delete().eq('user_id', user.id);

    if (foldersError) {
      console.error('Database error deleting folders:', foldersError);
      return new Response(JSON.stringify({ error: foldersError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
