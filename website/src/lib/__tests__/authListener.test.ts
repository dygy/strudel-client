/**
 * Finding 11: sign-out from another tab, or a refresh that failed, reaches this tab only as a
 * SIGNED_OUT event. Its unsaved text has to be protected before the user clears and the file manager
 * empties, and before the session cookie goes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const order: string[] = [];
let fire: (event: string) => Promise<void> = async () => {};

beforeAll(() => {
  vi.resetModules();
  vi.doMock('../supabase', () => ({
    supabase: {
      auth: {
        onAuthStateChange: (callback: (event: string, session: null) => Promise<void>) => {
          fire = (event) => callback(event, null);
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
      },
    },
  }));
  vi.doMock('../authCookies', () => ({ syncSessionCookies: () => order.push('cookie cleared') }));
  vi.doMock('../../stores/authStore', () => ({
    protectUnsavedWork: async () => order.push('protected'),
    authActions: {
      setUser: () => order.push('user cleared'),
      setSessionInfo: () => {},
      stopPeriodicCheck: () => {},
      startPeriodicCheck: () => {},
    },
  }));
});

afterAll(() => {
  vi.doUnmock('../supabase');
  vi.doUnmock('../authCookies');
  vi.doUnmock('../../stores/authStore');
  vi.resetModules();
});

describe('the auth listener', () => {
  it('protects unsaved work first on SIGNED_OUT', async () => {
    const { initializeAuthListener, cleanupAuthListener } = await import('../authListener');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    initializeAuthListener();
    await fire('SIGNED_OUT');
    expect(order).toEqual(['protected', 'cookie cleared', 'user cleared']);

    order.length = 0;
    await fire('TOKEN_REFRESHED');
    expect(order).not.toContain('protected');
    cleanupAuthListener();
    vi.restoreAllMocks();
  });
});
