/**
 * Spec 015 §2.4 — importing a library.
 * Units: `api/library/batch-import.ts` (the import the UI calls) and `api/tracks/bulk-create.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiContext,
  clearTestEnv,
  createClientMock,
  fakeState,
  insertedInto,
  mutationsOn,
  resetSupabaseFake,
  signIn,
  useTestEnv,
} from './apiTestHelpers';
import { POST as batchImport } from '../library/batch-import';
import { POST as bulkCreate } from '../tracks/bulk-create';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session', email: 'someone@example.test' };
const OTHER_USER_ID = 'user-victim';
const TOKEN = 'valid-token';

const routes = [
  { name: 'batch-import', url: 'http://test/api/library/batch-import', handler: batchImport },
  { name: 'tracks/bulk-create', url: 'http://test/api/tracks/bulk-create', handler: bulkCreate },
] as const;

function post(route: (typeof routes)[number], body: unknown, token?: string) {
  return route.handler(apiContext({ url: route.url, method: 'POST', token, body }));
}

let consoleSpies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  consoleSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ];
});

afterEach(() => {
  consoleSpies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

describe.each(routes)('$name: only a signed-in user can import', (route) => {
  it('refuses a signed-out import with 401 and saves nothing', async () => {
    const res = await post(route, { tracks: [{ name: 'Beat', code: 's("bd")' }] });
    expect(res.status).toBe(401);
    expect(fakeState.inserts).toEqual([]);
  });

  it('refuses an invalid session with 401 and saves nothing', async () => {
    const res = await post(route, { tracks: [{ name: 'Beat', code: 's("bd")' }] }, 'forged-token');
    expect(res.status).toBe(401);
    expect(fakeState.inserts).toEqual([]);
  });

  it('accepts a signed-in import (positive control for the 401 cases)', async () => {
    signIn(TOKEN, USER);
    const res = await post(route, { tracks: [{ name: 'Beat', code: 's("bd")' }] }, TOKEN);
    expect(res.status).toBe(200);
    expect(insertedInto('tracks')).toHaveLength(1);
  });
});

describe.each(routes)('$name: imported tracks land in the session user library', (route) => {
  it('stamps every inserted row with the session user id', async () => {
    signIn(TOKEN, USER);
    await post(
      route,
      {
        tracks: [
          { name: 'A', code: 'a' },
          { name: 'B', code: 'b' },
        ],
      },
      TOKEN,
    );
    const rows = insertedInto('tracks');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.user_id === USER.id)).toBe(true);
  });

  it('ignores a user_id in the body that names another user', async () => {
    signIn(TOKEN, USER);
    await post(route, { tracks: [{ name: 'A', code: 'a', user_id: OTHER_USER_ID }] }, TOKEN);
    const rows = insertedInto('tracks');
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(USER.id);
    expect(rows.some((r) => r.user_id === OTHER_USER_ID)).toBe(false);
  });
});

describe.each(routes)('$name: a malformed import is refused and nothing is saved', (route) => {
  it('refuses a non-array tracks field with 400 and saves nothing', async () => {
    signIn(TOKEN, USER);
    const res = await post(route, { tracks: 'not a list' }, TOKEN);
    expect(res.status).toBe(400);
    expect(fakeState.inserts).toEqual([]);
  });

  it('accepts an array tracks field (positive control for the 400 case)', async () => {
    signIn(TOKEN, USER);
    const res = await post(route, { tracks: [] }, TOKEN);
    expect(res.status).not.toBe(400);
  });
});

describe('batch-import: a malformed import is refused and nothing is saved', () => {
  it('refuses a non-array folders field with "Invalid data format" and saves nothing', async () => {
    signIn(TOKEN, USER);
    const res = await post(routes[0], { tracks: [{ name: 'A', code: 'a' }], folders: 'nope' }, TOKEN);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid data format' });
    expect(fakeState.inserts).toEqual([]);
  });

  it('saves nothing when tracks is null', async () => {
    signIn(TOKEN, USER);
    await post(routes[0], { tracks: null }, TOKEN);
    expect(fakeState.inserts).toEqual([]);
  });

  // FINDING (spec 015 §4): `tracks: null` skips the `= []` default, then `tracks.length`
  // (batch-import.ts:82) throws before the Array.isArray check, so the route answers
  // 500 "Internal server error" instead of 400 "Invalid data format". Nothing is saved.
  it.fails('refuses tracks: null with 400 "Invalid data format"', async () => {
    signIn(TOKEN, USER);
    const res = await post(routes[0], { tracks: null }, TOKEN);
    expect(res.status).toBe(400);
  });
});

// m1: bodies that are not an object of { tracks, folders } lists.
// FINDING (spec 015 §4): batch-import.ts:79 destructures `body` with defaults and validates
// only afterwards (:87), so a non-object body is never refused with 400 "Invalid data format":
//  - a bare array or a string falls through to `tracks = []` and answers 200 with nothing created;
//  - `null` throws on destructuring at :79 and answers 500;
//  - `folders: null` skips the `= []` default and throws on `folders.length` at :83, answering 500.
// Nothing is saved in any of these cases.
const notAListOfTracksAndFolders = [
  { label: 'a bare array of tracks', body: [{ name: 'Beat', code: 'x' }] },
  { label: 'a string', body: 'x' },
  { label: 'null', body: null },
  { label: 'folders: null', body: { tracks: [{ name: 'Beat', code: 'x' }], folders: null } },
];

describe.each(notAListOfTracksAndFolders)('batch-import: a body that is $label', ({ body }) => {
  beforeEach(() => {
    signIn(TOKEN, USER);
  });

  it('saves nothing', async () => {
    await post(routes[0], body, TOKEN);
    expect(fakeState.inserts).toEqual([]);
    expect(fakeState.mutations).toEqual([]);
  });

  it.fails('is refused with 400 "Invalid data format"', async () => {
    const res = await post(routes[0], body, TOKEN);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid data format' });
  });
});

// m2: ownership can't be claimed from anywhere in the body, for tracks or folders.
describe('batch-import: tracks and folders always land in the session user library', () => {
  beforeEach(() => {
    signIn(TOKEN, USER);
  });

  it('ignores a top-level user_id naming another user, for every track and folder row', async () => {
    const res = await post(
      routes[0],
      {
        user_id: OTHER_USER_ID,
        folders: [{ name: 'live', path: 'live' }],
        tracks: [
          { name: 'A', code: 'a', folder: 'live' },
          { name: 'B', code: 'b' },
        ],
      },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const rows = [...insertedInto('tracks'), ...insertedInto('folders')];
    expect(insertedInto('tracks')).toHaveLength(2);
    expect(insertedInto('folders')).toHaveLength(1);
    expect(rows.map((r) => r.user_id)).toEqual([USER.id, USER.id, USER.id]);
  });

  it('ignores user_id and id carried by a folder', async () => {
    await post(
      routes[0],
      { folders: [{ name: 'live', path: 'live', user_id: OTHER_USER_ID, id: 'victim-folder-id' }], tracks: [] },
      TOKEN,
    );
    const folders = insertedInto('folders');
    expect(folders).toHaveLength(1);
    expect(folders[0].user_id).toBe(USER.id);
    expect(folders[0].id).not.toBe('victim-folder-id');
  });

  it('creates the folder for the session user (positive control)', async () => {
    await post(routes[0], { folders: [{ name: 'live', path: 'live' }], tracks: [] }, TOKEN);
    expect(insertedInto('folders')).toEqual([
      expect.objectContaining({ name: 'live', path: 'live', user_id: USER.id }),
    ]);
  });
});

describe('batch-import: an imported track never overwrites an existing one', () => {
  beforeEach(() => {
    signIn(TOKEN, USER);
  });

  it('imports "beat" next to an existing "Beat" in the same folder as "beat 2"', async () => {
    fakeState.tables.tracks = [{ name: 'Beat', folder: 'live', user_id: USER.id }];
    const res = await post(routes[0], { tracks: [{ name: 'beat', code: 'x', folder: 'live' }] }, TOKEN);
    expect(res.status).toBe(200);
    expect(insertedInto('tracks').map((r) => r.name)).toEqual(['beat 2']);
    // "never overwrites": no update / upsert / delete reaches the tracks table
    expect(mutationsOn('tracks')).toEqual([]);
  });

  it('keeps the name "beat" when no track with that name exists (negative)', async () => {
    fakeState.tables.tracks = [{ name: 'Other', folder: 'live', user_id: USER.id }];
    await post(routes[0], { tracks: [{ name: 'beat', code: 'x', folder: 'live' }] }, TOKEN);
    expect(insertedInto('tracks').map((r) => r.name)).toEqual(['beat']);
  });

  it('imports two "Beat" in one batch as "Beat" and "Beat 2"', async () => {
    await post(
      routes[0],
      {
        tracks: [
          { name: 'Beat', code: '1', folder: 'live' },
          { name: 'Beat', code: '2', folder: 'live' },
        ],
      },
      TOKEN,
    );
    expect(insertedInto('tracks').map((r) => r.name)).toEqual(['Beat', 'Beat 2']);
  });

  it('continues numbering as "Beat 3" when "Beat" and "Beat 2" already exist', async () => {
    fakeState.tables.tracks = [
      { name: 'Beat', folder: null, user_id: USER.id },
      { name: 'Beat 2', folder: null, user_id: USER.id },
    ];
    await post(routes[0], { tracks: [{ name: 'Beat', code: 'x' }] }, TOKEN);
    expect(insertedInto('tracks').map((r) => r.name)).toEqual(['Beat 3']);
  });

  it('gives no suffix to a "Beat" imported into a different folder', async () => {
    fakeState.tables.tracks = [{ name: 'Beat', folder: 'live', user_id: USER.id }];
    await post(routes[0], { tracks: [{ name: 'Beat', code: 'x', folder: 'drafts' }] }, TOKEN);
    expect(insertedInto('tracks').map((r) => r.name)).toEqual(['Beat']);
  });

  it('gives no suffix when only another user\'s library has a "Beat"', async () => {
    fakeState.tables.tracks = [{ name: 'Beat', folder: 'live', user_id: OTHER_USER_ID }];
    await post(routes[0], { tracks: [{ name: 'Beat', code: 'x', folder: 'live' }] }, TOKEN);
    expect(insertedInto('tracks').map((r) => r.name)).toEqual(['Beat']);
  });
});

describe('test harness', () => {
  it('builds the Supabase client from the placeholder env only', async () => {
    signIn(TOKEN, USER);
    await post(routes[1], { tracks: [] }, TOKEN);
    expect(createClientMock).toHaveBeenCalledWith('http://test', 'test-service');
  });
});
