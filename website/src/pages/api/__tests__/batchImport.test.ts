/**
 * POST /api/library/batch-import (ZIP import): folder placement and all-or-nothing saving.
 * Regression (2026-10-30): a subfolder of a folder that already existed was saved with
 * `parent: null` (existing folders were added to the path→id map only after it was used), a
 * folder named like an existing sibling ("drums" next to "Drums") became a twin sharing its URL,
 * a bad item was found only after the folders were saved, and a failed track insert left the new
 * folders behind while the route still answered success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiContext,
  clearTestEnv,
  createClientMock,
  defaultFrom,
  fakeState,
  InList,
  insertedInto,
  mutationsOn,
  resetSupabaseFake,
  signIn,
  supabaseFake,
  useTestEnv,
} from './apiTestHelpers';
import { POST as batchImport } from '../library/batch-import';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session' };
const TOKEN = 'eyJ.test.token';

const post = (body: unknown) =>
  batchImport(apiContext({ url: 'http://test/api/library/batch-import', method: 'POST', token: TOKEN, body }));

const created = (path: string) => insertedInto('folders').find((f) => f.path === path);

let spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  signIn(TOKEN, USER);
  spies = ['log', 'error', 'warn'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  fakeState.tables.folders = [{ id: 'f-live', name: 'Live', path: 'Live', parent: null, user_id: USER.id }];
  fakeState.tables.tracks = [];
  createClientMock.mockClear();
});

afterEach(() => {
  supabaseFake.from.mockImplementation(defaultFrom);
  spies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

describe('batch-import: folder placement', () => {
  it('a subfolder of an existing folder is stored under it, by id', async () => {
    expect((await post({ folders: [{ name: 'Drums', path: 'Live/Drums', parent: 'Live' }] })).status).toBe(200);
    expect(created('Live/Drums')).toMatchObject({ name: 'Drums', parent: 'f-live' });
  });

  it('creates missing ancestors, each under its parent id', async () => {
    await post({ folders: [{ name: 'Kicks', path: 'Set/Drums/Kicks' }] });
    const set = created('Set')!;
    const drums = created('Set/Drums')!;
    expect(set.parent).toBeNull();
    expect(drums.parent).toBe(set.id);
    expect(created('Set/Drums/Kicks')!.parent).toBe(drums.id);
  });

  it.each([
    ['the same name in another case', 'live'],
    ['a name with the same URL slug', 'Live!'],
  ])('reuses an existing sibling with %s instead of creating a twin', async (_l, name) => {
    await post({ folders: [{ path: `${name}/Pads` }], tracks: [{ name: 'a', folder: name }] });
    expect(insertedInto('folders').map((f) => f.path)).toEqual(['Live/Pads']);
    expect(created('Live/Pads')!.parent).toBe('f-live');
    expect(insertedInto('tracks')[0].folder).toBe('f-live');
  });

  it('stores tracks with the id of their (new) folder', async () => {
    await post({ folders: [{ path: 'Set' }], tracks: [{ name: 'a', code: 'x', folder: 'Set' }] });
    expect(insertedInto('tracks')[0].folder).toBe(created('Set')!.id);
  });

  it('suffixes a track whose name only differs by its URL slug from one already there', async () => {
    fakeState.tables.tracks = [{ id: 't1', name: 'Beat', folder: 'f-live', user_id: USER.id }];
    await post({ tracks: [{ name: 'Beat!', folder: 'Live' }] });
    expect(insertedInto('tracks').map((t) => t.name)).toEqual(['Beat! 2']);
  });
});

function failTrackInsert() {
  supabaseFake.from.mockImplementation((table: string) => {
    const b = defaultFrom(table);
    if (table === 'tracks') {
      b.insert = vi.fn(() => ({ select: async () => ({ data: null, error: { message: 'boom' } }) }));
    }
    return b;
  });
}

describe('batch-import: re-importing an export', () => {
  it('an id-named ZIP directory (older "Export all") is that folder, not a new one', async () => {
    await post({ folders: [{ path: 'f-live' }], tracks: [{ name: 'Beat', folder: 'f-live' }] });
    expect(insertedInto('folders')).toHaveLength(0);
    expect(insertedInto('tracks')[0].folder).toBe('f-live');
  });

  it('keeps the multitrack fields', async () => {
    const steps = [{ id: 's1', name: 'A', code: 'a' }];
    await post({ tracks: [{ name: 'MT', isMultitrack: true, steps, activeStep: 0 }, { name: 'plain' }] });
    expect(insertedInto('tracks')).toEqual([
      expect.objectContaining({ name: 'MT', is_multitrack: true, steps, active_step: 0 }),
      expect.objectContaining({ name: 'plain', is_multitrack: false, steps: [], active_step: 0, code: '' }),
    ]);
  });

  it('stays fast for a large library imported again (indexed name checks)', async () => {
    fakeState.tables.folders = Array.from({ length: 200 }, (_, i) => ({
      id: `f${i}`,
      name: `Folder ${i}`,
      path: `Folder ${i}`,
      parent: null,
      user_id: USER.id,
    }));
    fakeState.tables.tracks = Array.from({ length: 2000 }, (_, i) => ({
      id: `t${i}`,
      name: `Track ${i}`,
      folder: `f${i % 200}`,
      user_id: USER.id,
    }));
    const tracks = Array.from({ length: 2000 }, (_, i) => ({ name: `Track ${i}`, folder: `Folder ${i % 200}` }));

    const start = performance.now();
    expect((await post({ tracks })).status).toBe(200);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(insertedInto('tracks')[0].name).toBe('Track 0 2');
  });
});

describe('batch-import: all or nothing', () => {
  it.each([
    ['a track without a name', { folders: [{ path: 'Set' }], tracks: [{ code: 'x' }] }],
    ['a track whose code is not text', { folders: [{ path: 'Set' }], tracks: [{ name: 'a', code: 42 }] }],
    ['a folder without a path', { folders: [{ name: 'Set' }], tracks: [] }],
    ['a folder path with nothing in it', { folders: [{ path: ' / ' }], tracks: [] }],
    ['a track whose code holds a NUL (a binary file)', { tracks: [{ name: 'a', code: 'x\u0000y' }] }],
  ])('refuses %s with 400 before saving anything', async (_l, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(insertedInto('folders')).toHaveLength(0);
    expect(insertedInto('tracks')).toHaveLength(0);
  });

  it('normalises odd ZIP paths ("/Set//Drums/") instead of refusing the import', async () => {
    expect((await post({ folders: [{ path: '/Set//Drums/' }] })).status).toBe(200);
    expect(insertedInto('folders').map((f) => f.path)).toEqual(['Set', 'Set/Drums']);
  });

  it('removes the new folders and answers 500 when the tracks cannot be saved', async () => {
    supabaseFake.from.mockImplementation((table: string) => {
      const b = defaultFrom(table);
      if (table === 'tracks') {
        b.insert = vi.fn(() => ({ select: async () => ({ data: null, error: { message: 'boom' } }) }));
      }
      return b;
    });

    const res = await post({ folders: [{ path: 'Set' }], tracks: [{ name: 'a', folder: 'Set' }] });

    expect(res.status).toBe(500);
    const removal = mutationsOn('folders').find((m) => m.op === 'delete');
    const ids = (removal!.filters!.find(([k]) => k === 'id')![1] as InList).values;
    expect(ids).toEqual([created('Set')!.id]);
    expect(removal!.filters).toContainEqual(['user_id', USER.id]);
  });

  it('never removes a reused folder: only the ones this import created', async () => {
    failTrackInsert();
    await post({ folders: [{ path: 'Live/New' }], tracks: [{ name: 'a', folder: 'Live/New' }] });
    const ids = (
      mutationsOn('folders')
        .find((m) => m.op === 'delete')!
        .filters!.find(([k]) => k === 'id')![1] as InList
    ).values;
    expect(ids).toEqual([created('Live/New')!.id]);
    expect(ids).not.toContain('f-live');
  });

  it('keeps the folders and answers success when the tracks were saved but the answer was lost', async () => {
    supabaseFake.from.mockImplementation((table: string) => {
      const b = defaultFrom(table);
      if (table === 'tracks') {
        b.insert = vi.fn((rows: any[]) => {
          fakeState.tables.tracks.push(...rows); // committed…
          return { select: async () => ({ data: null, error: { message: 'connection reset' } }) }; // …answer lost
        });
      }
      return b;
    });

    const res = await post({ folders: [{ path: 'Set' }], tracks: [{ name: 'a', folder: 'Set' }] });

    expect(res.status).toBe(200);
    expect(mutationsOn('folders').some((m) => m.op === 'delete')).toBe(false);
  });

  it("inserts with a client carrying the user's token, not the service-role key", async () => {
    await post({ folders: [{ path: 'Set' }] });
    const calls = createClientMock.mock.calls as unknown as Array<[string, string, any]>;
    expect(calls.some(([, key]) => key === 'test-service')).toBe(false);
    expect(calls.some(([, , o]) => o?.global?.headers?.Authorization === `Bearer ${TOKEN}`)).toBe(true);
  });
});
