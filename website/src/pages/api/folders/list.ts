import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { userClient } from '../_userClient';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    // Bearer header, then cookie (api/_auth.ts); as the user, so RLS applies.
    const { user, accessToken } = await getAuthenticatedUser(request);
    const supabase = userClient(accessToken);

    // Get all folders for the user
    const { data, error } = await supabase.from('folders').select('*').eq('user_id', user.id).order('name');

    if (error) {
      console.error('Database error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ data: data || [] }), {
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
