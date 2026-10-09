/**
 * Spec 015 §2.5 — admin view.
 * Units: `lib/adminAuth.ts` (`isAdmin`, `isAdminUser`) and `api/admin/users.ts` (GET).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiContext,
  clearTestEnv,
  fakeState,
  resetSupabaseFake,
  signIn,
  supabaseFake,
  useTestEnv,
} from './apiTestHelpers';
import { ADMIN_EMAIL, isAdmin, isAdminUser } from '../../../lib/adminAuth';
import { GET as listAdminUsers } from '../admin/users';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const URL_USERS = 'http://test/api/admin/users';
const ADMIN = { id: 'admin-id', email: ADMIN_EMAIL };
const NORMAL = { id: 'normal-id', email: 'listener@example.test' };

function swapCase(s: string): string {
  return [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
}

describe('isAdmin: only the exact admin address is admin', () => {
  it('accepts the exact admin address', () => {
    expect(isAdmin(ADMIN_EMAIL)).toBe(true);
    expect(isAdminUser({ email: ADMIN_EMAIL })).toBe(true);
  });

  it('refuses a capitalisation variant of the admin address', () => {
    expect(swapCase(ADMIN_EMAIL)).not.toBe(ADMIN_EMAIL);
    expect(isAdmin(ADMIN_EMAIL.toUpperCase())).toBe(false);
    expect(isAdmin(swapCase(ADMIN_EMAIL))).toBe(false);
    expect(isAdminUser({ email: ADMIN_EMAIL.toUpperCase() })).toBe(false);
  });

  it('refuses an address that differs in any other way', () => {
    expect(isAdmin(` ${ADMIN_EMAIL}`)).toBe(false);
    expect(isAdmin(`${ADMIN_EMAIL}.evil.test`)).toBe(false);
    expect(isAdmin('')).toBe(false);
  });

  it('refuses null and undefined', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser({})).toBe(false);
    expect(isAdminUser({ email: null })).toBe(false);
  });
});

describe('GET /api/admin/users: only the admin sees the overview', () => {
  let consoleSpy: { mockRestore: () => void };

  beforeEach(() => {
    resetSupabaseFake();
    useTestEnv();
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fakeState.authUsers = [
      { id: ADMIN.id, email: ADMIN.email, created_at: '2026-01-01T00:00:00Z' },
      { id: NORMAL.id, email: NORMAL.email, created_at: '2026-02-01T00:00:00Z' },
      { id: 'idle-id', email: 'idle@example.test', created_at: '2026-03-01T00:00:00Z' },
    ];
    fakeState.tables.tracks = [
      { user_id: NORMAL.id, modified: '2026-05-01T00:00:00Z' },
      { user_id: NORMAL.id, modified: '2026-06-01T00:00:00Z' },
      { user_id: ADMIN.id, modified: '2026-04-01T00:00:00Z' },
    ];
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    clearTestEnv();
  });

  function expectNoUserDataRead() {
    expect(supabaseFake.auth.admin.listUsers).not.toHaveBeenCalled();
    expect(supabaseFake.from).not.toHaveBeenCalledWith('tracks');
    expect(supabaseFake.from).not.toHaveBeenCalled();
  }

  it('refuses a signed-out request with 401 and reads no user data', async () => {
    const res = await listAdminUsers(apiContext({ url: URL_USERS }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).not.toHaveProperty('users');
    expectNoUserDataRead();
  });

  it('refuses an invalid token with 401 and reads no user data', async () => {
    const res = await listAdminUsers(apiContext({ url: URL_USERS, token: 'forged-token' }));
    expect(res.status).toBe(401);
    expect(await res.json()).not.toHaveProperty('users');
    expectNoUserDataRead();
  });

  it('refuses a normal account with 403 and never calls listUsers or from("tracks")', async () => {
    signIn('normal-token', NORMAL);
    const res = await listAdminUsers(apiContext({ url: URL_USERS, token: 'normal-token' }));
    expect(res.status).toBe(403);
    expect(await res.json()).not.toHaveProperty('users');
    expectNoUserDataRead();
  });

  it('refuses an account whose address is a capitalisation variant of the admin with 403', async () => {
    signIn('variant-token', { id: 'variant-id', email: ADMIN_EMAIL.toUpperCase() });
    const res = await listAdminUsers(apiContext({ url: URL_USERS, token: 'variant-token' }));
    expect(res.status).toBe(403);
    expectNoUserDataRead();
  });

  it('returns 200 with every user and their track counts for the admin', async () => {
    signIn('admin-token', ADMIN);
    const res = await listAdminUsers(apiContext({ url: URL_USERS, token: 'admin-token' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    const counts = Object.fromEntries(body.users.map((u: any) => [u.email, u.track_count]));
    expect(counts).toEqual({ [ADMIN.email]: 1, [NORMAL.email]: 2, 'idle@example.test': 0 });
    expect(supabaseFake.auth.admin.listUsers).toHaveBeenCalledTimes(1);
    expect(supabaseFake.from).toHaveBeenCalledWith('tracks');
  });
});
