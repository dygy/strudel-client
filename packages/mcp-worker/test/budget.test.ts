/**
 * @spec: 018-strudel-mcp-server (tech 2.1)
 * Workers Free stops a request at 10 ms of CPU. Each tool, through the whole handler, on the slowest
 * input it can get: the most rows a response can hold, the largest code it takes. Upstream answers are
 * ready-made, so what's timed is the Worker's own parsing and work. The fastest of several runs: that
 * excludes other tests sharing the machine, and a warm JIT, so scripts in README.md measure cold starts.
 */
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CHECK_MAX_BYTES } from '../src/knowledge';
import { TabRelay } from '../src/tabRelay';
import { assistantToken, MCP_URL, post, rpcBody, USER, withToken, worker } from './helpers';

const CODE = 's("bd [sd cp]*2").lpf(200).room(0.5) // '.padEnd(4096, 'x');
const LARGE_CODE = CODE.repeat(127); // 508 KB, just under the limit for a write
const ROWS = 1000; // PostgREST's default maximum in one response

const folderRow = (i: number) => ({
  id: `folder-id-${String(i).padStart(11, '0')}`,
  name: `Folder ${i}`,
  path: `Parent/Folder ${i}`,
  parent: null,
  updated_at: `2026-01-01T00:00:00.${i}+00:00`,
});
const listRow = (i: number) => ({
  id: `track-id-${String(i).padStart(12, '0')}`,
  name: `A track with quite a long name ${i}`,
  folder: folderRow(i % ROWS).id,
  is_multitrack: false,
  modified: '2026-01-01T00:00:00.000Z',
  updated_at: `2026-01-01T00:00:00.${i}+00:00`,
});
const stepsOf = (count: number, code: string) =>
  Array.from({ length: count }, (_, i) => ({
    id: `step-id-${String(i).padStart(13, '0')}`,
    name: `Step ${i}`,
    code,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
  }));
const row = (fields: Record<string, unknown>) => ({
  id: 't',
  name: 'Song',
  code: '',
  folder: null,
  is_multitrack: false,
  steps: null,
  active_step: null,
  modified: '2026-01-01T00:00:00.000Z',
  created: '2026-01-01T00:00:00.000Z',
  updated_at: 'v1',
  ...fields,
});
// 200 steps of 2.5 KB: the most steps, about 512 KB in all.
const BIG_MULTI = stepsOf(200, CODE.slice(0, 2560));
const multiRow = row({
  code: BIG_MULTI[0].code,
  is_multitrack: true,
  steps: BIG_MULTI,
  active_step: 0,
});
const largeRow = row({ code: LARGE_CODE });

/** All different, so each one reaches the parser, which is the slowest part of a check. */
const WORST_CHECK = (() => {
  let code = '';
  for (let i = 0; ; i++) {
    const next = `${code}s("bd [sd cp${i}]*2").unknownname${i}();`;
    if (next.length > CHECK_MAX_BYTES) return code;
    code = next;
  }
})();

const answers = {
  folders: JSON.stringify(Array.from({ length: ROWS }, (_, i) => folderRow(i))),
  list: JSON.stringify(Array.from({ length: 51 }, (_, i) => listRow(i))),
  names: JSON.stringify(Array.from({ length: ROWS }, (_, i) => listRow(i))),
  multi: JSON.stringify([multiRow]),
  large: JSON.stringify([largeRow]),
};

const TAB = {
  tabId: 'tab',
  track: { id: 't', name: 'Song' },
  playing: true,
  cps: 0.5,
  transition: 'idle',
  changedElsewhere: false,
};

/** What each tool's slowest case reads, and how the route answers it. */
const FIXTURES: Array<{
  name: string;
  args: Record<string, unknown>;
  tracks?: string;
  folders?: string;
  site?: Record<string, unknown>;
  relay?: Record<string, unknown>;
}> = [
  { name: 'whoami', args: {} },
  { name: 'list_folders', args: {}, folders: JSON.stringify(Array.from({ length: 51 }, (_, i) => folderRow(i))) },
  { name: 'search_tracks', args: { query: 'a "quoted" query' }, tracks: answers.list, folders: answers.folders },
  { name: 'get_track', args: { trackId: 't' }, tracks: answers.large, folders: answers.folders },
  {
    name: 'create_track',
    args: { name: 'New track', code: LARGE_CODE, folder: folderRow(1).id },
    tracks: answers.names,
    folders: answers.folders,
    site: { track: { id: 'n', name: 'New track', folder: folderRow(1).id, version: 'v2' } },
  },
  {
    name: 'update_track',
    args: { trackId: 't', expectedVersion: 'v1', code: CODE, step: 3 },
    tracks: answers.multi,
    folders: answers.folders,
    site: { track: { ...multiRow, code: undefined, steps: undefined, updated_at: 'v2' } },
  },
  {
    name: 'move_track',
    args: { trackId: 't', expectedVersion: 'v1', folder: folderRow(1).id },
    folders: answers.folders,
    site: { track: { id: 't', name: 'Song', folder: folderRow(1).id, updated_at: 'v2' } },
  },
  {
    name: 'set_track_steps',
    args: { trackId: 't', expectedVersion: 'v1', steps: BIG_MULTI.map(({ id, name, code }) => ({ id, name, code })) },
    tracks: answers.multi,
    folders: answers.folders,
    site: { track: { id: 't', name: 'Song', folder: null, updated_at: 'v2' } },
  },
  {
    name: 'create_folder',
    args: { name: 'New' },
    site: { data: { id: 'n', name: 'New', path: 'New', updated_at: 'v' } },
  },
  {
    name: 'rename_folder',
    args: { folderId: 'f', expectedVersion: 'v', name: 'Other' },
    site: { folder: { id: 'f', name: 'Other', path: 'Other', updated_at: 'v2' } },
  },
  {
    name: 'move_folder',
    args: { folderId: 'f', expectedVersion: 'v', parent: null },
    site: { folder: { id: 'f', name: 'Other', path: 'Other', updated_at: 'v2' } },
  },
  { name: 'delete_track', args: { trackId: 't', expectedVersion: 'v1' }, site: { success: true } },
  {
    name: 'delete_step',
    args: { trackId: 't', expectedVersion: 'v1', stepIndex: 1 },
    tracks: answers.multi,
    folders: answers.folders,
    site: { track: { id: 't', name: 'Song', folder: null, updated_at: 'v2' } },
  },
  { name: 'delete_empty_folder', args: { folderId: 'f', expectedVersion: 'v' }, site: { success: true } },
  { name: 'lookup_function', args: { name: 'lpf' } },
  { name: 'search_functions', args: { query: 'a' } },
  { name: 'list_sounds', args: {} },
  { name: 'check_code', args: { code: WORST_CHECK } },
  { name: 'list_tabs', args: {}, relay: { ok: true, tabs: Array.from({ length: 8 }, () => TAB) } },
  { name: 'play', args: {}, relay: { ok: true, result: TAB } },
  { name: 'stop', args: {}, relay: { ok: true, result: TAB } },
  { name: 'update_code', args: { code: LARGE_CODE }, relay: { ok: true, result: TAB } },
  { name: 'open_track', args: { trackId: 't' }, relay: { ok: true, result: TAB } },
];

const RUNS = 7;
const CPU_LIMIT_MS = 10;
const token = assistantToken();

async function fastestRun({ name, args, tracks, folders, site, relay }: (typeof FIXTURES)[number]) {
  const w = worker(
    (url) => {
      if (url.includes('/auth/v1/user')) return new Response(JSON.stringify(USER));
      return new Response(url.includes('/rest/v1/folders') ? (folders ?? '[]') : (tracks ?? '[]'));
    },
    {
      TAB_RELAY: {
        idFromName: (user: string) => user,
        get: () => ({ fetch: async () => new Response(JSON.stringify(relay ?? {})) }),
      } as never,
    },
    { site: async () => new Response(JSON.stringify(site ?? {}), { status: 200 }) },
  );
  const init = post(rpcBody('tools/call', { name, arguments: args }), withToken(token));
  let best = Infinity;
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    const response = await w.fetch(MCP_URL, init);
    await response.text();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto);
});

/** The relay's own part of `update_code`, with a tab that answers at once, on the largest code. */
async function fastestRelayRun() {
  const socket = {
    attachment: { userId: USER.id, tabId: 'tab', connectedAt: 0, expiresAt: Date.now() + 3_600_000 },
    deserializeAttachment() {
      return this.attachment;
    },
    send(raw: string) {
      // The frame goes out as text, so the tab's answer is the only thing parsed here.
      const id = raw.slice(raw.indexOf('"id":"') + 6, raw.indexOf('","command"'));
      void relay.webSocketMessage(
        socket as never,
        JSON.stringify({ type: 'ack', id, answer: { ok: true, result: TAB } }),
      );
    },
  };
  const state = { getWebSockets: () => [socket] } as never;
  const relay = new TabRelay(state, {} as never, (async () => new Response()) as never);
  const body = JSON.stringify({ code: LARGE_CODE });
  let best = Infinity;
  for (let i = 0; i < RUNS; i++) {
    const request = new Request('https://relay/command', {
      method: 'POST',
      headers: { 'x-command': 'update_code', 'x-timeout-ms': '5000' },
      body,
    });
    const started = performance.now();
    await (await relay.fetch(request)).text();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

describe('the CPU budget', () => {
  it('the relay passing the largest code to a tab stays inside 10 ms', async () => {
    const ms = await fastestRelayRun();
    if (process.env.MCP_BUDGET_PRINT) process.stdout.write(`BUDGET relay ${ms.toFixed(2)} ms\n`);
    expect(ms).toBeLessThan(CPU_LIMIT_MS);
  });

  it.each(FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    '%s stays inside 10 ms',
    async (name, fixture) => {
      vi.stubGlobal('crypto', webcrypto);
      const ms = await fastestRun(fixture);
      if (process.env.MCP_BUDGET_PRINT) process.stdout.write(`BUDGET ${name} ${ms.toFixed(2)} ms\n`);
      expect(ms).toBeLessThan(CPU_LIMIT_MS);
    },
  );
});
