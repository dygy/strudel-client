/**
 * Telling "the token is bad" apart from "the auth service couldn't be asked".
 *
 * supabase-js `auth.getUser(token)` RETURNS (does not throw) `AuthRetryableFetchError` on network
 * failures and 502/503/504. Treating that like an invalid token signs a user out (401, a /login
 * redirect) just because Supabase blinked. Only a 4xx answer means the session itself is bad.
 *
 * Same test as auth-js `isAuthRetryableFetchError` (by `name`), done structurally: it is shared by
 * SSR pages and API routes, and the API tests replace `@supabase/supabase-js` with a fake that
 * exports only `createClient`.
 */
export interface SupabaseAuthErrorLike {
  name?: string;
  status?: number;
  message?: string;
}

/** true: expired/malformed/revoked token (sign the user out). false: service failure (retry). */
export function isInvalidSessionError(error: SupabaseAuthErrorLike): boolean {
  if (error.name === 'AuthRetryableFetchError') return false;
  return typeof error.status === 'number' && error.status >= 400 && error.status < 500;
}
