/**
 * Every user route queries as the signed-in user: anon key + that user's Bearer token, so RLS
 * applies. A client without the token would pass every fake-backed test while RLS turned each
 * autosave into "0 rows updated" (404) on prod — this pins the client per route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiContext,
  clearTestEnv,
  createClientMock,
  fakeState,
  resetSupabaseFake,
  signIn,
  useTestEnv,
} from './apiTestHelpers';
import { GET as tracksList } from '../tracks/list';
import { POST as trackCreate } from '../tracks/create';
import { PUT as trackUpdate } from '../tracks/update';
import { DELETE as trackDelete } from '../tracks/delete';
import { DELETE as tracksDeleteAll } from '../tracks/delete-all';
import { GET as foldersList } from '../folders/list';
import { POST as folderCreate } from '../folders/create';
import { PUT as folderUpdate } from '../folders/update';
import { DELETE as foldersDeleteAll } from '../folders/delete-all';
import { POST as batchImport } from '../library/batch-import';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session' };
const TOKEN = 'eyJ.user.token';

const routes = [
  { name: 'GET tracks/list', handler: tracksList, method: 'GET' },
  { name: 'POST tracks/create', handler: trackCreate, method: 'POST', body: { name: 'New', code: '' } },
  {
    name: 'PUT tracks/update (code save)',
    handler: trackUpdate,
    method: 'PUT',
    body: { trackId: 't1', updates: { code: 'x' } },
  },
  { name: 'DELETE tracks/delete', handler: trackDelete, method: 'DELETE', body: { trackId: 't1' } },
  { name: 'DELETE tracks/delete-all', handler: tracksDeleteAll, method: 'DELETE' },
  { name: 'GET folders/list', handler: foldersList, method: 'GET' },
  { name: 'POST folders/create', handler: folderCreate, method: 'POST', body: { id: 'newF', name: 'New' } },
  {
    name: 'PUT folders/update',
    handler: folderUpdate,
    method: 'PUT',
    body: { folderId: 'f1', updates: { name: 'Renamed' } },
  },
  { name: 'DELETE folders/delete-all', handler: foldersDeleteAll, method: 'DELETE' },
  { name: 'POST library/batch-import', handler: batchImport, method: 'POST', body: { tracks: [{ name: 'a' }] } },
] as const;

let spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  signIn(TOKEN, USER);
  spies = ['log', 'error', 'warn'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  fakeState.tables.tracks = [{ id: 't1', name: 'mine', code: '', folder: null, user_id: USER.id }];
  fakeState.tables.folders = [{ id: 'f1', name: 'Mine', path: 'Mine', parent: null, user_id: USER.id }];
  createClientMock.mockClear();
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

describe.each(routes)('$name', (route) => {
  it("queries with the anon key and the user's token, never the service-role key", async () => {
    const res = await route.handler(
      apiContext({
        url: 'http://test/api/x',
        method: route.method,
        token: TOKEN,
        body: 'body' in route ? route.body : undefined,
      }),
    );
    expect(res.status).toBeLessThan(400);

    const calls = createClientMock.mock.calls as unknown as Array<[string, string, any]>;
    expect(calls.some(([, key]) => key === 'test-service')).toBe(false);
    expect(
      calls.some(([, key, o]) => key === 'test-anon' && o?.global?.headers?.Authorization === `Bearer ${TOKEN}`),
    ).toBe(true);
  });
});
