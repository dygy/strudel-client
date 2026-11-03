/**
 * @spec: 018-strudel-mcp-server (slice 1)
 * scripts/cpu-time.mjs joins the two events of a request. The event shape follows Cloudflare's
 * API reference for the telemetry query endpoint; no real response has been read yet.
 */
import { describe, expect, it } from 'vitest';
import { formatTable, summarize } from '../scripts/cpu-time.mjs';

const invocation = (requestId: string, cpuTimeMs: number, url = 'https://strudel.test/mcp') => ({
  $metadata: { id: `event-${requestId}`, requestId },
  $workers: { requestId, cpuTimeMs, wallTimeMs: 90, event: { request: { url } } },
  source: {},
});
const handlerLog = (requestId: string, handler: string) => ({
  $metadata: { id: `log-${requestId}`, requestId },
  source: { handler, outcome: 'ok', ms: 90 },
});

describe('summarize', () => {
  it('joins CPU time and handler by request id, in either order', () => {
    const rows = summarize([
      invocation('a', 2),
      handlerLog('a', 'tools/call:whoami'),
      handlerLog('b', 'tools/call:whoami'),
      invocation('b', 4),
      invocation('c', 1),
      handlerLog('c', 'ping'),
    ]);
    expect(rows).toEqual([
      { handler: 'tools/call:whoami', count: 2, p50: 2, p95: 4, max: 4, overLimit: 0 },
      { handler: 'ping', count: 1, p50: 1, p95: 1, max: 1, overLimit: 0 },
    ]);
  });

  it('counts the requests over the 10 ms limit, and a request exactly at it is not over', () => {
    const [row] = summarize([
      invocation('a', 10),
      handlerLog('a', 'initialize'),
      invocation('b', 11),
      handlerLog('b', 'initialize'),
    ]);
    expect(row.overLimit).toBe(1);
  });

  it('lists requests with no handler line by their path', () => {
    const rows = summarize([invocation('a', 1, 'https://strudel.test/.well-known/oauth-protected-resource/mcp')]);
    expect(rows[0].handler).toBe('/.well-known/oauth-protected-resource/mcp');
  });

  it('skips a handler line with no invocation event, and events with no request id', () => {
    expect(summarize([handlerLog('a', 'ping'), { $metadata: {}, source: { handler: 'ping' } }])).toEqual([]);
  });
});

describe('formatTable', () => {
  it('prints a header and one row per handler', () => {
    const table = formatTable(summarize([invocation('a', 3), handlerLog('a', 'ping')]));
    const lines = table.split('\n');
    expect(lines[0]).toMatch(/^handler\s+count\s+p50 ms\s+p95 ms\s+max ms\s+over 10 ms$/);
    expect(lines[1]).toMatch(/^ping\s+1\s+3\s+3\s+3\s+0$/);
  });
});
