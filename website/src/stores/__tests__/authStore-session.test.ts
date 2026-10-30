/**
 * Session expiry must not sign out a user whose browser session is still valid.
 *
 * Regression: authStore.checkAuth asked /api/auth/user with the cookie alone. The cookie copy of
 * the access token expires after ~1 h (and the server can't refresh it), so the periodic check got
 * `{ user: null }` and redirected to /login mid-session, even though supabase-js still held a valid,
 * refreshable session. The check now refreshes the client session first, sends it as a Bearer
 * token, and only redirects (back to the same page) when the client has no session either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FRESH = 'eyJ.fresh.token';
const STALE_COOKIE = 'eyJ.expired.cookie';
const USER = { id: 'u1', email: 'someone@example.test', name: 'Someone' };

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    refreshSession: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
  },
}));

vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock, auth: supabaseMock.auth }));

// isolate:false shares the module cache across files: a file that ran earlier (e.g. the sidebar
// hook tests) may already hold authStore bound to the real supabase client, so the mock above
// would not apply. Load a fresh copy.
vi.resetModules();
const { authActions, authStore } = await import('../authStore');

type FetchInit = { headers?: Record<string, string> };
let cookieWrites: string[];
let fetchMock: ReturnType<typeof vi.fn>;
let location: { pathname: string; search: string; href: string };

/** The server: accepts only the fresh token, from the Bearer header (the cookie is expired). */
function serverAcceptingFreshBearer() {
  return vi.fn(async (_url: string, init?: FetchInit) => {
    const auth = init?.headers?.Authorization;
    const user = auth === `Bearer ${FRESH}` ? USER : null;
    return new Response(JSON.stringify(user ? { user, sessionExpiresAt: null } : { user: null }), { status: 200 });
  });
}

function clientSession(expiresInSeconds: number) {
  return {
    access_token: FRESH,
    refresh_token: 'r1',
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    user: { id: USER.id },
  };
}

beforeEach(() => {
  cookieWrites = [];
  location = { pathname: '/repl/drums/beat', search: '?x=1', href: 'http://test/repl/drums/beat?x=1' };
  const doc = { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() };
  Object.defineProperty(doc, 'cookie', {
    get: () => `sb-access-token=${STALE_COOKIE}`,
    set: (v: string) => cookieWrites.push(v),
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { location, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  fetchMock = serverAcceptingFreshBearer();
  vi.stubGlobal('fetch', fetchMock);
  supabaseMock.auth.getSession.mockReset();
  supabaseMock.auth.refreshSession.mockReset();
  authStore.set({ user: USER, loading: false, sessionExpiresAt: null, sessionWarning: false });
  ['log', 'warn', 'error'].forEach((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('authStore.checkAuth with an expired session cookie', () => {
  it('stays signed in when the client session is valid: sends it as Bearer and does not redirect', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: clientSession(3600) }, error: null });

    await expect(authActions.checkAuth()).resolves.toBe(true);

    const init = fetchMock.mock.calls[0][1] as FetchInit;
    expect(init.headers?.Authorization).toBe(`Bearer ${FRESH}`);
    expect(location.href).toBe('http://test/repl/drums/beat?x=1');
    expect(authStore.get().user).toEqual(USER);
    // The cookie is rewritten with the client's token; the refresh token is never mirrored.
    expect(cookieWrites.some((c) => c.startsWith(`sb-access-token=${encodeURIComponent(FRESH)};`))).toBe(true);
    expect(cookieWrites.some((c) => c.startsWith('sb-refresh-token=r1'))).toBe(false);
  });

  it('refreshes a client session that is about to expire before asking the server', async () => {
    const expiring = { ...clientSession(30), access_token: 'eyJ.old.token' };
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: expiring }, error: null });
    supabaseMock.auth.refreshSession.mockResolvedValue({ data: { session: clientSession(3600) }, error: null });

    await expect(authActions.checkAuth()).resolves.toBe(true);

    expect(supabaseMock.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as FetchInit).headers?.Authorization).toBe(`Bearer ${FRESH}`);
    expect(location.href).toBe('http://test/repl/drums/beat?x=1');
  });

  it('keeps the user when the client refresh fails transiently (offline), instead of signing out', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: clientSession(30) }, error: null });
    supabaseMock.auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'fetch failed' } });

    await expect(authActions.checkAuth()).resolves.toBe(true);

    expect(location.href).toBe('http://test/repl/drums/beat?x=1');
    expect(authStore.get().user).toEqual(USER);
  });

  it('really signed out (no client session, server agrees): redirects to /login and keeps the page in ?redirect=', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(authActions.checkAuth()).resolves.toBe(false);

    expect(location.href).toBe('/login?redirect=%2Frepl%2Fdrums%2Fbeat%3Fx%3D1');
    expect(authStore.get().user).toBeNull();
  });

  it('a network error keeps the user signed in', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: clientSession(3600) }, error: null });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(authActions.checkAuth()).resolves.toBe(true);

    expect(location.href).toBe('http://test/repl/drums/beat?x=1');
    expect(authStore.get().user).toEqual(USER);
  });

  it('a transient server failure (500: Supabase unreachable) with a valid Bearer keeps the user, no redirect', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: clientSession(3600) }, error: null });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ user: null, error: 'x' }), { status: 500 }));

    await expect(authActions.checkAuth()).resolves.toBe(true);

    expect((fetchMock.mock.calls[0][1] as FetchInit).headers?.Authorization).toBe(`Bearer ${FRESH}`);
    expect(location.href).toBe('http://test/repl/drums/beat?x=1');
    expect(authStore.get().user).toEqual(USER);
    // An outage says nothing about the token: no forced refresh, no retry storm.
    expect(supabaseMock.auth.refreshSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Clock skew: the local clock runs slow, so the client thinks its token has an hour left and
  // ensureValidSession doesn't refresh, but the server already sees it as expired.
  it('clock skew: server rejects a token the client thinks is valid -> one forced refresh, retry, stays signed in', async () => {
    const skewed = { ...clientSession(3600), access_token: 'eyJ.skewed.token' };
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: skewed }, error: null });
    supabaseMock.auth.refreshSession.mockResolvedValue({ data: { session: clientSession(3600) }, error: null });

    await expect(authActions.checkAuth()).resolves.toBe(true);

    expect(supabaseMock.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][1] as FetchInit).headers?.Authorization).toBe(`Bearer ${FRESH}`);
    expect(cookieWrites.some((c) => c.startsWith(`sb-access-token=${encodeURIComponent(FRESH)};`))).toBe(true);
    expect(location.href).toBe('http://test/repl/drums/beat?x=1');
  });

  it('clock skew, forced refresh fails transiently (offline): keeps the user', async () => {
    const skewed = { ...clientSession(3600), access_token: 'eyJ.skewed.token' };
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: skewed }, error: null });
    supabaseMock.auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 },
    });

    await expect(authActions.checkAuth()).resolves.toBe(true);

    expect(location.href).toBe('http://test/repl/drums/beat?x=1');
  });

  it('server rejects and the refresh token is revoked (4xx): really signed out, redirect keeps the page', async () => {
    const skewed = { ...clientSession(3600), access_token: 'eyJ.revoked.token' };
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: skewed }, error: null });
    supabaseMock.auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthApiError', message: 'Invalid Refresh Token: Refresh Token Not Found', status: 400 },
    });

    await expect(authActions.checkAuth()).resolves.toBe(false);

    expect(location.href).toBe('/login?redirect=%2Frepl%2Fdrums%2Fbeat%3Fx%3D1');
  });

  it('overlapping checks (interval + tab resume) share one request', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: clientSession(3600) }, error: null });

    await Promise.all([authActions.checkAuth(), authActions.checkAuth()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
