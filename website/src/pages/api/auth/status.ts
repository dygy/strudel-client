import type { APIRoute } from 'astro';
import { getUserMetadata } from '../../../types/supabase';
import { getAuthenticatedUser, AuthError } from '../_auth';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Validates the access token (Bearer header, else the `sb-access-token` cookie) and nothing else.
 *
 * It never refreshes. Refresh tokens are single-use, and the browser supabase client is the only
 * refresh owner: a server-side refresh would revoke the client's copy and sign the user out.
 * An expired token answers `authenticated: false`; the client refreshes its session and asks again.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  // Legacy server-set refresh cookie: nothing reads it any more, so don't keep it around.
  if (cookies.get('sb-refresh-token')) cookies.delete('sb-refresh-token', { path: '/' });

  try {
    const { user } = await getAuthenticatedUser(request);
    return json({
      authenticated: true,
      user: { id: user.id, email: user.email, user_metadata: getUserMetadata(user) },
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return json({ authenticated: false, user: null });
    }
    console.error('Error checking auth status:', error);
    return json({ authenticated: false, user: null, error: 'Internal server error' }, 500);
  }
};
