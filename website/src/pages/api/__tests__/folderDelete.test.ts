/**
 * @spec: 018-strudel-mcp-server (functional 2.6; tech 2.5)
 * DELETE /api/folders/delete: one empty folder, naming the version it read; PUT /api/folders/update with
 * `expectedVersion`, where the check and the write are one statement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiContext,
  clearTestEnv,
  defaultFrom,
  fakeState,
  mutationsOn,
  resetSupabaseFake,
  signIn,
  supabaseFake,
  useTestEnv,
} from './apiTestHelpers';
import { DELETE as folderDelete } from '../folders/delete';
import { PUT as folderUpdate } from '../folders/update';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session' };
const TOKEN = 'eyJ.test.token';
const V1 = '2026-11-03T00:09:28.401191+00:00';
const V2 = '2026-11-03T00:09:30.000001+00:00';

const del = (body: unknown, token: string | undefined = TOKEN) =>
  folderDelete(apiContext({ url: 'http://test/api/folders/delete', method: 'DELETE', token, body }));
const put = (body: unknown) =>
  folderUpdate(apiContext({ url: 'http://test/api/folders/update', method: 'PUT', token: TOKEN, body }));

const folderRow = (id: string, name: string, path: string, parent: string | null = null, user_id = USER.id) => ({
  id,
  name,
  path,
  parent,
  user_id,
  updated_at: V1,
});
const trackRow = (id: string, name: string, folder: string | null, user_id = USER.id) => ({
  id,
  name,
  folder,
  user_id,
});

let spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  signIn(TOKEN, USER);
  spies = ['log', 'error', 'warn'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  fakeState.tables.folders = [folderRow('f1', 'Empty', 'Empty')];
  fakeState.tables.tracks = [];
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

describe('DELETE /api/folders/delete', () => {
  it('deletes an empty folder, with the version on the same statement as the delete', async () => {
    const res = await del({ folderId: 'f1', expectedVersion: V1 });
    expect(res.status).toBe(200);
    expect(mutationsOn('folders')).toHaveLength(1);
    expect(mutationsOn('folders')[0]).toMatchObject({ op: 'delete' });
    expect(mutationsOn('folders')[0].filters).toEqual([
      ['id', 'f1'],
      ['user_id', USER.id],
      ['updated_at', V1],
    ]);
  });

  it('requires sign-in', async () => {
    const res = await folderDelete(
      apiContext({ url: 'http://test/api/folders/delete', method: 'DELETE', body: { folderId: 'f1' } }),
    );
    expect(res.status).toBe(401);
  });

  it.each([
    ['no folder id', { expectedVersion: V1 }],
    ['no version', { folderId: 'f1' }],
    ['a version that is not a version', { folderId: 'f1', expectedVersion: 12 }],
  ])('refuses %s, and deletes nothing', async (_label, body) => {
    expect((await del(body)).status).toBe(400);
    expect(mutationsOn('folders')).toEqual([]);
  });

  it("answers 404 for a folder that doesn't exist and for someone else's, alike", async () => {
    fakeState.tables.folders.push(folderRow('theirs', 'Theirs', 'Theirs', null, 'user-other'));
    const theirs = await del({ folderId: 'theirs', expectedVersion: V1 });
    const absent = await del({ folderId: 'absent', expectedVersion: V1 });
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(await absent.json());
    expect(mutationsOn('folders')).toEqual([]);
  });

  it('refuses a stale version, with the current one', async () => {
    const res = await del({ folderId: 'f1', expectedVersion: V2 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'version_conflict', current: { version: V1 } });
    expect(mutationsOn('folders')).toEqual([]);
  });

  it('refuses a folder holding a track, by id or by the path older rows hold, and says what', async () => {
    fakeState.tables.tracks = [trackRow('t1', 'By id', 'f1'), trackRow('t2', 'By path', 'Empty')];
    const res = await del({ folderId: 'f1', expectedVersion: V1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'folder_not_empty',
      contents: { trackCount: 2, tracks: ['By id', 'By path'], folderCount: 0 },
    });
    expect(mutationsOn('folders')).toEqual([]);
  });

  it.each([
    ['by parent id', folderRow('f2', 'Sub', 'Elsewhere', 'f1')],
    ['by a parent path', folderRow('f2', 'Sub', 'Elsewhere', 'Empty')],
    ['by its own path', folderRow('f2', 'Sub', 'Empty/Sub')],
  ])('refuses a folder holding a folder %s', async (_label, sub) => {
    fakeState.tables.folders.push(sub);
    const res = await del({ folderId: 'f1', expectedVersion: V1 });
    expect(await res.json()).toMatchObject({
      code: 'folder_not_empty',
      contents: { folderCount: 1, folders: ['Sub'] },
    });
    expect(mutationsOn('folders')).toEqual([]);
  });

  it('takes a sibling sharing the start of its name for what it is', async () => {
    fakeState.tables.folders.push(folderRow('f2', 'Empty 2', 'Empty 2'));
    expect((await del({ folderId: 'f1', expectedVersion: V1 })).status).toBe(200);
  });

  it("is not stopped by someone else's track at the same path", async () => {
    fakeState.tables.tracks = [trackRow('t1', 'Theirs', 'Empty', 'user-other')];
    expect((await del({ folderId: 'f1', expectedVersion: V1 })).status).toBe(200);
  });

  it('asks the database for this folder only, so a large library can not hide a track', async () => {
    const from = vi.spyOn(supabaseFake, 'from');
    const builders: Array<{ table: string; builder: ReturnType<typeof defaultFrom> }> = [];
    from.mockImplementation((table: string) => {
      const builder = defaultFrom(table);
      builders.push({ table, builder });
      return builder;
    });
    await del({ folderId: 'f1', expectedVersion: V1 });
    const tracks = builders.find((entry) => entry.table === 'tracks');
    expect(tracks?.builder.in).toHaveBeenCalledWith('folder', ['f1', 'Empty']);
    from.mockReset();
    from.mockImplementation(defaultFrom);
  });

  it('answers version_conflict when another write gets in just before the delete', async () => {
    const from = vi.spyOn(supabaseFake, 'from');
    from.mockImplementation((table: string) => {
      const builder = defaultFrom(table);
      const startDelete = builder.delete;
      builder.delete = vi.fn(() => {
        fakeState.tables.folders[0].updated_at = V2;
        return startDelete();
      });
      return builder;
    });
    const res = await del({ folderId: 'f1', expectedVersion: V1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'version_conflict' });
    from.mockImplementation(defaultFrom);
  });
});

describe('PUT /api/folders/update with expectedVersion', () => {
  it('writes with the version on the same statement, and answers with what the database wrote', async () => {
    const res = await put({ folderId: 'f1', updates: { name: 'Renamed' }, expectedVersion: V1 });
    expect(res.status).toBe(200);
    const [update] = mutationsOn('folders');
    expect(update.filters).toEqual([
      ['id', 'f1'],
      ['user_id', USER.id],
      ['updated_at', V1],
    ]);
    const { folder } = (await res.json()) as { folder: { name: string } };
    expect(folder.name).toBe('Renamed');
  });

  it("answers with the trigger's version, not the time the route sent", async () => {
    const from = vi.spyOn(supabaseFake, 'from');
    from.mockImplementation((table: string) => {
      const builder = defaultFrom(table);
      const startUpdate = builder.update;
      builder.update = vi.fn((data: Record<string, unknown>) => startUpdate({ ...data, updated_at: V2 }));
      return builder;
    });
    const res = await put({ folderId: 'f1', updates: { name: 'Renamed' }, expectedVersion: V1 });
    const { folder } = (await res.json()) as { folder: { updated_at: string } };
    expect(folder.updated_at).toBe(V2);
    from.mockImplementation(defaultFrom);
  });

  it('refuses a stale version with the current one, and writes nothing', async () => {
    const res = await put({ folderId: 'f1', updates: { name: 'Renamed' }, expectedVersion: V2 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'version_conflict', current: { version: V1 } });
    expect(mutationsOn('folders')).toEqual([]);
  });

  it('touches nothing further when another write gets in just before its own', async () => {
    fakeState.tables.folders.push(folderRow('f2', 'Child', 'Empty/Child', 'f1'));
    fakeState.failUpdate = (table) => {
      if (table === 'folders') fakeState.tables.folders[0].updated_at = V2;
      return null;
    };
    const res = await put({ folderId: 'f1', updates: { name: 'Renamed' }, expectedVersion: V1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'version_conflict' });
    expect(mutationsOn('folders')).toHaveLength(1);
    expect(fakeState.tables.folders.map((f) => f.path)).toEqual(['Empty', 'Empty/Child']);
  });

  it('refuses something that is not a version', async () => {
    const res = await put({ folderId: 'f1', updates: { name: 'x' }, expectedVersion: 12 });
    expect(res.status).toBe(400);
  });

  it('writes as it always did with no version, as the sidebar sends none', async () => {
    const res = await put({ folderId: 'f1', updates: { name: 'Renamed' } });
    expect(res.status).toBe(200);
    expect(mutationsOn('folders')[0].filters).toEqual([
      ['id', 'f1'],
      ['user_id', USER.id],
    ]);
  });
});
