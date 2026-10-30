import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { userClient } from '../_userClient';

export const prerender = false;

export const DELETE: APIRoute = async ({ request }) => {
  try {
    // Bearer header, then cookie (api/_auth.ts); as the user, so RLS applies.
    const { user, accessToken } = await getAuthenticatedUser(request);
    const supabase = userClient(accessToken);

    console.log('API /folders/delete-all - User verified:', user.id);

    // Delete all folders for this user
    const { error: deleteError } = await supabase.from('folders').delete().eq('user_id', user.id);

    if (deleteError) {
      console.error('API /folders/delete-all - Delete error:', deleteError);
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('API /folders/delete-all - All folders deleted successfully');

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
    console.error('API /folders/delete-all - Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
