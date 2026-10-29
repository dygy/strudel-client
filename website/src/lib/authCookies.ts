/**
 * Session cookies the server reads (SSR pages and `/api/*` cookie fallback).
 *
 * The browser supabase-js client is the ONLY refresh owner: it keeps the session in
 * localStorage and rotates the refresh token itself. These cookies just mirror its current
 * access token so the server can see who is signed in. Call `syncSessionCookies` on every auth
 * event (SIGNED_IN, TOKEN_REFRESHED, ...) so the cookie never goes stale while the client is
 * still signed in.
 *
 * The refresh token is deliberately NOT mirrored. Refresh tokens are single-use: if a server
 * route refreshed with a cookie copy, the client's own copy would be revoked and the user
 * signed out. A legacy `sb-refresh-token` cookie is deleted whenever the cookies are written.
 */

export const ACCESS_TOKEN_COOKIE = 'sb-access-token';
export const LEGACY_REFRESH_TOKEN_COOKIE = 'sb-refresh-token';
/** 30 days. The JWT inside expires after ~1 h; the server checks that, not the cookie age. */
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Options for a server-side Set-Cookie of the access token. Same attributes as the browser write
 * below, and never httpOnly: the client must be able to overwrite it on every token refresh (an
 * httpOnly copy would go stale an hour later and could never be replaced from the page).
 */
export const SERVER_ACCESS_COOKIE_OPTIONS = {
  httpOnly: false,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_COOKIE_MAX_AGE,
};

export interface CookieSession {
  access_token: string;
}

function setCookie(name: string, value: string, maxAge: number): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; secure; samesite=lax`;
}

/** Mirror the client session's access token into the cookie the server reads. */
export function writeSessionCookies(session: CookieSession | null | undefined): void {
  if (!session?.access_token) return;
  setCookie(ACCESS_TOKEN_COOKIE, session.access_token, SESSION_COOKIE_MAX_AGE);
  setCookie(LEGACY_REFRESH_TOKEN_COOKIE, '', 0);
}

/** Remove the session cookies (sign-out). */
export function clearSessionCookies(): void {
  setCookie(ACCESS_TOKEN_COOKIE, '', 0);
  setCookie(LEGACY_REFRESH_TOKEN_COOKIE, '', 0);
}

/**
 * Keep the cookies in step with a supabase-js auth event. Events without a session (other than
 * SIGNED_OUT) leave the cookies alone.
 */
export function syncSessionCookies(event: string, session: CookieSession | null | undefined): void {
  if (event === 'SIGNED_OUT') {
    clearSessionCookies();
    return;
  }
  if (session?.access_token) {
    writeSessionCookies(session);
  }
}
