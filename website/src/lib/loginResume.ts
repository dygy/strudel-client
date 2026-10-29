/**
 * Login page auto-return.
 *
 * A user lands on /login?redirect=<page> when the server's cookie copy of the access token was
 * stale (a tab reopened after the 1 h expiry, a slow local clock) although the client session is
 * still alive. Force-refresh it (the local clock can't be trusted to decide it's expired: the
 * server just said it is), rewrite the cookie and go straight back.
 *
 * At most once per AUTO_RESUME_WINDOW_MS (claimAutoResume) so a page that keeps rejecting the
 * session can't loop, and never when /login carries an `error`.
 */
import type { CookieSession } from './authCookies';
import { claimAutoResume, redirectTargetFromSearch } from './authRedirect';

export interface LoginResumeDeps {
  search: string;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  hasClientSession: () => Promise<boolean>;
  forceRefresh: () => Promise<{ success: boolean; session?: CookieSession }>;
  writeCookie: (session: CookieSession) => void;
  navigate: (path: string) => void;
}

/** true when it navigated back. */
export async function resumeSessionFromLogin(deps: LoginResumeDeps): Promise<boolean> {
  if (new URLSearchParams(deps.search).has('error')) return false;
  if (!(await deps.hasClientSession())) return false;
  if (!claimAutoResume(deps.storage, deps.search)) return false;

  const refreshed = await deps.forceRefresh();
  if (!refreshed.success || !refreshed.session?.access_token) return false;

  deps.writeCookie(refreshed.session);
  deps.navigate(redirectTargetFromSearch(deps.search));
  return true;
}
