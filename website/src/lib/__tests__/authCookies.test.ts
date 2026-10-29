/**
 * The server reads the access token from the `sb-access-token` cookie (SSR pages, /api fallback),
 * but only the browser supabase client refreshes the session. Every auth event must therefore
 * rewrite the cookie with the new access token (TOKEN_REFRESHED especially, or the cookie expires
 * an hour after sign-in), clear it on SIGNED_OUT, and never mirror the single-use refresh token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AuthCallback = (event: string, session: { access_token: string; refresh_token: string } | null) => unknown;

const supabaseMock = vi.hoisted(() => {
  const state: { callback: AuthCallback | null } = { callback: null };
  return {
    state,
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      refreshSession: vi.fn(),
      onAuthStateChange: vi.fn((cb: AuthCallback) => {
        state.callback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      }),
    },
  };
});

vi.mock('../supabase', () => ({ supabase: { auth: supabaseMock.auth }, auth: supabaseMock.auth }));

import { cleanupAuthListener, initializeAuthListener } from '../authListener';

let cookieWrites: string[];

function emit(event: string, session: { access_token: string; refresh_token: string } | null) {
  if (!supabaseMock.state.callback) throw new Error('auth listener not registered');
  return supabaseMock.state.callback(event, session);
}

beforeEach(() => {
  cookieWrites = [];
  const doc = {};
  Object.defineProperty(doc, 'cookie', { get: () => '', set: (v: string) => cookieWrites.push(v) });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { location: { pathname: '/repl', search: '', href: 'http://test/repl' } });
  ['log', 'warn', 'error'].forEach((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  initializeAuthListener();
});

afterEach(() => {
  cleanupAuthListener();
  supabaseMock.state.callback = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('auth listener keeps the session cookie in step with supabase-js', () => {
  it('TOKEN_REFRESHED rewrites the access-token cookie with the new token', async () => {
    await emit('TOKEN_REFRESHED', { access_token: 'eyJ.new.token', refresh_token: 'r2' });

    const access = cookieWrites.filter((c) => c.startsWith('sb-access-token='));
    expect(access).toHaveLength(1);
    expect(access[0]).toMatch(/^sb-access-token=eyJ\.new\.token; path=\/; max-age=\d+;/);
  });

  it('never mirrors the refresh token; a legacy refresh cookie is deleted', async () => {
    await emit('SIGNED_IN', { access_token: 'eyJ.a.b', refresh_token: 'r-secret' });

    expect(cookieWrites.some((c) => c.includes('r-secret'))).toBe(false);
    expect(cookieWrites).toContainEqual(expect.stringMatching(/^sb-refresh-token=; path=\/; max-age=0;/));
  });

  it('SIGNED_OUT clears the session cookie', async () => {
    await emit('SIGNED_OUT', null);

    expect(cookieWrites).toContainEqual(expect.stringMatching(/^sb-access-token=; path=\/; max-age=0;/));
  });

  it('INITIAL_SESSION (page load with a stored session) rewrites the cookie too', async () => {
    await emit('INITIAL_SESSION', { access_token: 'eyJ.restored.token', refresh_token: 'r3' });

    expect(cookieWrites).toContainEqual(expect.stringMatching(/^sb-access-token=eyJ\.restored\.token;/));
  });
});
