/**
 * @spec: 022-set-playlist (functional 2.1, 2.6; tech 2.2)
 * /api/sets/{list,create,update,delete}: signed in first (401 before the body is read), bad bodies
 * 400, user_id from the session, name clashes and stale versions 409, a foreign or missing set 404.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiContext,
  clearTestEnv,
  defaultFrom,
  fakeState,
  insertedInto,
  mutationsOn,
  resetSupabaseFake,
  signIn,
  supabaseFake,
  useTestEnv,
} from './apiTestHelpers';
import { GET as listSets } from '../sets/list';
import { POST as createSet } from '../sets/create';
import { PUT as updateSet } from '../sets/update';
import { DELETE as deleteSet } from '../sets/delete';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session' };
const TOKEN = 'eyJ.test.token';
const V1 = '2026-11-13T00:00:01.000001+00:00';
const V2 = '2026-11-13T00:00:02.000002+00:00';

type Route = (ctx: ReturnType<typeof apiContext>) => Promise<Response>;

const call = (route: Route, method: string, body?: unknown, token: string | undefined = TOKEN) =>
  route(apiContext({ url: `http://test/api/sets/x`, method, token, body }));

let spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  signIn(TOKEN, USER);
  spies = ['log', 'error', 'warn'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  fakeState.tables.set_lists = [
    { id: 's1', name: 'Set 1', items: [], user_id: USER.id, updated_at: V2 },
    { id: 's2', name: 'Friday', items: [], user_id: USER.id, updated_at: V1 },
    { id: 's-other', name: 'Theirs', items: [], user_id: 'user-other', updated_at: V1 },
  ];
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

describe('signed out', () => {
  it.each([
    ['list', listSets, 'GET'],
    ['create', createSet, 'POST'],
    ['update', updateSet, 'PUT'],
    ['delete', deleteSet, 'DELETE'],
  ] as const)('%s answers 401 before reading the body', async (_name, route, method) => {
    const ctx = apiContext({ url: 'http://test/api/sets/x', method, rawBody: method === 'GET' ? undefined : '{bad' });
    const json = vi.spyOn(ctx.request, 'json');
    const res = await route(ctx);
    expect(res.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(fakeState.inserts).toEqual([]);
    expect(fakeState.mutations).toEqual([]);
  });
});

describe('GET /api/sets/list', () => {
  it("returns only the session user's sets, with updated_at as version", async () => {
    const res = await call(listSets, 'GET');
    expect(res.status).toBe(200);
    const { sets } = await res.json();
    expect(sets.map((s: { id: string }) => s.id).sort()).toEqual(['s1', 's2']);
    expect(sets.find((s: { id: string }) => s.id === 's1')).toEqual({
      id: 's1',
      name: 'Set 1',
      items: [],
      version: V2,
    });
  });
});

describe('POST /api/sets/create', () => {
  it('creates an empty set owned by the session user, whatever the body says', async () => {
    const res = await call(createSet, 'POST', { name: '  Saturday ', user_id: 'user-other', items: [{ x: 1 }] });
    expect(res.status).toBe(201);
    expect(insertedInto('set_lists')).toEqual([{ user_id: USER.id, name: 'Saturday', items: [] }]);
  });

  it('names a set without a name with the first free "Set N"', async () => {
    const res = await call(createSet, 'POST', {});
    expect(res.status).toBe(201);
    expect(insertedInto('set_lists')[0].name).toBe('Set 2');
  });

  it('refuses a name another of the user’s sets has (409 name_taken), but not one another user has', async () => {
    const clash = await call(createSet, 'POST', { name: 'Friday' });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toEqual({ error: 'name_taken' });
    expect(insertedInto('set_lists')).toEqual([]);

    const theirs = await call(createSet, 'POST', { name: 'Theirs' });
    expect(theirs.status).toBe(201);
  });

  it('maps a racing unique violation to 409 name_taken', async () => {
    // The name check sees no clash; the INSERT then loses a race to a concurrent one (23505).
    interface RacingBuilder {
      select: () => RacingBuilder;
      eq: () => RacingBuilder;
      insert: () => RacingBuilder;
      single: () => Promise<{ data: null; error: { code: string; message: string } }>;
      then: (resolve: (v: unknown) => unknown) => Promise<unknown>;
    }
    supabaseFake.from.mockImplementation(() => {
      const builder: RacingBuilder = {
        select: () => builder,
        eq: () => builder,
        insert: () => builder,
        single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }),
        then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return builder as unknown as ReturnType<typeof defaultFrom>;
    });
    const res = await call(createSet, 'POST', { name: 'New' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'name_taken' });
  });

  it.each([
    ['an empty name', { name: '   ' }],
    ['a too long name', { name: 'x'.repeat(101) }],
    ['a non-string name', { name: 7 }],
  ])('refuses %s with 400', async (_label, body) => {
    const res = await call(createSet, 'POST', body);
    expect(res.status).toBe(400);
    expect(insertedInto('set_lists')).toEqual([]);
  });

  it('refuses an unparseable body with 400', async () => {
    const res = await createSet(
      apiContext({ url: 'http://test/api/sets/create', method: 'POST', token: TOKEN, rawBody: '[1]' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/sets/update', () => {
  const items = [{ id: 'i1', trackId: 't1', transition: { type: 'cut', length: 1 }, junk: true }];

  it('writes in one statement filtered on id, user and version, and drops unknown item keys', async () => {
    const res = await call(updateSet, 'PUT', { id: 's1', items, expectedVersion: V2 });
    expect(res.status).toBe(200);
    const [update] = mutationsOn('set_lists');
    expect(update.data).toEqual({ items: [{ id: 'i1', trackId: 't1', transition: { type: 'cut', length: 1 } }] });
    expect(update.filters).toEqual([
      ['id', 's1'],
      ['user_id', USER.id],
      ['updated_at', V2],
    ]);
    expect((await res.json()).set.items).toEqual([{ id: 'i1', trackId: 't1', transition: { type: 'cut', length: 1 } }]);
  });

  it('answers 409 version_conflict with the current set on a stale version, writing nothing', async () => {
    const res = await call(updateSet, 'PUT', { id: 's1', items, expectedVersion: V1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'version_conflict',
      current: { id: 's1', name: 'Set 1', items: [], version: V2 },
    });
    expect(fakeState.tables.set_lists.find((s) => s.id === 's1')!.items).toEqual([]);
  });

  it("answers 404 for another user's set and for a missing one", async () => {
    for (const id of ['s-other', 'nope']) {
      const res = await call(updateSet, 'PUT', { id, name: 'Mine now', expectedVersion: V1 });
      expect(res.status).toBe(404);
    }
    expect(fakeState.tables.set_lists.find((s) => s.id === 's-other')!.name).toBe('Theirs');
  });

  it('refuses a rename to a name another of the user’s sets has (409 name_taken); its own name is fine', async () => {
    const res = await call(updateSet, 'PUT', { id: 's1', name: 'Friday', expectedVersion: V2 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'name_taken' });
    expect(mutationsOn('set_lists')).toEqual([]);

    const same = await call(updateSet, 'PUT', { id: 's1', name: 'Set 1', expectedVersion: V2 });
    expect(same.status).toBe(200);
  });

  it.each([
    ['no expectedVersion', { id: 's1', name: 'A' }],
    ['a malformed expectedVersion', { id: 's1', name: 'A', expectedVersion: 'yesterday' }],
    ['no id', { name: 'A', expectedVersion: V2 }],
    ['nothing to change', { id: 's1', expectedVersion: V2 }],
    ['an empty name', { id: 's1', name: '', expectedVersion: V2 }],
    ['a bad item', { id: 's1', items: [{ id: 'i1', trackId: '' }], expectedVersion: V2 }],
    ['items that are not an array', { id: 's1', items: 'x', expectedVersion: V2 }],
  ])('refuses %s with 400', async (_label, body) => {
    const res = await call(updateSet, 'PUT', body);
    expect(res.status).toBe(400);
    expect(mutationsOn('set_lists')).toEqual([]);
  });
});

describe('DELETE /api/sets/delete', () => {
  it('deletes the user’s set, scoped by user', async () => {
    const res = await call(deleteSet, 'DELETE', { id: 's2' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [deletion] = mutationsOn('set_lists');
    expect(deletion.filters).toEqual([
      ['id', 's2'],
      ['user_id', USER.id],
    ]);
    // Never the tracks in it.
    expect(mutationsOn('tracks')).toEqual([]);
  });

  it("answers 404 for another user's set and for a missing one", async () => {
    expect((await call(deleteSet, 'DELETE', { id: 's-other' })).status).toBe(404);
    expect((await call(deleteSet, 'DELETE', { id: 'nope' })).status).toBe(404);
  });

  it('refuses a body without an id with 400', async () => {
    expect((await call(deleteSet, 'DELETE', {})).status).toBe(400);
  });
});
