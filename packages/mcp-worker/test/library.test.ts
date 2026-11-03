/**
 * @spec: 018-strudel-mcp-server (slice 4)
 * Reading the library, through the whole handler, against a stand-in for Supabase REST.
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

const allPages = async (name: string, args: Record<string, unknown>, listKey: string) => {
  const items: Array<Record<string, unknown>> = [];
  const sizes: number[] = [];
  let cursor: string | null = null;
  do {
    const { structured } = await tools.call(name, { ...args, ...(cursor ? { cursor } : {}) });
    const page = structured[listKey] as Array<Record<string, unknown>>;
    items.push(...page);
    sizes.push(page.length);
    cursor = structured.nextCursor;
  } while (cursor);
  return { items, sizes };
};

describe('list_folders', () => {
  it('pages to the end with each folder once, 50 to a page', async () => {
    for (let i = 0; i < 120; i++) library.addFolder({ id: `f${String(i).padStart(3, '0')}`, name: `folder ${i}` });
    const { items, sizes } = await allPages('list_folders', {}, 'folders');
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(items.map((f) => f.id)).size).toBe(120);
    expect(items[0]).toEqual({
      id: 'f000',
      name: 'folder 0',
      path: 'folder 0',
      parent: null,
      version: library.folders[0].updated_at,
    });
  });

  it("shows nobody else's folders", async () => {
    library.addFolder({ id: 'theirs', name: 'theirs', user_id: OTHER_USER });
    expect((await tools.call('list_folders')).structured.folders).toEqual([]);
  });

  it('refuses a cursor it did not give, with a next step', async () => {
    const { error } = await tools.call('list_folders', { cursor: 'not a cursor' });
    expect(error).toMatchObject({ code: 'invalid_arguments', next: expect.stringContaining('without a cursor') });
  });
});

describe('search_tracks', () => {
  it('pages to the end with each track once, including tracks changed at the same moment', async () => {
    for (let i = 0; i < 120; i++) {
      library.addTrack({
        id: `t${String(i).padStart(3, '0')}`,
        name: `track ${i}`,
        // Three runs of identical timestamps, one of them across a page boundary.
        modified: `2026-01-0${(i % 3) + 1}T00:00:00.000Z`,
      });
    }
    const { items, sizes } = await allPages('search_tracks', {}, 'tracks');
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(items.map((t) => t.id)).size).toBe(120);
  });

  it('never carries code in a list', async () => {
    library.addTrack({ id: 't', name: 'a', code: 'SECRET_CODE' });
    const { text, structured } = await tools.call('search_tracks');
    expect(text).not.toContain('SECRET_CODE');
    expect(structured.tracks[0]).not.toHaveProperty('code');
    // Not even from the database: a page of 50 whole tracks wouldn't fit in 10 ms.
    const read = new URL(tools.upstreamCalls.at(-1)!.url).searchParams.get('select');
    expect(read?.split(',')).not.toContain('code');
  });

  it('finds by name and by text in the code, whatever the case', async () => {
    library.addTrack({ id: 'by-name', name: 'Sunrise' });
    library.addTrack({ id: 'by-code', name: 'other', code: 's("SUNRISE")' });
    library.addTrack({ id: 'neither', name: 'unrelated', code: 's("bd")' });
    const { structured } = await tools.call('search_tracks', { query: 'sunrise' });
    expect(structured.tracks.map((t: { id: string }) => t.id).sort()).toEqual(['by-code', 'by-name']);
  });

  it.each([
    ['a comma and brackets', 'a,b(c)'],
    ['a double quote', 'say "hi"'],
    ['a backslash', 'back\\slash'],
    ['a percent sign', '100%'],
    ['an underscore', 'a_b'],
  ])('takes %s as plain text', async (_label, query) => {
    library.addTrack({ id: 'hit', name: `x ${query} y` });
    library.addTrack({ id: 'miss', name: 'a1b 1000 aXb nothing' });
    const { structured, isError } = await tools.call('search_tracks', { query });
    expect(isError).toBeUndefined();
    expect(structured.tracks.map((t: { id: string }) => t.id)).toEqual(['hit']);
  });

  it('keeps to one folder, by id or by the path older rows hold', async () => {
    library.addFolder({ id: 'f1', name: 'Live', path: 'Live' });
    library.addTrack({ id: 'by-id', name: 'a', folder: 'f1' });
    library.addTrack({ id: 'by-path', name: 'b', folder: 'Live' });
    library.addTrack({ id: 'elsewhere', name: 'c', folder: null });
    const { structured } = await tools.call('search_tracks', { folder: 'f1' });
    expect(structured.tracks.map((t: { id: string }) => t.id).sort()).toEqual(['by-id', 'by-path']);
  });

  it('keeps to the top level with "root", however the row says it', async () => {
    library.addFolder({ id: 'f1', name: 'Live' });
    library.addTrack({ id: 'null', name: 'a', folder: null });
    library.addTrack({ id: 'word', name: 'b', folder: 'root' });
    library.addTrack({ id: 'inside', name: 'c', folder: 'f1' });
    const { structured } = await tools.call('search_tracks', { folder: 'root' });
    expect(structured.tracks.map((t: { id: string }) => t.id).sort()).toEqual(['null', 'word']);
  });

  it('gives "Folder not found" for a folder that is not yours', async () => {
    library.addFolder({ id: 'theirs', name: 'theirs', user_id: OTHER_USER });
    const { error } = await tools.call('search_tracks', { folder: 'theirs' });
    expect(error).toMatchObject({ code: 'not_found', message: 'Folder not found' });
  });

  it('gives each track the address that opens it, and the version a change must name', async () => {
    library.addFolder({ id: 'V1StGXR8_Z5jdHi6B-myT', name: 'Live Sets', path: 'Live Sets' });
    const row = library.addTrack({ id: 't', name: 'My Song', folder: 'V1StGXR8_Z5jdHi6B-myT' });
    const { structured } = await tools.call('search_tracks');
    expect(structured.tracks[0]).toMatchObject({
      webAddress: `${ORIGIN}/repl/live-sets/my-song`,
      version: row.updated_at,
    });
  });
});

describe('get_track', () => {
  it('reads a track with its code, version and address', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 's("bd")' });
    const { structured } = await tools.call('get_track', { trackId: 't' });
    expect(structured).toMatchObject({
      id: 't',
      code: 's("bd")',
      isMultitrack: false,
      steps: [],
      version: row.updated_at,
      webAddress: `${ORIGIN}/repl/song`,
    });
  });

  it('reads a multitrack: every step in order, and the active one', async () => {
    const steps = [
      { id: 's1', name: 'Intro', code: 's("a")' },
      { id: 's2', name: 'Drop', code: 's("b")' },
    ];
    library.addTrack({ id: 't', name: 'Song', code: 's("b")', is_multitrack: true, steps, active_step: 1 });
    const { structured } = await tools.call('get_track', { trackId: 't' });
    expect(structured).toMatchObject({ isMultitrack: true, activeStep: 1, code: 's("b")', steps });
  });

  it("shows old edits found only in code as a step, so they aren't hidden from the assistant", async () => {
    const steps = [{ id: 's1', name: 'Intro', code: 's("a")' }];
    library.addTrack({ id: 't', name: 'Song', code: 'old edits', is_multitrack: true, steps, active_step: 0 });
    const { structured } = await tools.call('get_track', { trackId: 't' });
    expect(structured.steps.map((s: { code: string }) => s.code)).toContain('old edits');
  });

  it("answers the same for another user's track as for one that never existed", async () => {
    library.addTrack({ id: 'theirs', name: 'x', code: 'THEIR_CODE', user_id: OTHER_USER });
    const theirs = await tools.call('get_track', { trackId: 'theirs' });
    const missing = await tools.call('get_track', { trackId: 'nothing' });
    expect(theirs.error).toEqual({ code: 'not_found', message: 'Track not found' });
    expect(theirs.text).toBe(missing.text);
  });
});

describe('when reading fails', () => {
  it('says the library could not be reached, as a result rather than a protocol error', async () => {
    library.failing.rest = true;
    const { error, isError } = await tools.call('get_track', { trackId: 't' });
    expect(isError).toBe(true);
    expect(error.code).toBe('service_unavailable');
  });

  it.each([401, 403])('asks to connect again on a %i from the database', async (status) => {
    library.failing.rest = true;
    library.failing.restStatus = status;
    expect((await tools.call('list_folders')).error.code).toBe('reconnect');
  });

  it('refuses bad arguments by saying where, as a result', async () => {
    const { error } = await tools.call('get_track', {});
    expect(error).toMatchObject({ code: 'invalid_arguments', message: 'arguments.trackId is required' });
  });
});

describe('what gets logged', () => {
  it('holds a stable code and a handler, and nothing from the library, on any path', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    library.addFolder({ id: 'V1StGXR8_Z5jdHi6B-myT', name: 'PRIVATE_FOLDER' });
    library.addTrack({ id: 't', name: 'PRIVATE_NAME', code: 'PRIVATE_CODE', folder: 'V1StGXR8_Z5jdHi6B-myT' });
    await tools.call('search_tracks', { query: 'PRIVATE' });
    await tools.call('get_track', { trackId: 't' });
    await tools.call('get_track', { trackId: 'PRIVATE_ID' });
    await tools.call('create_track', { name: 'PRIVATE_NAME', folder: 'V1StGXR8_Z5jdHi6B-myT' });
    const printed = log.mock.calls.flat().join(' ');
    log.mockRestore();
    expect(printed).not.toMatch(/PRIVATE|V1StGXR8/);
    expect(tools.logs.map((entry) => [entry.handler, entry.outcome])).toEqual([
      ['tools/call:search_tracks', 'ok'],
      ['tools/call:get_track', 'ok'],
      ['tools/call:get_track', 'not_found'],
      ['tools/call:create_track', 'name_taken'],
    ]);
    expect(JSON.stringify(tools.logs)).not.toMatch(/PRIVATE/);
  });
});

describe('the rate limit', () => {
  const limitedTo = (allowed: number) => {
    let used = 0;
    return async () => ++used > allowed;
  };

  it('answers a tool call over the limit with a result saying what to do', async () => {
    tools = toolCaller(library, {}, { isRateLimited: limitedTo(1) });
    expect((await tools.call('list_folders')).isError).toBeUndefined();
    const over = await tools.call('list_folders');
    expect(over.error).toMatchObject({ code: 'rate_limited', next: expect.stringContaining('Wait a minute') });
    expect(tools.logs[1]).toMatchObject({ handler: 'tools/call:list_folders', outcome: 'rate_limited' });
  });

  it('counts per user', async () => {
    const asked: string[] = [];
    tools = toolCaller(library, {}, { isRateLimited: async (user) => (asked.push(user), false) });
    await tools.call('list_folders');
    expect(asked).toEqual(['user-1']);
  });

  it('stays open when the limiter itself fails', async () => {
    tools = toolCaller(library, {}, { isRateLimited: () => Promise.reject(new Error('down')) });
    expect((await tools.call('list_folders')).isError).toBeUndefined();
  });
});
