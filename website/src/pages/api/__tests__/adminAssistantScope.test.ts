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
