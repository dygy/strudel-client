/**
 * PUT /api/folders/update — renaming a folder persists, cascades and validates on the server.
 * Regression (2026-10-29, "can't rename folder"): the sidebar never called this route, and the
 * route trusted a client-sent path and did not touch descendants or path-holding tracks.
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
import { PUT as folderUpdate } from '../folders/update';

vi.mock('@supabase/supabase-js', async () => {
  const helpers = await import('./apiTestHelpers');
  return { createClient: helpers.createClientMock };
});

const USER = { id: 'user-session' };
const OTHER = 'user-other';
// JWT-shaped: api/_auth.ts only accepts a cookie value that contains a dot.
const TOKEN = 'eyJ.test.token';

const put = (body: unknown, token: string | null = TOKEN) =>
  folderUpdate(apiContext({ url: 'http://test/api/folders/update', method: 'PUT', token: token ?? undefined, body }));

const folderRow = (id: string, name: string, path: string, parent: string | null, user_id = USER.id) => ({
  id,
  name,
  path,
  parent,
  user_id,
});

const folder = (id: string) => fakeState.tables.folders.find((f) => f.id === id && f.user_id === USER.id);
const track = (id: string) => fakeState.tables.tracks.find((t) => t.id === id);

let consoleSpies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetSupabaseFake();
  useTestEnv();
  signIn(TOKEN, USER);
  consoleSpies = ['log', 'error', 'warn'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => {}));
  fakeState.tables.folders = [
    folderRow('f-test', 'test', 'test', null),
    folderRow('f-sub', 'Sub', 'test/Sub', 'f-test'),
    folderRow('f-deep', 'deep', 'test/Sub/deep', 'f-sub'),
    folderRow('f-beats', 'My Beats', 'My Beats', null),
    // another user's folder with the same path must never change
    folderRow('f-test', 'test', 'test', null, OTHER),
  ];
  fakeState.tables.tracks = [
    { id: 't-id', name: 'taka', folder: 'f-test', user_id: USER.id },
    { id: 't-path', name: 'old', folder: 'test', user_id: USER.id },
    { id: 't-sub-path', name: 'sub', folder: 'test/Sub', user_id: USER.id },
    { id: 't-deep-path', name: 'deeper', folder: 'test/Sub/deep', user_id: USER.id },
    { id: 't-beats', name: 'groove', folder: 'My Beats', user_id: USER.id },
    { id: 't-other-user', name: 'theirs', folder: 'test', user_id: OTHER },
  ];
});

afterEach(() => {
  consoleSpies.forEach((s) => s.mockRestore());
  clearTestEnv();
});

describe('folders/update: rename cascade', () => {
  it('renames the folder with a server-computed path, ignoring a client path', async () => {
    const res = await put({ folderId: 'f-test', updates: { name: ' Live Set ', path: 'hacked/elsewhere' } });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      folder: { id: 'f-test', name: 'Live Set', path: 'Live Set' },
    });
    expect(folder('f-test')).toMatchObject({ name: 'Live Set', path: 'Live Set' });
  });

  it('rewrites descendant folder paths', async () => {
    await put({ folderId: 'f-test', updates: { name: 'Live' } });

    expect(folder('f-sub')!.path).toBe('Live/Sub');
    expect(folder('f-deep')!.path).toBe('Live/Sub/deep');
    expect(folder('f-beats')!.path).toBe('My Beats');
  });

  it('rewrites tracks that store a renamed path; tracks storing ids are untouched', async () => {
    await put({ folderId: 'f-test', updates: { name: 'Live' } });

    expect(track('t-path')!.folder).toBe('Live');
    expect(track('t-sub-path')!.folder).toBe('Live/Sub');
    expect(track('t-deep-path')!.folder).toBe('Live/Sub/deep');
    expect(track('t-id')!.folder).toBe('f-test');
    expect(track('t-beats')!.folder).toBe('My Beats');
  });

  it("never touches another user's folders or tracks", async () => {
    await put({ folderId: 'f-test', updates: { name: 'Live' } });

    expect(fakeState.tables.folders.find((f) => f.user_id === OTHER)).toMatchObject({ name: 'test', path: 'test' });
    expect(track('t-other-user')!.folder).toBe('test');
    for (const m of [...mutationsOn('folders'), ...mutationsOn('tracks')]) {
      expect(m.filters).toContainEqual(['user_id', USER.id]);
    }
  });

  it('renames a nested folder below its parent path', async () => {
    const res = await put({ folderId: 'f-sub', updates: { name: 'Drums' } });

    expect(res.status).toBe(200);
    expect(folder('f-sub')!.path).toBe('test/Drums');
    expect(folder('f-deep')!.path).toBe('test/Drums/deep');
    expect(track('t-sub-path')!.folder).toBe('test/Drums');
    expect(track('t-path')!.folder).toBe('test');
  });

  it('rolls the folder back when the track cascade fails', async () => {
    fakeState.failUpdate = (table, data) => (table === 'tracks' && data.folder === 'Live/Sub' ? 'boom' : null);

    const res = await put({ folderId: 'f-test', updates: { name: 'Live' } });

    expect(res.status).toBe(500);
    expect(folder('f-test')).toMatchObject({ name: 'test', path: 'test' });
    expect(folder('f-sub')!.path).toBe('test/Sub');
    expect(track('t-path')!.folder).toBe('test');
  });

  it('moves tracks by id: an orphan row already at the new path is neither swept along nor dragged back', async () => {
    fakeState.tables.tracks.push({ id: 't-orphan', name: 'orphan', folder: 'Live', user_id: USER.id });
    fakeState.failUpdate = (table, data) => (table === 'tracks' && data.folder === 'Live/Sub' ? 'boom' : null);

    const res = await put({ folderId: 'f-test', updates: { name: 'Live' } });

    expect(res.status).toBe(500);
    expect(track('t-path')!.folder).toBe('test');
    expect(track('t-orphan')!.folder).toBe('Live');
  });

  it('refuses with 409 when a moving track would collide with a track already at the new path', async () => {
    fakeState.tables.tracks.push({ id: 't-orphan', name: 'old', folder: 'Live', user_id: USER.id });

    const res = await put({ folderId: 'f-test', updates: { name: 'Live' } });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'track_conflict' });
    expect(fakeState.mutations).toEqual([]);
  });

  it('reports an incomplete rollback when an undo step returns an error', async () => {
    fakeState.failUpdate = (table, data) =>
      (table === 'tracks' && data.folder === 'Live/Sub') || (table === 'folders' && data.name === 'test')
        ? 'boom'
        : null;

    const res = await put({ folderId: 'f-test', updates: { name: 'Live' } });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'rollback_incomplete' });
  });

  it('a clean rollback is a plain 500, not rollback_incomplete', async () => {
    fakeState.failUpdate = (table, data) => (table === 'tracks' && data.folder === 'Live/Sub' ? 'boom' : null);

    const res = await put({ folderId: 'f-test', updates: { name: 'Live' } });

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBeUndefined();
  });
});

describe('folders/update: rename validation', () => {
  it.each([
    ['an empty name', '   ', 400],
    ['a name with a slash', 'a/b', 400],
    ['a sibling whose name slugs the same', 'my-beats', 409],
  ])('refuses %s and writes nothing', async (_l, name, status) => {
    const res = await put({ folderId: 'f-test', updates: { name } });

    expect(res.status).toBe(status);
    expect(fakeState.mutations).toEqual([]);
  });

  it('allows a Cyrillic name next to another Cyrillic sibling (both slug to "untitled")', async () => {
    fakeState.tables.folders.push(folderRow('f-bass', 'Бас', 'Бас', null));
    const res = await put({ folderId: 'f-beats', updates: { name: 'Ударные' } });

    expect(res.status).toBe(200);
    expect(folder('f-beats')).toMatchObject({ name: 'Ударные', path: 'Ударные' });
  });

  it('refuses the same Cyrillic name case-insensitively with 409', async () => {
    fakeState.tables.folders.push(folderRow('f-bass', 'Бас', 'Бас', null));
    const res = await put({ folderId: 'f-beats', updates: { name: 'бас' } });

    expect(res.status).toBe(409);
    expect(fakeState.mutations).toEqual([]);
  });

  it('allows a name used by a folder under another parent', async () => {
    const res = await put({ folderId: 'f-beats', updates: { name: 'Sub' } });
    expect(res.status).toBe(200);
  });

  it("answers 404 for a folder that is not the user's", async () => {
    signIn('eyJ.other.token', { id: 'user-third' });
    const res = await put({ folderId: 'f-test', updates: { name: 'Live' } }, 'eyJ.other.token');

    expect(res.status).toBe(404);
    expect(fakeState.mutations).toEqual([]);
  });

  it('answers 401 when signed out and writes nothing', async () => {
    const res = await put({ folderId: 'f-test', updates: { name: 'Live' } }, null);

    expect(res.status).toBe(401);
    expect(fakeState.mutations).toEqual([]);
  });
});
