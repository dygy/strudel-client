/**
 * PUT /api/tracks/update — renaming or moving a track.
 * Regression (2026-10-30, "track rename only changes local state"): the sidebar never sent a
 * rename, and the route spread the whole `updates` object into a service-role UPDATE, so a body
 * like `{ user_id: <someone else> }` could hand a track to another account.
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

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session' };
const OTHER = 'user-other';
const TOKEN = 'eyJ.test.token';
const BEATS = 'beatsFolder000000000a';

const put = (body: unknown, token: string | null = TOKEN) =>
  trackUpdate(apiContext({ url: 'http://test/api/tracks/update', method: 'PUT', token: token ?? undefined, body }));

const track = (id: string, user_id = USER.id) =>
  fakeState.tables.tracks.find((t) => t.id === id && t.user_id === user_id);

let consoleSpies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  signIn(TOKEN, USER);
  consoleSpies = ['log', 'error', 'warn'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  fakeState.tables.folders = [
    { id: BEATS, name: 'My Beats', path: 'My Beats', parent: null, user_id: USER.id },
    { id: 'f-theirs', name: 'Theirs', path: 'Theirs', parent: null, user_id: OTHER },
  ];
  fakeState.tables.tracks = [
    { id: 't-root', name: 'spiral', code: 'a', folder: null, user_id: USER.id },
    { id: 't-root2', name: 'groove', code: 'b', folder: null, user_id: USER.id },
    { id: 't-beats-id', name: 'kick', code: 'c', folder: BEATS, user_id: USER.id },
    { id: 't-beats-path', name: 'snare', code: 'd', folder: 'My Beats', user_id: USER.id },
    { id: 't-other', name: 'theirs', code: 'e', folder: null, user_id: OTHER },
  ];
});

afterEach(() => {
  consoleSpies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

describe('tracks/update: rename', () => {
  it('renames the track (trimmed) and answers with the row', async () => {
    const res = await put({ trackId: 't-root', updates: { name: '  Spiral Two ' } });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, track: { id: 't-root', name: 'Spiral Two' } });
    expect(track('t-root')!.name).toBe('Spiral Two');
  });

  it.each([
    ['the same name in another case', 'GROOVE'],
    ['a name with the same URL slug', 'Groove!'],
  ])('refuses %s next to a sibling with 409, writing nothing', async (_label, name) => {
    const res = await put({ trackId: 't-root', updates: { name } });

    expect(res.status).toBe(409);
    expect(track('t-root')!.name).toBe('spiral');
    expect(mutationsOn('tracks')).toHaveLength(0);
  });

  it('a sibling stored by folder path still counts as the same folder', async () => {
    const res = await put({ trackId: 't-beats-id', updates: { name: 'Snare' } });
    expect(res.status).toBe(409);
  });

  it('allows a name used in another folder', async () => {
    const res = await put({ trackId: 't-root', updates: { name: 'kick' } });
    expect(res.status).toBe(200);
  });

  it('refuses an empty name with 400', async () => {
    const res = await put({ trackId: 't-root', updates: { name: '   ' } });
    expect(res.status).toBe(400);
  });
});

// Every code save (autosave, Cmd+S, save-before-switch, emergency save) goes through this route
// via secureApi.updateTrack: narrowing the fields must never refuse it.
describe('tracks/update: saving code', () => {
  it('saves code the way saveSpecificTrack sends it ({ code, modified })', async () => {
    const res = await put({ trackId: 't-root', updates: { code: 's("bd sd")', modified: '2020-01-01T00:00:00Z' } });

    expect(res.status).toBe(200);
    expect(track('t-root')!.code).toBe('s("bd sd")');
    expect(track('t-root')!.modified).not.toBe('2020-01-01T00:00:00Z');
  });

  it('a code save does not need to read the whole library first', async () => {
    const { supabaseFake } = await import('./apiTestHelpers');
    supabaseFake.from.mockClear();

    await put({ trackId: 't-root', updates: { code: 'x' } });

    expect(supabaseFake.from).toHaveBeenCalledTimes(1);
  });

  it('maps the import overwrite fields (camelCase) to their columns', async () => {
    const steps = [{ id: 's1', name: 'A', code: 'a' }];
    const res = await put({
      trackId: 't-root',
      updates: { code: 'y', isMultitrack: true, steps, activeStep: 0 },
    });

    expect(res.status).toBe(200);
    expect(track('t-root')).toMatchObject({ code: 'y', is_multitrack: true, steps, active_step: 0 });
  });

  it.each([
    ['code', { code: 42 }],
    ['steps', { steps: 'nope' }],
    ['isMultitrack', { isMultitrack: 'yes' }],
    ['activeStep', { activeStep: 1.5 }],
  ])('refuses a malformed %s with 400', async (_l, updates) => {
    expect((await put({ trackId: 't-root', updates })).status).toBe(400);
    expect(mutationsOn('tracks')).toHaveLength(0);
  });
});

describe('tracks/update: only known fields are written', () => {
  it('ignores user_id, id and created in the updates', async () => {
    const res = await put({
      trackId: 't-root',
      updates: { name: 'mine', code: 'ok', user_id: OTHER, id: 'hijack', created: 'x' },
    });

    expect(res.status).toBe(200);
    expect(track('t-root')).toMatchObject({ id: 't-root', name: 'mine', code: 'ok', user_id: USER.id });
    const written = mutationsOn('tracks')[0].data as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(['code', 'modified', 'name']);
  });

  it("a code save cannot reach another user's track", async () => {
    const res = await put({ trackId: 't-other', updates: { code: 'evil' } });
    expect(res.status).toBe(404);
    expect(track('t-other', OTHER)!.code).toBe('e');
  });

  it('refuses a body with nothing to update', async () => {
    const res = await put({ trackId: 't-root', updates: { user_id: OTHER } });
    expect(res.status).toBe(400);
    expect(mutationsOn('tracks')).toHaveLength(0);
  });

  it("refuses moving into another user's folder", async () => {
    const res = await put({ trackId: 't-root', updates: { folder: 'f-theirs' } });
    expect(res.status).toBe(400);
    expect(track('t-root')!.folder).toBeNull();
  });

  it('moves into an own folder by id, and refuses a clashing name there', async () => {
    expect((await put({ trackId: 't-root2', updates: { folder: BEATS } })).status).toBe(200);
    expect(track('t-root2')!.folder).toBe(BEATS);

    fakeState.tables.tracks.push({ id: 't-kick2', name: 'Kick', code: '', folder: null, user_id: USER.id });
    expect((await put({ trackId: 't-kick2', updates: { folder: BEATS } })).status).toBe(409);
  });

  it("answers 404 for another user's track", async () => {
    const res = await put({ trackId: 't-other', updates: { name: 'x' } });
    expect(res.status).toBe(404);
    expect(track('t-other', OTHER)!.name).toBe('theirs');
  });

  it('answers 401 when signed out', async () => {
    const res = await put({ trackId: 't-root', updates: { name: 'x' } }, null);
    expect(res.status).toBe(401);
  });
});
