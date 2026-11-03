/**
 * @spec: 018-strudel-mcp-server (slice 5)
 * Changing the library: what reaches the site's routes, and what an assistant is told.
 */
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeLibrary, OTHER_USER, toolCaller, type FakeLibrary } from './fakeLibrary';
import { ORIGIN } from './helpers';

let library: FakeLibrary;
let tools: ReturnType<typeof toolCaller>;

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  library = fakeLibrary();
  tools = toolCaller(library);
});
afterEach(() => vi.unstubAllGlobals());

const OVER_LIMIT = 'x'.repeat(512 * 1024 + 1);
const stepsOf = (...codes: string[]) => codes.map((code, i) => ({ id: `s${i}`, name: `Step ${i}`, code }));
const multitrack = (codes: string[], active = 0) =>
  library.addTrack({
    id: 'm',
    name: 'Multi',
    code: codes[active],
    is_multitrack: true,
    steps: stepsOf(...codes),
    active_step: active,
  });
const siteUpdates = () => library.siteCalls.at(-1)!.body.updates as Record<string, unknown>;

describe('create_track', () => {
  it('creates through the route and answers with what a next change needs', async () => {
    const { structured } = await tools.call('create_track', { name: 'New Song', code: 's("bd")' });
    expect(library.tracks[0]).toMatchObject({ name: 'New Song', code: 's("bd")', folder: null });
    expect(structured).toMatchObject({
      name: 'New Song',
      version: library.tracks[0].updated_at,
      webAddress: `${ORIGIN}/repl/new-song`,
    });
  });

  it('creates a multitrack with the first step active, and code holding its text', async () => {
    await tools.call('create_track', {
      name: 'Multi',
      steps: [
        { name: 'Intro', code: 's("a")' },
        { name: 'Drop', code: 's("b")' },
      ],
    });
    expect(library.tracks[0]).toMatchObject({ code: 's("a")', is_multitrack: true, active_step: 0 });
    expect((library.tracks[0].steps as Array<{ id: string }>).map((step) => step.id)[0]).toMatch(/^[\w-]{21}$/);
  });

  it.each([
    ['the same name', 'Song'],
    ['the same name in another case', 'SONG'],
    ['a name with the same address', 'song!'],
  ])('refuses %s at the top level, which the route alone would let through', async (_label, name) => {
    library.addTrack({ id: 't', name: 'Song', folder: null });
    const { error } = await tools.call('create_track', { name });
    expect(error.code).toBe('name_taken');
    expect(library.siteCalls).toEqual([]);
  });

  it('allows the same name in another folder', async () => {
    library.addFolder({ id: 'f', name: 'Folder' });
    library.addTrack({ id: 't', name: 'Song', folder: null });
    const { isError } = await tools.call('create_track', { name: 'Song', folder: 'f' });
    expect(isError).toBeUndefined();
  });

  it('notices a clash with an older row holding the folder as a path', async () => {
    library.addFolder({ id: 'f', name: 'Folder', path: 'Folder' });
    library.addTrack({ id: 't', name: 'Song', folder: 'Folder' });
    expect((await tools.call('create_track', { name: 'Song', folder: 'f' })).error.code).toBe('name_taken');
  });

  it('notices a clash in a library larger than one response can hold', async () => {
    library.addFolder({ id: 'f', name: 'Folder' });
    for (let i = 0; i < 1100; i++) library.addTrack({ id: `other-${i}`, name: `Other ${i}` });
    library.addTrack({ id: 't', name: 'Song', folder: 'f' });
    expect((await tools.call('create_track', { name: 'Song', folder: 'f' })).error.code).toBe('name_taken');
  });

  it('gives "Folder not found" for someone else\'s folder', async () => {
    library.addFolder({ id: 'theirs', name: 'x', user_id: OTHER_USER });
    const { error } = await tools.call('create_track', { name: 'Song', folder: 'theirs' });
    expect(error).toMatchObject({ code: 'not_found', message: 'Folder not found' });
    expect(library.siteCalls).toEqual([]);
  });

  it.each([
    ['empty once trimmed', '   '],
    ['with a character the app refuses', 'a<b'],
    ['too long', 'x'.repeat(101)],
  ])('refuses a name %s', async (_label, name) => {
    expect((await tools.call('create_track', { name })).error.code).toBe('invalid_arguments');
    expect(library.siteCalls).toEqual([]);
  });

  it('refuses code over 512 KB, and any step over it', async () => {
    expect((await tools.call('create_track', { name: 'a', code: OVER_LIMIT })).error.code).toBe('too_large');
    const steps = [
      { name: 'fine', code: 'x' },
      { name: 'big', code: OVER_LIMIT },
    ];
    expect((await tools.call('create_track', { name: 'a', steps })).error.code).toBe('too_large');
    expect(library.siteCalls).toEqual([]);
  });

  it('allows code of exactly 512 KB, and counts bytes rather than characters', async () => {
    const exact = 'x'.repeat(512 * 1024);
    expect((await tools.call('create_track', { name: 'a', code: exact })).isError).toBeUndefined();
    const wide = 'é'.repeat(256 * 1024 + 1);
    expect((await tools.call('create_track', { name: 'b', code: wide })).error.code).toBe('too_large');
  });
});

describe('update_track', () => {
  it('saves code on a plain track, naming the version it read, and answers with the next one', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'old' });
    const version = row.updated_at;
    const { structured } = await tools.call('update_track', { trackId: 't', expectedVersion: version, code: 'new' });
    expect(library.siteCalls[0].body).toMatchObject({ expectedVersion: version, updates: { code: 'new' } });
    expect(row.code).toBe('new');
    expect(structured.version).toBe(row.updated_at);
    expect(structured.version).not.toBe(version);
  });

  it('is one request for code and name together, so it is all or nothing', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'old' });
    library.addTrack({ id: 'u', name: 'Taken' });
    const version = row.updated_at;
    const { error } = await tools.call('update_track', {
      trackId: 't',
      expectedVersion: version,
      code: 'new',
      name: 'Taken',
    });
    expect(error.code).toBe('name_taken');
    expect(library.siteCalls).toHaveLength(1);
    expect(row).toMatchObject({ name: 'Song', code: 'old', updated_at: version });
  });

  it('refuses a stale version, says to read again, and writes nothing', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'typed by the user' });
    const { error } = await tools.call('update_track', { trackId: 't', expectedVersion: 'stale', code: 'new' });
    expect(error).toMatchObject({
      code: 'version_conflict',
      next: expect.stringContaining('Read it again'),
      currentVersion: row.updated_at,
    });
    expect(row.code).toBe('typed by the user');
  });

  it('is refused when another write gets in between its read and the route', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'old', is_multitrack: false });
    const version = row.updated_at;
    library.hooks.beforeRoute = () => {
      row.code = 'typed meanwhile';
      row.updated_at = 'opaque-newer';
    };
    const { error } = await tools.call('update_track', { trackId: 't', expectedVersion: version, code: 'new' });
    expect(error).toMatchObject({ code: 'version_conflict', currentVersion: 'opaque-newer' });
    expect(row.code).toBe('typed meanwhile');
  });

  it('requires a version', async () => {
    library.addTrack({ id: 't', name: 'Song' });
    const { error } = await tools.call('update_track', { trackId: 't', code: 'new' });
    expect(error).toMatchObject({ code: 'invalid_arguments', message: 'arguments.expectedVersion is required' });
  });

  it('refuses code over 512 KB before anything is read', async () => {
    const { error } = await tools.call('update_track', { trackId: 't', expectedVersion: 'v', code: OVER_LIMIT });
    expect(error.code).toBe('too_large');
    expect(library.siteCalls).toEqual([]);
  });

  it('refuses a call changing nothing', async () => {
    const { error } = await tools.call('update_track', { trackId: 't', expectedVersion: 'v' });
    expect(error.code).toBe('invalid_arguments');
  });

  it('gives "Track not found" for someone else\'s track, and changes nothing', async () => {
    const theirs = library.addTrack({ id: 'theirs', name: 'x', code: 'theirs', user_id: OTHER_USER });
    const { error } = await tools.call('update_track', {
      trackId: 'theirs',
      expectedVersion: theirs.updated_at,
      code: 'mine',
    });
    expect(error).toEqual({ code: 'not_found', message: 'Track not found' });
    expect(theirs.code).toBe('theirs');
  });

  it("gives the same for a rename of someone else's track", async () => {
    const theirs = library.addTrack({ id: 'theirs', name: 'x', user_id: OTHER_USER });
    const { error } = await tools.call('update_track', {
      trackId: 'theirs',
      expectedVersion: theirs.updated_at,
      name: 'mine',
    });
    expect(error).toEqual({ code: 'not_found', message: 'Track not found' });
    expect(theirs.name).toBe('x');
  });

  describe('on a multitrack', () => {
    it('writes steps: the active step, with code holding its text', async () => {
      const row = multitrack(['a', 'b'], 1);
      await tools.call('update_track', { trackId: 'm', expectedVersion: row.updated_at, code: 'new' });
      const updates = siteUpdates();
      expect((updates.steps as Array<{ code: string }>).map((step) => step.code)).toEqual(['a', 'new']);
      expect(updates).toMatchObject({ code: 'new', activeStep: 1, isMultitrack: true });
    });

    it('writes another step on request, leaving code as the active step', async () => {
      const row = multitrack(['a', 'b'], 1);
      await tools.call('update_track', { trackId: 'm', expectedVersion: row.updated_at, code: 'new', step: 0 });
      const updates = siteUpdates();
      expect((updates.steps as Array<{ code: string }>).map((step) => step.code)).toEqual(['new', 'b']);
      expect(updates).toMatchObject({ code: 'b', activeStep: 1 });
    });

    it('keeps old edits found only in code, as a step of their own', async () => {
      const row = library.addTrack({
        id: 'm',
        name: 'Multi',
        code: 'old edits',
        is_multitrack: true,
        steps: stepsOf('a'),
        active_step: 0,
      });
      await tools.call('update_track', { trackId: 'm', expectedVersion: row.updated_at, code: 'new', step: 0 });
      const codes = (siteUpdates().steps as Array<{ code: string }>).map((step) => step.code);
      expect(codes).toContain('old edits');
      expect(codes).toContain('new');
    });

    it('refuses a step that is not there', async () => {
      const row = multitrack(['a']);
      const { error } = await tools.call('update_track', {
        trackId: 'm',
        expectedVersion: row.updated_at,
        code: 'new',
        step: 5,
      });
      expect(error.code).toBe('invalid_arguments');
      expect(library.siteCalls).toEqual([]);
    });

    it('renames with no step data, so a rename does not rewrite the music', async () => {
      const row = multitrack(['a']);
      await tools.call('update_track', { trackId: 'm', expectedVersion: row.updated_at, name: 'Renamed' });
      expect(siteUpdates()).toEqual({ name: 'Renamed' });
    });
  });
});

describe('move_track', () => {
  it('moves into a folder and out to the top level', async () => {
    library.addFolder({ id: 'f', name: 'Live', path: 'Live' });
    const row = library.addTrack({ id: 't', name: 'Song' });
    const moved = await tools.call('move_track', { trackId: 't', expectedVersion: row.updated_at, folder: 'f' });
    expect(row.folder).toBe('f');
    expect(moved.structured.webAddress).toBe(`${ORIGIN}/repl/live/song`);
    const back = await tools.call('move_track', { trackId: 't', expectedVersion: row.updated_at, folder: null });
    expect(back.isError).toBeUndefined();
    expect(row.folder).toBe(null);
  });

  it('refuses a name already used there', async () => {
    library.addFolder({ id: 'f', name: 'Live', path: 'Live' });
    library.addTrack({ id: 'u', name: 'Song', folder: 'f' });
    const row = library.addTrack({ id: 't', name: 'Song' });
    const { error } = await tools.call('move_track', { trackId: 't', expectedVersion: row.updated_at, folder: 'f' });
    expect(error.code).toBe('name_taken');
  });

  it('requires a folder, so nothing moves to the top by accident', async () => {
    const { error } = await tools.call('move_track', { trackId: 't', expectedVersion: 'v' });
    expect(error.code).toBe('invalid_arguments');
  });
});

describe('set_track_steps', () => {
  it('reorders, keeping ids, and the active step follows its text', async () => {
    const row = multitrack(['a', 'b', 'c'], 0);
    const [first, second, third] = row.steps as Array<{ id: string; name: string; code: string }>;
    await tools.call('set_track_steps', {
      trackId: 'm',
      expectedVersion: row.updated_at,
      steps: [third, first, second],
    });
    expect(siteUpdates()).toMatchObject({ activeStep: 1, code: 'a', isMultitrack: true });
    expect((siteUpdates().steps as Array<{ id: string }>).map((step) => step.id)).toEqual(['s2', 's0', 's1']);
  });

  it('turns a plain track into a multitrack', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'old' });
    await tools.call('set_track_steps', {
      trackId: 't',
      expectedVersion: row.updated_at,
      steps: [{ name: 'One', code: 'new' }],
    });
    expect(row).toMatchObject({ is_multitrack: true, code: 'new', active_step: 0 });
  });

  it('gives a repeated id a new one, so the app can tell the steps apart', async () => {
    const row = multitrack(['a']);
    await tools.call('set_track_steps', {
      trackId: 'm',
      expectedVersion: row.updated_at,
      steps: [
        { id: 's0', name: 'A', code: 'a' },
        { id: 's0', name: 'B', code: 'b' },
      ],
    });
    const ids = (siteUpdates().steps as Array<{ id: string }>).map((step) => step.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('refuses an empty list, as that would drop the music', async () => {
    const row = multitrack(['a']);
    const { error } = await tools.call('set_track_steps', { trackId: 'm', expectedVersion: row.updated_at, steps: [] });
    expect(error.code).toBe('invalid_arguments');
    expect(library.siteCalls).toEqual([]);
  });

  it('refuses a stale version, a step over 512 KB and an active step that is not there', async () => {
    const row = multitrack(['a']);
    const version = row.updated_at;
    const step = { name: 'A', code: 'a' };
    const stale = await tools.call('set_track_steps', { trackId: 'm', expectedVersion: 'old', steps: [step] });
    expect(stale.error.code).toBe('version_conflict');
    const big = await tools.call('set_track_steps', {
      trackId: 'm',
      expectedVersion: version,
      steps: [{ name: 'A', code: OVER_LIMIT }],
    });
    expect(big.error.code).toBe('too_large');
    const active = await tools.call('set_track_steps', {
      trackId: 'm',
      expectedVersion: version,
      steps: [step],
      activeStep: 1,
    });
    expect(active.error.code).toBe('invalid_arguments');
    expect(library.siteCalls).toEqual([]);
  });
});

describe('delete_track', () => {
  it('deletes one track, naming the version', async () => {
    const row = library.addTrack({ id: 't', name: 'Song' });
    const { structured } = await tools.call('delete_track', { trackId: 't', expectedVersion: row.updated_at });
    expect(structured).toEqual({ deleted: 't' });
    expect(library.tracks).toEqual([]);
  });

  it('requires a version, and keeps a track that has changed', async () => {
    const row = library.addTrack({ id: 't', name: 'Song' });
    const missing = await tools.call('delete_track', { trackId: 't' });
    expect(missing.error.code).toBe('invalid_arguments');
    expect(library.siteCalls).toEqual([]);
    const stale = await tools.call('delete_track', { trackId: 't', expectedVersion: 'old' });
    expect(stale.error).toMatchObject({ code: 'version_conflict', currentVersion: row.updated_at });
    expect(library.tracks).toHaveLength(1);
  });

  it('gives "Track not found" for someone else\'s track, and leaves it', async () => {
    const theirs = library.addTrack({ id: 'theirs', name: 'x', user_id: OTHER_USER });
    const { error } = await tools.call('delete_track', { trackId: 'theirs', expectedVersion: theirs.updated_at });
    expect(error).toEqual({ code: 'not_found', message: 'Track not found' });
    expect(library.tracks).toHaveLength(1);
  });
});

describe('delete_step', () => {
  it.each([
    ['before the active one', 1, 0, 'b', 0],
    ['after the active one', 1, 2, 'b', 1],
    ['the active one', 1, 1, 'a', 0],
  ])('deletes a step %s, and code follows the active step', async (_label, active, index, code, activeStep) => {
    const row = multitrack(['a', 'b', 'c'], active);
    await tools.call('delete_step', { trackId: 'm', expectedVersion: row.updated_at, stepIndex: index });
    expect(siteUpdates()).toMatchObject({ code, activeStep });
    expect(siteUpdates().steps).toHaveLength(2);
  });

  it('refuses the last step, a plain track, a step not there and a stale version', async () => {
    const one = multitrack(['a']);
    const last = await tools.call('delete_step', { trackId: 'm', expectedVersion: one.updated_at, stepIndex: 0 });
    expect(last.error).toMatchObject({ code: 'last_step', next: 'Delete the track instead.' });
    const plain = library.addTrack({ id: 'p', name: 'Plain' });
    const onPlain = await tools.call('delete_step', { trackId: 'p', expectedVersion: plain.updated_at, stepIndex: 0 });
    expect(onPlain.error.code).toBe('invalid_arguments');
    const absent = await tools.call('delete_step', { trackId: 'm', expectedVersion: one.updated_at, stepIndex: 9 });
    expect(absent.error.code).toBe('invalid_arguments');
    const stale = await tools.call('delete_step', { trackId: 'm', expectedVersion: 'old', stepIndex: 0 });
    expect(stale.error.code).toBe('version_conflict');
    expect(library.siteCalls).toEqual([]);
  });
});

describe('folders', () => {
  it('creates one with an id shaped like the ones the app makes, which addresses depend on', async () => {
    const { structured } = await tools.call('create_folder', { name: 'Live' });
    expect(structured).toMatchObject({ name: 'Live', path: 'Live', parent: null });
    expect(library.folders[0].id).toMatch(/^[\w-]{21}$/);
    library.addTrack({ id: 't', name: 'Song', folder: library.folders[0].id });
    const listed = await tools.call('search_tracks');
    expect(listed.structured.tracks[0].webAddress).toBe(`${ORIGIN}/repl/live/song`);
  });

  it('refuses a taken name', async () => {
    library.addFolder({ id: 'f', name: 'Live' });
    expect((await tools.call('create_folder', { name: 'Live' })).error.code).toBe('name_taken');
  });

  it('renames and moves, naming the version, and answers with the new one', async () => {
    const parent = library.addFolder({ id: 'p', name: 'Parent' });
    const row = library.addFolder({ id: 'f', name: 'Live' });
    const version = row.updated_at;
    const renamed = await tools.call('rename_folder', { folderId: 'f', expectedVersion: version, name: 'Sets' });
    expect(library.siteCalls.at(-1)!.body).toMatchObject({ expectedVersion: version, updates: { name: 'Sets' } });
    expect(renamed.structured.version).toBe(row.updated_at);
    const moved = await tools.call('move_folder', {
      folderId: 'f',
      expectedVersion: renamed.structured.version,
      parent: parent.id,
    });
    expect(moved.structured.parent).toBe('p');
  });

  it('refuses a stale version on rename and move', async () => {
    library.addFolder({ id: 'f', name: 'Live' });
    const rename = await tools.call('rename_folder', { folderId: 'f', expectedVersion: 'old', name: 'x' });
    expect(rename.error.code).toBe('version_conflict');
    const move = await tools.call('move_folder', { folderId: 'f', expectedVersion: 'old', parent: null });
    expect(move.error.code).toBe('version_conflict');
    expect(library.folders[0].name).toBe('Live');
  });

  it('deletes an empty folder', async () => {
    const row = library.addFolder({ id: 'f', name: 'Live' });
    const { structured } = await tools.call('delete_empty_folder', { folderId: 'f', expectedVersion: row.updated_at });
    expect(structured).toEqual({ deleted: 'f' });
    expect(library.folders).toEqual([]);
  });

  it('refuses a folder with something in it, saying what', async () => {
    const row = library.addFolder({ id: 'f', name: 'Live' });
    library.addTrack({ id: 't', name: 'Song', folder: 'f' });
    const { error } = await tools.call('delete_empty_folder', { folderId: 'f', expectedVersion: row.updated_at });
    expect(error).toMatchObject({ code: 'folder_not_empty', contents: { trackCount: 1, tracks: ['Song'] } });
    expect(library.folders).toHaveLength(1);
  });

  it('gives "Folder not found" for someone else\'s', async () => {
    const theirs = library.addFolder({ id: 'theirs', name: 'x', user_id: OTHER_USER });
    const { error } = await tools.call('delete_empty_folder', {
      folderId: 'theirs',
      expectedVersion: theirs.updated_at,
    });
    expect(error).toEqual({ code: 'not_found', message: 'Folder not found' });
  });
});

describe('when the site is out of reach', () => {
  it('says nothing was changed', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'old' });
    library.failing.site = true;
    const { error } = await tools.call('update_track', { trackId: 't', expectedVersion: row.updated_at, code: 'new' });
    expect(error).toMatchObject({
      code: 'service_unavailable',
      message: expect.stringContaining('nothing was changed'),
    });
    expect(row.code).toBe('old');
  });

  it.each([
    [500, 'service_unavailable'],
    [401, 'reconnect'],
    [413, 'too_large'],
  ])('maps a %i from a route to %s', async (status, code) => {
    const row = library.addTrack({ id: 't', name: 'Song' });
    library.failing.siteStatus = status;
    const { error } = await tools.call('delete_track', { trackId: 't', expectedVersion: row.updated_at });
    expect(error.code).toBe(code);
  });

  it('passes the assistant token to the route, and no other credential', async () => {
    const seen: Headers[] = [];
    tools = toolCaller(
      library,
      {},
      {
        site: (request) => {
          seen.push(request.headers);
          return library.site(request);
        },
      },
    );
    const row = library.addTrack({ id: 't', name: 'Song' });
    await tools.call('delete_track', { trackId: 't', expectedVersion: row.updated_at });
    expect(seen[0].get('authorization')).toMatch(/^Bearer /);
    expect(seen[0].get('cookie')).toBeNull();
  });
});
