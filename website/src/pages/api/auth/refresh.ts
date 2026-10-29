import type { APIRoute } from 'astro';
import { getUserMetadata } from '../../../types/supabase';
import { getAuthenticatedUser, AuthError } from '../_auth';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Kept for old clients; it no longer refreshes anything.
 *
 * Refresh tokens are single-use and the browser supabase client is the only refresh owner, so a
 * server-side refresh would revoke the client's token and sign the user out. This route only
 * reports whether the current access token is still valid: 200 if it is, 401 if not (the client
 * then refreshes its own session and retries).
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (cookies.get('sb-refresh-token')) cookies.delete('sb-refresh-token', { path: '/' });

  try {
    const { user } = await getAuthenticatedUser(request);
    return json({
      success: true,
      user: { id: user.id, email: user.email, user_metadata: getUserMetadata(user) },
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return json({ error: 'Session expired: refresh it on the client and retry' }, 401);
    }
    console.error('Unexpected error in /api/auth/refresh:', error);
    return json({ error: 'Refresh check failed' }, 500);
  }
};
