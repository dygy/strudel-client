/**
 * POST /api/folders/create.
 * Regression (2026-10-30, "two folders with the same slug share a URL"): the route stored any
 * name, trusted the client's `path`, and stored the parent's PATH in `parent` (the sidebar sends
 * a path), so same-named or same-slug siblings shared one URL and children lost their parent
 * when it was renamed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiContext,
  clearTestEnv,
  createClientMock,
  fakeState,
  insertedInto,
  resetSupabaseFake,
  signIn,
  useTestEnv,
} from './apiTestHelpers';
import { POST as folderCreate } from '../folders/create';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session' };
const TOKEN = 'eyJ.test.token';

const post = (body: unknown) =>
  folderCreate(apiContext({ url: 'http://test/api/folders/create', method: 'POST', token: TOKEN, body }));

let spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  signIn(TOKEN, USER);
  spies = ['log', 'error', 'warn'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  fakeState.tables.folders = [
    { id: 'f-live', name: 'Live', path: 'Live', parent: null, user_id: USER.id },
    { id: 'f-drums', name: 'Drums', path: 'Live/Drums', parent: 'f-live', user_id: USER.id },
    { id: 'f-theirs', name: 'Theirs', path: 'Theirs', parent: null, user_id: 'user-other' },
  ];
  createClientMock.mockClear();
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

describe('folders/create', () => {
  it('stores the parent as its id and builds the path itself, given the parent path', async () => {
    const res = await post({ id: 'newFolder0001', name: ' Bass ', path: 'hacked', parent: 'Live' });

    expect(res.status).toBe(200);
    expect(insertedInto('folders')).toEqual([
      expect.objectContaining({
        id: 'newFolder0001',
        name: 'Bass',
        path: 'Live/Bass',
        parent: 'f-live',
        user_id: USER.id,
      }),
    ]);
  });

  it('accepts the parent by id', async () => {
    await post({ id: 'newFolder0002', name: 'Kicks', parent: 'f-drums' });
    expect(insertedInto('folders')[0]).toMatchObject({ path: 'Live/Drums/Kicks', parent: 'f-drums' });
  });

  it.each([
    ['the same name in another case', 'drums'],
    ['a name with the same URL slug', 'Drums!'],
  ])('refuses %s as a sibling with 409, inserting nothing', async (_l, name) => {
    const res = await post({ id: 'newFolder0003', name, parent: 'Live' });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'duplicate' });
    expect(insertedInto('folders')).toHaveLength(0);
  });

  it('allows the same name under another parent', async () => {
    expect((await post({ id: 'newFolder0004', name: 'Drums', parent: null })).status).toBe(200);
  });

  it.each([
    ['empty', '  ', 400],
    ['slash', 'a/b', 400],
  ])('refuses a %s name', async (code, name, status) => {
    const res = await post({ id: 'newFolder0005', name });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });

  it("refuses a parent that is another user's folder", async () => {
    expect((await post({ id: 'newFolder0006', name: 'x', parent: 'f-theirs' })).status).toBe(400);
    expect(insertedInto('folders')).toHaveLength(0);
  });

  it('answers 409 id_taken when the id is already used (unique violation)', async () => {
    const { supabaseFake, defaultFrom } = await import('./apiTestHelpers');
    supabaseFake.from.mockImplementation((table: string) => {
      const b = defaultFrom(table);
      b.insert = vi.fn(() => ({ select: async () => ({ data: null, error: { code: '23505', message: 'dup' } }) }));
      return b;
    });
    try {
      const res = await post({ id: 'f-live', name: 'Fresh' });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'id_taken' });
    } finally {
      supabaseFake.from.mockImplementation(defaultFrom);
    }
  });

  it("inserts with a client carrying the user's token, not the service-role key", async () => {
    await post({ id: 'newFolder0007', name: 'Pads' });
    const calls = createClientMock.mock.calls as unknown as Array<[string, string, any]>;
    expect(calls.some(([, key]) => key === 'test-service')).toBe(false);
    expect(calls.some(([, , o]) => o?.global?.headers?.Authorization === `Bearer ${TOKEN}`)).toBe(true);
  });
});
