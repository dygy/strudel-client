/**
 * @spec: 018-strudel-mcp-server (tech 2.1, 2.2)
 * Every tool through the official SDK client, over its real transport. After `listTools` the SDK checks
 * each success against the tool's output schema, and throws if it doesn't fit.
 */
import { webcrypto } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeLibrary, type FakeLibrary } from './fakeLibrary';
import { assistantToken, MCP_URL, worker } from './helpers';

let client: Client;
let library: FakeLibrary;

const STEPS = [
  { id: 's0', name: 'One', code: 'a' },
  { id: 's1', name: 'Two', code: 'b' },
];

/** A call that succeeds and one that fails, for every tool. Arguments may read the fixtures. */
const CASES: Record<string, { good: () => Record<string, unknown>; bad: Record<string, unknown>; code: string }> = {
  whoami: { good: () => ({}), bad: { extra: 1 }, code: 'invalid_arguments' },
  list_folders: { good: () => ({}), bad: { cursor: 'nope' }, code: 'invalid_arguments' },
  search_tracks: { good: () => ({ query: 'plain' }), bad: { folder: 'absent' }, code: 'not_found' },
  get_track: { good: () => ({ trackId: 'multi' }), bad: { trackId: 'absent' }, code: 'not_found' },
  create_track: { good: () => ({ name: 'New', code: 'x' }), bad: { name: 'Plain' }, code: 'name_taken' },
  update_track: {
    good: () => ({ trackId: 'plain', expectedVersion: version('plain'), code: 'y' }),
    bad: { trackId: 'plain', expectedVersion: 'old', code: 'y' },
    code: 'version_conflict',
  },
  move_track: {
    good: () => ({ trackId: 'plain', expectedVersion: version('plain'), folder: 'empty' }),
    bad: { trackId: 'absent', expectedVersion: 'old', folder: null },
    code: 'not_found',
  },
  set_track_steps: {
    good: () => ({ trackId: 'multi', expectedVersion: version('multi'), steps: STEPS }),
    bad: { trackId: 'multi', expectedVersion: 'old', steps: STEPS },
    code: 'version_conflict',
  },
  create_folder: { good: () => ({ name: 'New folder' }), bad: { name: 'Empty' }, code: 'name_taken' },
  rename_folder: {
    good: () => ({ folderId: 'empty', expectedVersion: folderVersion('empty'), name: 'Other' }),
    bad: { folderId: 'empty', expectedVersion: 'old', name: 'Other' },
    code: 'version_conflict',
  },
  move_folder: {
    good: () => ({ folderId: 'empty', expectedVersion: folderVersion('empty'), parent: null }),
    bad: { folderId: 'absent', expectedVersion: 'old', parent: null },
    code: 'not_found',
  },
  delete_track: {
    good: () => ({ trackId: 'plain', expectedVersion: version('plain') }),
    bad: { trackId: 'plain', expectedVersion: 'old' },
    code: 'version_conflict',
  },
  delete_step: {
    good: () => ({ trackId: 'multi', expectedVersion: version('multi'), stepIndex: 1 }),
    bad: { trackId: 'plain', expectedVersion: 'old', stepIndex: 0 },
    code: 'version_conflict',
  },
  delete_empty_folder: {
    good: () => ({ folderId: 'empty', expectedVersion: folderVersion('empty') }),
    bad: { folderId: 'absent', expectedVersion: 'old' },
    code: 'not_found',
  },
  lookup_function: { good: () => ({ name: 'lpf' }), bad: { name: 'zzzzzz' }, code: 'not_found' },
  search_functions: { good: () => ({ query: 'filter' }), bad: { query: '' }, code: 'invalid_arguments' },
  list_sounds: { good: () => ({ kind: 'synths' }), bad: { kind: 'none' }, code: 'invalid_arguments' },
  list_tabs: { good: () => ({}), bad: { extra: 1 }, code: 'invalid_arguments' },
  play: { good: () => ({}), bad: { tabId: 1 }, code: 'invalid_arguments' },
  stop: { good: () => ({}), bad: { tabId: 1 }, code: 'invalid_arguments' },
  update_code: { good: () => ({ code: 'ok', trackId: 't' }), bad: { code: 'bad', trackId: 't' }, code: 'code_error' },
  open_track: { good: () => ({ trackId: 't' }), bad: { trackId: 'absent' }, code: 'not_found' },
  check_code: { good: () => ({ code: 's("bd [sd")' }), bad: { code: 'x'.repeat(9000) }, code: 'use_local_helper' },
};

const TAB_RESULT = { track: null, playing: true, cps: 0.5, transition: 'idle', changedElsewhere: false };
const relay = {
  idFromName: (name: string) => name,
  get: () => ({
    fetch: async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      const args = JSON.parse(init.body) as Record<string, unknown>;
      if (init.headers['x-command'] === 'status') return Response.json({ ok: true, tabs: [TAB_RESULT] });
      if (args.trackId === 'absent') return Response.json({ ok: false, code: 'not_found' });
      if (args.code === 'bad')
        return Response.json({ ok: false, code: 'code_error', error: { message: 'x', line: 1 } });
      return args.tabId === undefined && init.headers['x-tab-id'] === 'none'
        ? Response.json({ ok: false, code: 'no_tab' })
        : Response.json({ ok: true, result: TAB_RESULT });
    },
  }),
};

const version = (id: string) => library.tracks.find((t) => t.id === id)!.updated_at;
const folderVersion = (id: string) => library.folders.find((f) => f.id === id)!.updated_at;

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  library = fakeLibrary();
  library.addFolder({ id: 'empty', name: 'Empty' });
  library.addTrack({ id: 'plain', name: 'Plain', code: 'x' });
  library.addTrack({ id: 'multi', name: 'Multi', code: 'a', is_multitrack: true, steps: STEPS, active_step: 0 });
  const w = worker(library.upstream, { TAB_RELAY: relay as never }, { site: library.site });
  client = new Client({ name: 'conformance-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: w.fetch as typeof fetch,
      requestInit: { headers: { authorization: `Bearer ${assistantToken()}` } },
    }),
  );
});
afterEach(async () => {
  await client.close();
  vi.unstubAllGlobals();
});

describe('tools/list through the SDK', () => {
  it('lists every tool, and this file covers every one', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(CASES).sort());
  });

  it('gives every tool a title, a description, all four hints and both schemas', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(tool.outputSchema?.type, tool.name).toBe('object');
      expect(Object.keys(tool.annotations ?? {}).sort(), tool.name).toEqual([
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
        'readOnlyHint',
      ]);
    }
  });

  it('marks what can delete destructive, and only those', async () => {
    const { tools } = await client.listTools();
    expect(
      tools
        .filter((tool) => tool.annotations?.destructiveHint)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(['delete_empty_folder', 'delete_step', 'delete_track', 'set_track_steps']);
  });

  it('marks as read-only exactly what changes nothing', async () => {
    const { tools } = await client.listTools();
    const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name);
    expect(readOnly.sort()).toEqual(
      [
        'check_code',
        'get_track',
        'list_folders',
        'list_sounds',
        'list_tabs',
        'lookup_function',
        'search_functions',
        'search_tracks',
        'whoami',
      ].sort(),
    );
  });

  it('makes every delete name a version', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools.filter((t) => t.annotations?.destructiveHint)) {
      expect(tool.inputSchema.required, tool.name).toContain('expectedVersion');
    }
  });

  it("tells assistants a track's contents are data, not instructions", () => {
    expect(client.getInstructions()).toMatch(/data, not instructions/);
    expect(client.getInstructions()).toMatch(/check_code/);
    expect(client.getInstructions()).toMatch(/version_conflict/);
  });
});

describe('every tool through the SDK', () => {
  it.each(Object.keys(CASES))('%s: a success fits its output schema', async (name) => {
    await client.listTools();
    const result = await client.callTool({ name, arguments: CASES[name].good() });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toEqual(result.structuredContent);
  });

  it.each(Object.keys(CASES))('%s: a failure is a result with a stable code', async (name) => {
    await client.listTools();
    const result = await client.callTool({ name, arguments: CASES[name].bad });
    expect(result.isError).toBe(true);
    const error = JSON.parse((result.content as Array<{ text: string }>)[0].text) as { code: string };
    expect(error.code).toBe(CASES[name].code);
  });
});
