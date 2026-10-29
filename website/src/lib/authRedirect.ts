/**
 * Login redirects that bring the user back to where they were.
 *
 * Pages send a signed-out (or expired-cookie) visitor to `/login?redirect=<path>`. The login page
 * resumes an existing client session without user action and returns to that path.
 * Isomorphic: used by SSR pages and by the browser.
 */

export const DEFAULT_AFTER_LOGIN = '/repl';

/** Only same-origin absolute paths, never back to /login or /auth (redirect loops). */
export function safeRedirectPath(raw: string | null | undefined, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (!raw || typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if ([...raw].some((ch) => ch.charCodeAt(0) < 0x20)) return fallback;
  if (/^\/(login|auth)(\/|\?|#|$)/.test(raw)) return fallback;
  return raw;
}

/** `/login?redirect=<path>` for the given path (pathname + search). */
export function loginUrlFor(pathWithSearch: string | null | undefined): string {
  const target = safeRedirectPath(pathWithSearch, '');
  return target ? `/login?redirect=${encodeURIComponent(target)}` : '/login';
}

/** Login URL that returns to the current browser location. */
export function loginUrlForCurrentLocation(): string {
  if (typeof window === 'undefined') return '/login';
  return loginUrlFor(window.location.pathname + window.location.search);
}

/** sessionStorage key: where /auth/callback sends the user after Google sign-in. */
export const REDIRECT_AFTER_AUTH_KEY = 'strudel_redirect_after_auth';

/** sessionStorage key: when the login page last auto-returned a still-signed-in user. */
export const AUTO_RESUME_KEY = 'strudel_login_auto_resume_at';
/** At most one automatic return from /login per this window, so a page that keeps rejecting the
 * session (and sending the user back to /login) can't loop: the second time, the user sees the
 * login page instead. */
export const AUTO_RESUME_WINDOW_MS = 30 * 1000;

interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * May the login page send a user with a live client session straight back? Records the attempt
 * when it answers true. Never twice within AUTO_RESUME_WINDOW_MS; never when /login was opened
 * with an `error` (the user must see it).
 */
export function claimAutoResume(storage: MinimalStorage, search: string, now: number = Date.now()): boolean {
  if (new URLSearchParams(search).has('error')) return false;
  let last = NaN;
  try {
    last = Number(storage.getItem(AUTO_RESUME_KEY));
  } catch {
    return false;
  }
  if (Number.isFinite(last) && last > 0 && now - last >= 0 && now - last < AUTO_RESUME_WINDOW_MS) return false;
  try {
    storage.setItem(AUTO_RESUME_KEY, String(now));
  } catch {
    // Without storage we can't guard against a loop, so don't auto-return.
    return false;
  }
  return true;
}

/** The path the login page should return to: `?redirect=`, else legacy `?track=`, else /repl. */
export function redirectTargetFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  const redirect = params.get('redirect');
  if (redirect) return safeRedirectPath(redirect);
  const track = params.get('track');
  if (track) return safeRedirectPath(`/repl/${track}`);
  return DEFAULT_AFTER_LOGIN;
}
