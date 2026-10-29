/**
 * Session expiry fix, server side.
 *
 * 1. /api/auth/user must accept `Authorization: Bearer <token>`: the client refreshes its own
 *    session and sends the fresh token, while the cookie copy may already be expired.
 *    Regression: it read the cookie only, so an expired cookie meant `{ user: null }` and the
 *    periodic auth check redirected a still-signed-in user to /login.
 * 2. No server route may refresh: refresh tokens are single-use and the browser supabase client is
 *    the only refresh owner. A server-side refreshSession/setSession with a cookie copy revokes the
 *    client's token and signs the user out. An expired token answers "not signed in" / 401 instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiContext,
  clearTestEnv,
  createClientMock,
  resetSupabaseFake,
  defaultFrom,
  signIn,
  supabaseFake,
  useTestEnv,
} from './apiTestHelpers';

import { GET as authUser } from '../auth/user';
import { GET as authStatus } from '../auth/status';
import { POST as authRefresh } from '../auth/refresh';
import { GET as filesystemTree } from '../filesystem/tree';
import { DELETE as trackDelete } from '../tracks/delete';
import { GET as treeStats } from '../tree/stats';
import { POST as trackCreate } from '../tracks/create';
import { PUT as trackUpdate } from '../tracks/update';
import { PUT as folderUpdate } from '../folders/update';
import { GET as authCallback } from '../auth/callback';

// The real error classes: auth-js getUser RETURNS these (it doesn't throw) on network errors / 5xx.
const { AuthRetryableFetchError, AuthApiError } =
  await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session', email: 'someone@example.test' };
const FRESH = 'eyJ.fresh.token';
const EXPIRED = 'eyJ.expired.token';
const url = 'http://test/api/route';

// Spies the shared fake doesn't have; attached for this file only and removed afterwards.
type AuthWithRefresh = typeof supabaseFake.auth & {
  refreshSession?: ReturnType<typeof vi.fn>;
  setSession?: ReturnType<typeof vi.fn>;
};
const auth = supabaseFake.auth as AuthWithRefresh;
const rotatedSession = {
  data: { session: { access_token: 'eyJ.rotated.token', refresh_token: 'r2', user: USER }, user: USER },
  error: null,
};

/** A request with an expired cookie, a legacy refresh cookie and (optionally) a Bearer token. */
function call<H extends (ctx: never) => unknown>(
  handler: H,
  method: string,
  bearer?: string,
  body?: unknown,
  cookieToken: string = EXPIRED,
) {
  const ctx = apiContext({ url, method, token: cookieToken, body });
  ctx.request.headers.set('cookie', `sb-access-token=${cookieToken}; sb-refresh-token=r1`);
  if (bearer) ctx.request.headers.set('authorization', `Bearer ${bearer}`);
  // sb-user too: the old /api/auth/status only reached its refresh path when all three were set.
  const jar: Record<string, string> = {
    'sb-access-token': cookieToken,
    'sb-refresh-token': 'r1',
    'sb-user': JSON.stringify(USER),
  };
  ctx.cookies = {
    get: (k: string) => (k in jar ? { value: jar[k] } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  };
  return (handler as unknown as (c: typeof ctx) => Promise<Response>)(ctx);
}

let consoleSpies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  auth.refreshSession = vi.fn(async () => rotatedSession);
  auth.setSession = vi.fn(async () => rotatedSession);
  signIn(FRESH, USER);
  consoleSpies = ['log', 'error', 'warn'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
});

afterEach(() => {
  delete auth.refreshSession;
  delete auth.setSession;
  consoleSpies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

function expectNoServerRefresh() {
  expect(auth.refreshSession).not.toHaveBeenCalled();
  expect(auth.setSession).not.toHaveBeenCalled();
}

describe('GET /api/auth/user', () => {
  it('accepts a valid Authorization: Bearer token even when the cookie is expired', async () => {
    const res = await call(authUser, 'GET', FRESH);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.user).toMatchObject({ id: USER.id, email: USER.email });
    expect(supabaseFake.auth.getUser).toHaveBeenCalledWith(FRESH);
  });

  it('an expired token answers 200 { user: null } and refreshes nothing', async () => {
    const res = await call(authUser, 'GET');

    expect(res.status).toBe(200);
    expect((await res.json()).user).toBeNull();
    expectNoServerRefresh();
  });

  // Real supabase-js behaviour: getUser returns { data: { user: null }, error } on a network error
  // or a 5xx; it doesn't throw. That is not a sign-out: the client treats 500 as "unknown".
  it.each([
    ['network failure (AuthRetryableFetchError, status 0)', () => new AuthRetryableFetchError('fetch failed', 0)],
    ['gateway timeout (AuthRetryableFetchError, 504)', () => new AuthRetryableFetchError('Gateway Timeout', 504)],
    ['auth service 500 (AuthApiError)', () => new AuthApiError('Internal Server Error', 500, 'unexpected_failure')],
  ])('a transient auth-service failure is a 500, not { user: null }: %s', async (_name, makeError) => {
    supabaseFake.auth.getUser.mockImplementationOnce(async () => ({ data: { user: null }, error: makeError() }));

    const res = await call(authUser, 'GET', FRESH);

    expect(res.status).toBe(500);
    expect((await res.json()).user).toBeNull();
  });

  it('a real invalid token (AuthApiError 403 bad_jwt) is still { user: null }', async () => {
    supabaseFake.auth.getUser.mockImplementationOnce(async () => ({
      data: { user: null },
      error: new AuthApiError('invalid JWT: token is expired', 403, 'bad_jwt'),
    }));

    const res = await call(authUser, 'GET', FRESH);

    expect(res.status).toBe(200);
    expect((await res.json()).user).toBeNull();
  });

  it('self-heals the cookie: a valid Bearer that differs from the cookie answers with Set-Cookie', async () => {
    const res = await call(authUser, 'GET', FRESH);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^sb-access-token=eyJ\.fresh\.token; /);
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toMatch(/Max-Age=\d+/);
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toMatch(/HttpOnly/i);
  });

  it('no Set-Cookie when the cookie already holds the Bearer token', async () => {
    const res = await call(authUser, 'GET', FRESH, undefined, FRESH);

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

// Routes map auth failures by type (AuthError -> 401, else 500). A transient auth-service failure
// must be a 500, not a 401 (which tells the client its session is gone).
describe.each([
  { name: 'GET tree/stats', handler: treeStats, method: 'GET', body: undefined },
  { name: 'POST tracks/create', handler: trackCreate, method: 'POST', body: { name: 'Beat', code: 's("bd")' } },
  { name: 'PUT tracks/update', handler: trackUpdate, method: 'PUT', body: { trackId: 't1', updates: { code: 'x' } } },
  {
    name: 'PUT folders/update',
    handler: folderUpdate,
    method: 'PUT',
    body: { folderId: 'f1', updates: { name: 'D' } },
  },
  { name: 'DELETE tracks/delete', handler: trackDelete, method: 'DELETE', body: { trackId: 't1' } },
])('$name: auth-service outage', ({ handler, method, body }) => {
  it('answers 500, not 401, when getUser returns AuthRetryableFetchError', async () => {
    supabaseFake.auth.getUser.mockImplementationOnce(async () => ({
      data: { user: null },
      error: new AuthRetryableFetchError('fetch failed', 0),
    }));

    const res = await call(handler, method, FRESH, body);

    expect(res.status).toBe(500);
  });
});

describe('no server route refreshes the session', () => {
  it('GET /api/auth/status only validates: expired -> not authenticated, no refresh', async () => {
    const res = await call(authStatus, 'GET');

    expect(res.status).toBe(200);
    expect((await res.json()).authenticated).toBe(false);
    expectNoServerRefresh();
  });

  it('GET /api/auth/status accepts a valid Bearer token', async () => {
    const res = await call(authStatus, 'GET', FRESH);

    expect((await res.json()).authenticated).toBe(true);
    expectNoServerRefresh();
  });

  it('POST /api/auth/refresh: expired -> 401 (the client refreshes and retries), no refresh', async () => {
    const res = await call(authRefresh, 'POST');

    expect(res.status).toBe(401);
    expectNoServerRefresh();
  });

  it('GET /api/filesystem/tree: expired -> 401, no setSession', async () => {
    const res = await call(filesystemTree, 'GET');

    expect(res.status).toBe(401);
    expectNoServerRefresh();
  });

  it('GET /api/filesystem/tree: a valid Bearer token queries as that user, with no shared session', async () => {
    supabaseFake.from.mockImplementation((table: string) => {
      const builder = defaultFrom(table);
      builder.order = vi.fn(() => builder);
      return builder;
    });
    try {
      const res = await call(filesystemTree, 'GET', FRESH);

      expect(res.status).toBe(200);
      expectNoServerRefresh();
      const options = createClientMock.mock.calls.at(-1)?.[2] as { global?: { headers?: Record<string, string> } };
      expect(options?.global?.headers?.Authorization).toBe(`Bearer ${FRESH}`);
    } finally {
      supabaseFake.from.mockImplementation(defaultFrom);
    }
  });

  it('DELETE /api/tracks/delete: expired -> 401, no setSession fallback', async () => {
    const res = await call(trackDelete, 'DELETE', undefined, { trackId: 't1' });

    expect(res.status).toBe(401);
    expectNoServerRefresh();
  });
});

// Unused route, but it must not plant an httpOnly access-token cookie: the browser client rewrites
// that cookie on every refresh and document.cookie can't overwrite an httpOnly one.
describe('GET /api/auth/callback (server-side code exchange)', () => {
  type AuthWithExchange = typeof supabaseFake.auth & { exchangeCodeForSession?: ReturnType<typeof vi.fn> };
  const exchangeAuth = supabaseFake.auth as AuthWithExchange;

  afterEach(() => {
    delete exchangeAuth.exchangeCodeForSession;
  });

  function callbackCall(query: string) {
    const set = vi.fn();
    const ctx = {
      url: new URL(`http://test/api/auth/callback?${query}`),
      cookies: { set, get: () => undefined, delete: vi.fn() },
      redirect: (path: string) => new Response(null, { status: 302, headers: { Location: path } }),
    };
    exchangeAuth.exchangeCodeForSession = vi.fn(async () => ({
      data: { session: { access_token: FRESH, refresh_token: 'r-secret', user: { ...USER, user_metadata: {} } } },
      error: null,
    }));
    const handler = authCallback as unknown as (c: typeof ctx) => Promise<Response>;
    return { set, run: () => handler(ctx) };
  }

  it('sets a non-httpOnly access-token cookie and no refresh-token cookie', async () => {
    const { set, run } = callbackCall('code=abc');

    await run();

    const access = set.mock.calls.find(([name]) => name === 'sb-access-token');
    expect(access?.[1]).toBe(FRESH);
    expect(access?.[2]).toMatchObject({ httpOnly: false, secure: true, sameSite: 'lax', path: '/' });
    expect(set.mock.calls.some(([name]) => name === 'sb-refresh-token')).toBe(false);
  });

  it('never redirects off-site through ?state=', async () => {
    const { run } = callbackCall(`code=abc&state=${encodeURIComponent('https://evil.test/?track=1')}`);

    const res = await run();

    expect(res.headers.get('Location')).toBe('/repl');
  });
});
