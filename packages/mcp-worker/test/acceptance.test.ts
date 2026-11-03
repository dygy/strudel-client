/**
 * @spec: 018-strudel-mcp-server
 * @regression
 * Acceptance criteria no other test held: what an assistant is actually told, and what the deployed
 * entry point wires up. See coverage.md for which test holds each criterion.
 */
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import entry from '../src/index';
import { RATE_LIMIT_PER_MINUTE } from '../src/handler';
import { fakeLibrary, OTHER_USER, toolCaller, type FakeLibrary } from './fakeLibrary';
import { runQuery } from './fakePostgrest.mjs';
import {
  ANON_KEY,
  assistantToken,
  MCP_URL,
  ORIGIN,
  post,
  rpcBody,
  SUPABASE_URL,
  USER,
  withToken,
  worker,
} from './helpers';
import type { Env } from '../src/env';

let library: FakeLibrary;
let tools: ReturnType<typeof toolCaller>;

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  library = fakeLibrary();
  tools = toolCaller(library);
});
afterEach(() => vi.unstubAllGlobals());

describe('2.3 a search result says where the track is', () => {
  it('a word in the code finds the track, with its folder and its address', async () => {
    library.addFolder({ id: 'V1StGXR8_Z5jdHi6B-myT', name: 'Live Sets', path: 'Live Sets' });
    library.addTrack({ id: 't', name: 'My Song', code: 's("sunrise")', folder: 'V1StGXR8_Z5jdHi6B-myT' });
    const { structured } = await tools.call('search_tracks', { query: 'sunrise' });
    expect(structured.tracks).toHaveLength(1);
    expect(structured.tracks[0]).toMatchObject({
      id: 't',
      folder: 'V1StGXR8_Z5jdHi6B-myT',
      webAddress: `${ORIGIN}/repl/live-sets/my-song`,
    });
  });

  it('a word in no name and no code finds nothing', async () => {
    library.addTrack({ id: 't', name: 'My Song', code: 's("bd")' });
    expect((await tools.call('search_tracks', { query: 'sunrise' })).structured.tracks).toEqual([]);
  });
});

describe('2.4 and 2.6 a track that changed since it was read', () => {
  const CHANGED = 'This track changed since you read it';

  it('a save is told in those words, and nothing is saved', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'typed by the user' });
    const { error } = await tools.call('update_track', { trackId: 't', expectedVersion: 'stale', code: 'new' });
    expect(error.message).toBe(CHANGED);
    expect(row.code).toBe('typed by the user');
    expect(library.siteCalls).toEqual([]);
  });

  it('a save the route refuses, because a write got in first, is told the same', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'old' });
    const version = row.updated_at;
    library.hooks.beforeRoute = () => {
      row.updated_at = 'opaque-newer';
    };
    const { error } = await tools.call('update_track', { trackId: 't', expectedVersion: version, code: 'new' });
    expect(error.message).toBe(CHANGED);
    expect(row.code).toBe('old');
  });

  it('a delete is told the same, and the track stays', async () => {
    library.addTrack({ id: 't', name: 'Song' });
    const { error } = await tools.call('delete_track', { trackId: 't', expectedVersion: 'stale' });
    expect(error.message).toBe(CHANGED);
    expect(library.tracks).toHaveLength(1);
  });

  it('the version it read is saved with no such message', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'old' });
    const { isError, text } = await tools.call('update_track', {
      trackId: 't',
      expectedVersion: row.updated_at,
      code: 'new',
    });
    expect(isError).toBeUndefined();
    expect(text).not.toContain(CHANGED);
    expect(row.code).toBe('new');
  });
});

describe('2.4 code over the limit', () => {
  it('is told the limit, and nothing is saved', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'old' });
    const { error } = await tools.call('update_track', {
      trackId: 't',
      expectedVersion: row.updated_at,
      code: 'x'.repeat(512 * 1024 + 1),
    });
    expect(error.message).toContain('512 KB');
    expect(row.code).toBe('old');
    expect(library.siteCalls).toEqual([]);
  });

  it('code of exactly the limit hears nothing about it', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'old' });
    const code = 'x'.repeat(512 * 1024);
    const { isError } = await tools.call('update_track', { trackId: 't', expectedVersion: row.updated_at, code });
    expect(isError).toBeUndefined();
    expect(row.code).toBe(code);
  });
});

describe('2.4 a change with several fields, one of them invalid', () => {
  it.each([
    ['a name the app refuses', 'a<b'],
    ['an empty name', '   '],
    ['a name that is too long', 'x'.repeat(101)],
  ])('saves nothing at all with %s beside good code', async (_label, name) => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'old' });
    const version = row.updated_at;
    const { error } = await tools.call('update_track', { trackId: 't', expectedVersion: version, code: 'new', name });
    expect(error.code).toBe('invalid_arguments');
    expect(library.siteCalls).toEqual([]);
    expect(row).toMatchObject({ name: 'Song', code: 'old', updated_at: version });
  });

  it('saves nothing at all with one bad step beside good ones', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'old' });
    const { error } = await tools.call('set_track_steps', {
      trackId: 't',
      expectedVersion: row.updated_at,
      steps: [
        { name: 'Fine', code: 'new' },
        { name: '   ', code: 'new too' },
      ],
    });
    expect(error.code).toBe('invalid_arguments');
    expect(library.siteCalls).toEqual([]);
    expect(row).toMatchObject({ code: 'old', steps: null });
  });

  it('saves all of it when every field is good', async () => {
    const row = library.addTrack({ id: 't', name: 'Song', code: 'old' });
    const { isError } = await tools.call('update_track', {
      trackId: 't',
      expectedVersion: row.updated_at,
      code: 'new',
      name: 'Other',
    });
    expect(isError).toBeUndefined();
    expect(library.siteCalls).toHaveLength(1);
    expect(row).toMatchObject({ name: 'Other', code: 'new' });
  });
});

describe('2.7 looking up a function', () => {
  /** The JSDoc the site's reference is made from. */
  const reference = (name: string) => {
    const source = readFileSync(resolve(process.cwd(), 'packages/core/controls.mjs'), 'utf8');
    const block = source.split('/**').find((part) => part.includes(` * @name ${name}\n`));
    if (!block) throw new Error(`no reference for ${name}`);
    const lines = block
      .split('*/')[0]
      .split('\n')
      .map((line) => line.replace(/^\s*\* ?/, ''));
    const examples: string[] = [];
    lines.forEach((line, i) => {
      if (line.startsWith('@example')) examples.push(lines[i + 1].trim());
    });
    const param = lines.find((line) => line.startsWith('@param'))!;
    return { examples, param };
  };

  it("gives every parameter and every example in the site's reference", async () => {
    const { examples, param } = reference('lpf');
    expect(examples).toHaveLength(2);
    const { structured } = await tools.call('lookup_function', { name: 'lpf' });
    expect(structured.examples).toEqual(expect.arrayContaining(examples));
    const [first] = structured.params as Array<{ name: string; type: string; description: string }>;
    expect(param).toBe(`@param {${first.type}} ${first.name} ${first.description}`);
  });

  it('gives no parameters or examples for a function that does not exist', async () => {
    const { isError, text } = await tools.call('lookup_function', { name: 'zzzzzz' });
    expect(isError).toBe(true);
    expect(JSON.parse(text)).not.toHaveProperty('params');
    expect(JSON.parse(text)).not.toHaveProperty('examples');
  });
});

describe('2.10 the limit of 120 requests a minute', () => {
  const wrangler = readFileSync(resolve(process.cwd(), 'packages/mcp-worker/wrangler.jsonc'), 'utf8');

  /** The deployed entry point, with its own bindings: nothing injected but what Cloudflare provides. */
  const deployed = (success: boolean) => {
    const keys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(JSON.stringify(String(input).includes('/auth/v1/user') ? USER : []), { status: 200 }),
      ),
    );
    const env = {
      PUBLIC_SUPABASE_URL: SUPABASE_URL,
      PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      MCP_RATE: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return { success };
        },
      },
    } as unknown as Env;
    return { keys, fetch: (init: RequestInit) => entry.fetch(new Request(MCP_URL, init), env) };
  };
  const listFolders = post(rpcBody('tools/call', { name: 'list_folders', arguments: {} }), withToken(assistantToken()));

  it('is what the binding enforces and what the assistant is told', async () => {
    expect(RATE_LIMIT_PER_MINUTE).toBe(120);
    expect(wrangler).toMatch(/"name":\s*"MCP_RATE"[^\n]*"limit":\s*120,\s*"period":\s*60/);
    const answer = await (await deployed(false).fetch(listFolders)).json();
    expect(answer.result.isError).toBe(true);
    const error = JSON.parse(answer.result.content[0].text);
    expect(error).toMatchObject({ code: 'rate_limited', next: expect.stringContaining('Wait a minute') });
    expect(error.message).toContain('120');
  });

  it("a request past it counts against that user, through the deployed Worker's own binding", async () => {
    const { keys, fetch } = deployed(false);
    await fetch(listFolders);
    expect(keys).toEqual([USER.id]);
  });

  it('a request that is not a tool call gets a 429 saying when to retry', async () => {
    const response = await deployed(false).fetch(post(rpcBody('tools/list'), withToken(assistantToken())));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(JSON.stringify(await response.json())).toContain('Wait a minute');
  });

  it('a request within it goes through', async () => {
    const answer = await (await deployed(true).fetch(listFolders)).json();
    expect(answer.result.isError).toBeUndefined();
    expect(answer.result.structuredContent.folders).toEqual([]);
  });
});

describe('2.12 an admin connecting an assistant', () => {
  const ADMIN = { id: USER.id, email: 'admin@example.test', app_metadata: { role: 'admin' } };
  const token = assistantToken({ app_metadata: { role: 'admin' } });

  /** The worst case: a database that shows an admin everything, so only the Worker's own filter is left. */
  const adminCaller = () => {
    const authorizations: Array<string | null> = [];
    const w = worker(
      (url, init) => {
        if (url.includes('/auth/v1/user')) return new Response(JSON.stringify(ADMIN));
        authorizations.push(new Headers(init?.headers).get('authorization'));
        const { pathname, searchParams } = new URL(url);
        const rows = pathname.endsWith('/tracks') ? library.tracks : library.folders;
        return new Response(JSON.stringify(runQuery(rows, searchParams)));
      },
      {},
      { site: library.site },
    );
    const call = async (name: string, args: unknown = {}) => {
      const response = await w.fetch(MCP_URL, post(rpcBody('tools/call', { name, arguments: args }), withToken(token)));
      const { result } = (await response.json()) as {
        result: { isError?: boolean; structuredContent: Record<string, never>; content: Array<{ text: string }> };
      };
      return {
        structured: result.structuredContent,
        error: result.isError ? JSON.parse(result.content[0].text) : {},
        text: result.content[0].text,
      };
    };
    return { call, authorizations };
  };

  beforeEach(() => {
    library.addFolder({ id: 'mine-f', name: 'Mine' });
    library.addFolder({ id: 'theirs-f', name: 'Theirs', user_id: OTHER_USER });
    library.addTrack({ id: 'mine', name: 'Mine', code: 'MY_CODE', folder: 'mine-f' });
    library.addTrack({ id: 'theirs', name: 'Theirs', code: 'THEIR_CODE', folder: 'theirs-f', user_id: OTHER_USER });
  });

  it("reaches the admin's own library", async () => {
    const { call } = adminCaller();
    expect((await call('get_track', { trackId: 'mine' })).structured).toMatchObject({ code: 'MY_CODE' });
    const { structured } = await call('search_tracks');
    expect(structured.tracks.map((t: { id: string }) => t.id)).toEqual(['mine']);
    const listed = await call('list_folders');
    expect(listed.structured.folders.map((f: { id: string }) => f.id)).toEqual(['mine-f']);
  });

  it("can't read another user's track, or tell that it exists", async () => {
    const { call } = adminCaller();
    const theirs = await call('get_track', { trackId: 'theirs' });
    expect(theirs.error).toEqual({ code: 'not_found', message: 'Track not found' });
    expect(theirs.text).toBe((await call('get_track', { trackId: 'nothing' })).text);
    expect((await call('search_tracks', { query: 'THEIR_CODE' })).structured.tracks).toEqual([]);
  });

  it("can't change another user's track, and the route is never asked", async () => {
    const { call } = adminCaller();
    const row = library.tracks.find((t) => t.id === 'theirs')!;
    const { error } = await call('update_track', { trackId: 'theirs', expectedVersion: row.updated_at, code: 'mine' });
    expect(error).toEqual({ code: 'not_found', message: 'Track not found' });
    expect(library.siteCalls).toEqual([]);
    expect(row.code).toBe('THEIR_CODE');
  });

  it("reads with the admin's own token, and no other credential", async () => {
    const { call, authorizations } = adminCaller();
    await call('search_tracks');
    expect(authorizations.length).toBeGreaterThan(0);
    expect(new Set(authorizations)).toEqual(new Set([`Bearer ${token}`]));
  });
});
