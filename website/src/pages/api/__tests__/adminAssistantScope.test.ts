/**
 * @spec: 018-strudel-mcp-server (functional 2.12)
 * @regression
 * "When an admin connects an assistant, then it can reach only the admin's own library." An assistant's
 * writes come through these routes with the admin's own token, and being an admin changes nothing here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiContext,
  clearTestEnv,
  fakeState,
  insertedInto,
  mutationsOn,
  resetSupabaseFake,
  signIn,
  useTestEnv,
} from './apiTestHelpers';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isAdminSession, isAssistantToken } from '../../../lib/adminAuth';
import { GET as adminUsers } from '../admin/users';
import { DELETE as foldersDeleteAll } from '../folders/delete-all';
import { DELETE as tracksDeleteAll } from '../tracks/delete-all';
import { POST as trackCreate } from '../tracks/create';
import { PUT as trackUpdate } from '../tracks/update';
import { DELETE as trackDelete } from '../tracks/delete';
import { DELETE as folderDelete } from '../folders/delete';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const ADMIN = { id: 'admin-user', email: 'admin@example.test', app_metadata: { role: 'admin' } };
const TOKEN = 'eyJ.admin.token';
const V1 = '2026-11-03T00:09:28.401191+00:00';

const trackRow = (id: string, user_id: string) => ({
  id,
  user_id,
  name: id,
  code: `${id} code`,
  folder: null,
  updated_at: V1,
});
const context = (url: string, method: string, body: unknown) =>
  apiContext({ url: `http://test${url}`, method, token: TOKEN, body });

let spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  signIn(TOKEN, ADMIN);
  spies = ['log', 'error', 'warn'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  fakeState.tables.tracks = [trackRow('mine', ADMIN.id), trackRow('theirs', 'user-other')];
  fakeState.tables.folders = [{ id: 'f-theirs', name: 'F', path: 'F', user_id: 'user-other', updated_at: V1 }];
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

const stored = (id: string) => fakeState.tables.tracks.find((t) => t.id === id);

describe('an admin on the routes an assistant writes through', () => {
  it("changes the admin's own track", async () => {
    const response = await trackUpdate(
      context('/api/tracks/update', 'PUT', { trackId: 'mine', expectedVersion: V1, updates: { code: 'new' } }),
    );
    expect(response.status).toBe(200);
    expect(stored('mine')?.code).toBe('new');
  });

  it("creates in the admin's own library, whatever user the body names", async () => {
    const response = await trackCreate(
      context('/api/tracks/create', 'POST', { name: 'New', code: 'x', user_id: 'user-other' }),
    );
    expect(response.status).toBe(201);
    expect(insertedInto('tracks')[0].user_id).toBe(ADMIN.id);
  });

  it("gets 404 for another user's track, and changes nothing", async () => {
    const response = await trackUpdate(
      context('/api/tracks/update', 'PUT', {
        trackId: 'theirs',
        expectedVersion: V1,
        updates: { code: 'overwritten' },
      }),
    );
    expect(response.status).toBe(404);
    expect(stored('theirs')?.code).toBe('theirs code');
  });

  it("gets 404 when renaming another user's track", async () => {
    const response = await trackUpdate(
      context('/api/tracks/update', 'PUT', { trackId: 'theirs', updates: { name: 'overwritten' } }),
    );
    expect(response.status).toBe(404);
    expect(stored('theirs')?.name).toBe('theirs');
  });

  it("gets 404 deleting another user's track, always limited to the admin's own rows", async () => {
    const response = await trackDelete(
      context('/api/tracks/delete', 'DELETE', { trackId: 'theirs', expectedVersion: V1 }),
    );
    expect(response.status).toBe(404);
    expect(mutationsOn('tracks')[0].filters).toContainEqual(['user_id', ADMIN.id]);
  });

  it("gets 404 deleting another user's folder, and nothing is deleted", async () => {
    const response = await folderDelete(
      context('/api/folders/delete', 'DELETE', { folderId: 'f-theirs', expectedVersion: V1 }),
    );
    expect(response.status).toBe(404);
    expect(mutationsOn('folders')).toEqual([]);
  });
});

describe('an assistant holding an admin token, where RLS does not protect anyone', () => {
  const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const tokenWith = (claims: Record<string, unknown>) => `${base64url({ alg: 'ES256' })}.${base64url(claims)}.sig`;
  const ASSISTANT = tokenWith({ sub: ADMIN.id, client_id: 'c1' });
  const WEB = tokenWith({ sub: ADMIN.id });

  beforeEach(() => {
    signIn(ASSISTANT, ADMIN);
    signIn(WEB, ADMIN);
  });

  it('tells the two tokens apart', () => {
    expect(isAssistantToken(ASSISTANT)).toBe(true);
    expect(isAssistantToken(WEB)).toBe(false);
    expect(isAssistantToken('not a token')).toBe(false);
    expect(isAssistantToken(null)).toBe(false);
  });

  it('counts as an admin only when signed in as themselves', () => {
    expect(isAdminSession(ADMIN, WEB)).toBe(true);
    expect(isAdminSession(ADMIN, ASSISTANT)).toBe(false);
    expect(isAdminSession({ app_metadata: {} }, WEB)).toBe(false);
  });

  const adminList = (token: string) =>
    adminUsers(apiContext({ url: 'http://test/api/admin/users', method: 'GET', token }));

  it('GET /api/admin/users refuses an assistant', async () => {
    expect((await adminList(ASSISTANT)).status).toBe(403);
  });

  it('GET /api/admin/users still serves the admin', async () => {
    fakeState.authUsers = [];
    expect((await adminList(WEB)).status).toBe(200);
  });

  it.each([
    ['tracks', tracksDeleteAll, '/api/tracks/delete-all'],
    ['folders', foldersDeleteAll, '/api/folders/delete-all'],
  ])('deleting all %s refuses an assistant, and deletes nothing', async (table, route, url) => {
    const response = await route(apiContext({ url: `http://test${url}`, method: 'DELETE', token: ASSISTANT }));
    expect(response.status).toBe(403);
    expect(mutationsOn(table)).toEqual([]);
  });

  it('deleting all still works for the user themselves', async () => {
    const response = await tracksDeleteAll(
      apiContext({ url: 'http://test/api/tracks/delete-all', method: 'DELETE', token: WEB }),
    );
    expect(response.status).toBe(200);
  });

  it('every page and route that reads the service-role key for people checks this', () => {
    for (const file of ['pages/api/admin/users.ts', 'pages/admin.astro', 'pages/[userId]/repl/[...trackPath].astro']) {
      const source = readFileSync(resolve(process.cwd(), 'website/src', file), 'utf8');
      expect(`${file}: ${source.includes('isAdminSession(')}`).toBe(`${file}: true`);
      expect(`${file}: ${/\bisAdminUser\(/.test(source)}`).toBe(`${file}: false`);
    }
  });
});
