/**
 * Spec 015 §2.5 — admin view.
 * Units: `lib/adminAuth.ts` (`isAdminUser`) and `api/admin/users.ts` (GET).
 *
 * Admin is the `app_metadata.role` only the service role can set — never the address (it used to be
 * one hardcoded email, 2026-10-30) and never `user_metadata`, which users can write themselves.
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
import { isAdminUser } from '../../../lib/adminAuth';
import { GET as listAdminUsers } from '../admin/users';
import { GET as authUser } from '../auth/user';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const URL_USERS = 'http://test/api/admin/users';
const ADMIN_ADDRESS = 'owner@example.test';
const ADMIN = { id: 'admin-id', email: ADMIN_ADDRESS, app_metadata: { role: 'admin' } };
const NORMAL = { id: 'normal-id', email: 'listener@example.test' };

describe('isAdminUser: only app_metadata.role "admin" is admin', () => {
  it('accepts the admin role', () => {
    expect(isAdminUser({ app_metadata: { role: 'admin' } })).toBe(true);
    expect(isAdminUser({ app_metadata: { provider: 'google', role: 'admin' } })).toBe(true);
  });

  it('refuses any other role value', () => {
    for (const role of ['Admin', 'ADMIN', ' admin', 'admin ', 'administrator', '', true, 1, ['admin'], null]) {
      expect(isAdminUser({ app_metadata: { role } })).toBe(false);
    }
  });

  it('refuses users without the role, whatever their address or user_metadata', () => {
    expect(isAdminUser({ app_metadata: { provider: 'google' } })).toBe(false);
    expect(isAdminUser({ app_metadata: null })).toBe(false);
    expect(isAdminUser({ email: ADMIN_ADDRESS, user_metadata: { role: 'admin' } } as never)).toBe(false);
    expect(isAdminUser({})).toBe(false);
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
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

  it('refuses an account with the admin address but no admin role with 403', async () => {
    signIn('variant-token', { id: 'variant-id', email: ADMIN_ADDRESS });
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

describe('GET /api/auth/user: isAdmin follows the role (shows the admin link only)', () => {
  beforeEach(() => {
    resetSupabaseFake();
    useTestEnv();
  });
  afterEach(() => clearTestEnv());

  const userFor = async (token: string) =>
    (await (await authUser(apiContext({ url: 'http://test/api/auth/user', token }))).json()).user;

  it('is true for the admin role and false otherwise', async () => {
    signIn('eyJ.admin.token', ADMIN);
    signIn('eyJ.normal.token', NORMAL);
    signIn('eyJ.address.token', { id: 'address-id', email: ADMIN_ADDRESS });

    expect((await userFor('eyJ.admin.token')).isAdmin).toBe(true);
    expect((await userFor('eyJ.normal.token')).isAdmin).toBe(false);
    expect((await userFor('eyJ.address.token')).isAdmin).toBe(false);
  });
});
