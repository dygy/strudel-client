/**
 * @spec: 018-strudel-mcp-server (functional 2.4, 2.6; tech 2.5)
 * `expectedVersion` on PUT /api/tracks/update and DELETE /api/tracks/delete: optional, so tabs open
 * during a deploy keep saving; compare-and-swap in one statement; 409 or 404 on a miss.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiContext,
  clearTestEnv,
  fakeState,
  mutationsOn,
  resetSupabaseFake,
  signIn,
  useTestEnv,
} from './apiTestHelpers';
import { PUT as trackUpdate } from '../tracks/update';
import { DELETE as trackDelete } from '../tracks/delete';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session' };
const TOKEN = 'eyJ.test.token';
const V1 = '2026-11-03T00:09:28.401191+00:00';
const V2 = '2026-11-03T00:09:30.000001+00:00';

const put = (body: unknown) =>
  trackUpdate(apiContext({ url: 'http://test/api/tracks/update', method: 'PUT', token: TOKEN, body }));
const del = (body: unknown) =>
  trackDelete(apiContext({ url: 'http://test/api/tracks/delete', method: 'DELETE', token: TOKEN, body }));
const row = () => fakeState.tables.tracks.find((t) => t.id === 't1');

let spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  signIn(TOKEN, USER);
  spies = ['log', 'error', 'warn'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  fakeState.tables.folders = [];
  fakeState.tables.tracks = [
    {
      id: 't1',
      name: 'mine',
      code: 'server code',
      steps: [],
      folder: null,
      is_multitrack: false,
      active_step: 0,
      user_id: USER.id,
      updated_at: V2,
    },
    { id: 't-other', name: 'theirs', code: 'x', user_id: 'user-other', updated_at: V1 },
  ];
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

describe('PUT /api/tracks/update with expectedVersion', () => {
  it('writes when the version matches, and the filter is on the same statement as the write', async () => {
    const res = await put({ trackId: 't1', updates: { code: 'new' }, expectedVersion: V2 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, track: { code: 'new' } });
    const [update] = mutationsOn('tracks');
    expect(update.filters).toEqual([
      ['id', 't1'],
      ['user_id', USER.id],
      ['updated_at', V2],
    ]);
  });

  it('writes nothing on a mismatch, and answers 409 with what is there now', async () => {
    const res = await put({ trackId: 't1', updates: { code: 'stale' }, expectedVersion: V1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'This track changed since you read it',
      code: 'version_conflict',
      current: {
        version: V2,
        name: 'mine',
        folder: null,
        code: 'server code',
        steps: [],
        isMultitrack: false,
        activeStep: 0,
      },
    });
    expect(row()!.code).toBe('server code');
  });

  it('answers 404 for a deleted track', async () => {
    const res = await put({ trackId: 'gone', updates: { code: 'x' }, expectedVersion: V1 });
    expect(res.status).toBe(404);
  });

  it("can't tell another user's track from a deleted one", async () => {
    const res = await put({ trackId: 't-other', updates: { code: 'x' }, expectedVersion: V1 });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Track not found' });
    expect(fakeState.tables.tracks.find((t) => t.id === 't-other')!.code).toBe('x');
  });

  it('without it, saves as it always did: a tab opened before the deploy keeps saving', async () => {
    const res = await put({ trackId: 't1', updates: { code: 'old tab' } });
    expect(res.status).toBe(200);
    expect(row()!.code).toBe('old tab');
    expect(mutationsOn('tracks')[0].filters).toEqual([
      ['id', 't1'],
      ['user_id', USER.id],
    ]);
  });

  it('a rename on a stale version is refused too', async () => {
    const res = await put({ trackId: 't1', updates: { name: 'renamed' }, expectedVersion: V1 });
    expect(res.status).toBe(409);
    expect(row()!.name).toBe('mine');
  });

  it.each([42, '', 'yesterday', null, '2026-11-03', "2026-11-03T00:00:00+00:00' OR 1=1"])(
    'refuses %j as a version with 400, before writing',
    async (expectedVersion) => {
      const res = await put({ trackId: 't1', updates: { code: 'x' }, expectedVersion });
      expect(res.status).toBe(400);
      expect(mutationsOn('tracks')).toEqual([]);
    },
  );

  it.each([V1, '2026-11-03T00:09:28+00:00', '2026-11-03T00:09:28.4Z', '2026-11-03 00:09:28.401191+00'])(
    'accepts %s as a version',
    async (expectedVersion) => {
      const res = await put({ trackId: 't1', updates: { code: 'x' }, expectedVersion });
      expect(res.status).not.toBe(400);
    },
  );
});

describe('DELETE /api/tracks/delete with expectedVersion', () => {
  it('filters the delete by the version', async () => {
    const res = await del({ trackId: 't1', expectedVersion: V2 });
    expect(res.status).toBe(200);
    expect(mutationsOn('tracks')[0].filters).toContainEqual(['updated_at', V2]);
  });

  it('answers 409 when the track changed, and leaves it', async () => {
    // The fake returns no rows for a filter that matches none, as PostgREST does.
    const res = await del({ trackId: 't1', expectedVersion: V1 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('version_conflict');
  });

  it('answers 404 for a track that is gone', async () => {
    expect((await del({ trackId: 'gone', expectedVersion: V1 })).status).toBe(404);
  });

  it('without it, deletes as it always did', async () => {
    expect((await del({ trackId: 't1' })).status).toBe(200);
    expect(mutationsOn('tracks')[0].filters).not.toContainEqual(['updated_at', expect.anything()]);
  });

  it('refuses a malformed version', async () => {
    expect((await del({ trackId: 't1', expectedVersion: 'nope' })).status).toBe(400);
    expect(mutationsOn('tracks')).toEqual([]);
  });
});
