/**
 * /auth/callback (scripts/authCallback.ts) sends the user back to where they came from, but only
 * to a same-site path: the stored redirect goes through safeRedirectPath. It mirrors only the
 * access token into the cookie, never the single-use refresh token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabaseClient', () => ({
  createSupabaseClient: () => ({ auth: { getSession } }),
}));

let location: { href: string };
let cookieWrites: string[];
let stored: Map<string, string>;

async function runCallback(storedRedirect: string | null) {
  if (storedRedirect !== null) stored.set('strudel_redirect_after_auth', storedRedirect);
  vi.resetModules();
  await import('../authCallback');
  await vi.advanceTimersByTimeAsync(1500);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  location = { href: 'http://test/auth/callback' };
  cookieWrites = [];
  stored = new Map();
  const doc = {};
  Object.defineProperty(doc, 'cookie', { get: () => '', set: (v: string) => cookieWrites.push(v) });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { location });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
  });
  getSession.mockResolvedValue({
    data: { session: { access_token: 'eyJ.a.b', refresh_token: 'r-secret', user: { id: 'u1' }, expires_at: 1 } },
    error: null,
  });
  ['log', 'warn', 'error'].forEach((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('auth callback redirect', () => {
  it('returns to the stored same-site path', async () => {
    await runCallback('/repl/drums/beat');

    expect(location.href).toBe('/repl/drums/beat');
    expect(stored.has('strudel_redirect_after_auth')).toBe(false);
  });

  it.each(['https://evil.test/phish', '//evil.test/phish', '/login?redirect=%2Frepl'])(
    'refuses a stored redirect to %s and goes to /repl',
    async (raw) => {
      await runCallback(raw);

      expect(location.href).toBe('/repl');
    },
  );

  it('mirrors only the access token into the cookie', async () => {
    await runCallback(null);

    expect(cookieWrites).toContainEqual(expect.stringMatching(/^sb-access-token=eyJ\.a\.b;/));
    expect(cookieWrites.some((c) => c.includes('r-secret'))).toBe(false);
  });
});
