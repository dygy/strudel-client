import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { ACCESS_TOKEN_COOKIE, SERVER_ACCESS_COOKIE_OPTIONS } from '../../../lib/authCookies';

export const prerender = false;

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extraHeaders } });

/** Set-Cookie for the access token, with the same attributes the browser helper writes. */
function accessTokenSetCookie(token: string): string {
  const o = SERVER_ACCESS_COOKIE_OPTIONS;
  return `${ACCESS_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=${o.path}; Max-Age=${o.maxAge}; Secure; SameSite=Lax`;
}

/** `exp` of a JWT as an ISO date, or null if it can't be read. */
function jwtExpiry(accessToken: string): string | null {
  try {
    const tokenParts = accessToken.split('.');
    if (tokenParts.length !== 3) return null;
    const payload = JSON.parse(atob(tokenParts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null;
  } catch (error: unknown) {
    console.warn('API /auth/user - Could not decode JWT expiry:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Who is signed in. Accepts `Authorization: Bearer <access token>` (what the client sends after
 * refreshing its own session) and falls back to the `sb-access-token` cookie.
 * Never refreshes: the browser supabase client is the only refresh owner.
 * A missing/invalid session answers 200 `{ user: null }`; any other failure is a 500.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  try {
    const { user, accessToken } = await getAuthenticatedUser(request);
    const metadata = user.user_metadata ?? {};

    // Self-heal: the valid token came in the Bearer header but the cookie holds something else
    // (stale, or an old httpOnly copy the page can't overwrite). A server Set-Cookie replaces it,
    // so the next SSR page load sees the current token.
    const extraHeaders: Record<string, string> = {};
    const viaBearer = request.headers.get('authorization')?.startsWith('Bearer ') ?? false;
    if (viaBearer && cookies.get(ACCESS_TOKEN_COOKIE)?.value !== accessToken) {
      extraHeaders['Set-Cookie'] = accessTokenSetCookie(accessToken);
    }

    return json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: typeof metadata.full_name === 'string' ? metadata.full_name : user.email,
          avatar: typeof metadata.avatar_url === 'string' ? metadata.avatar_url : undefined,
        },
        sessionExpiresAt: jwtExpiry(accessToken),
      },
      200,
      extraHeaders,
    );
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return json({ user: null, session: null });
    }
    console.error('API /auth/user error:', error);
    return json({ user: null, session: null, error: 'Internal server error' }, 500);
  }
};
