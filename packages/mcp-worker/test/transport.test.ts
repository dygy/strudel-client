/**
 * @spec: 018-strudel-mcp-server (tech 2.2)
 * The HTTP side of stateless Streamable HTTP: POST /mcp only, JSON replies, 202 for notifications.
 */
import { describe, expect, it, vi } from 'vitest';
import { assistantToken, MCP_URL, ORIGIN, post, rpcBody, withToken, worker } from './helpers';

const auth = () => withToken(assistantToken());
const bodyOf = async (response: Response) => (await response.json()) as { error?: { code: number }; result?: unknown };

describe('methods', () => {
  it.each(['GET', 'DELETE', 'PUT', 'PATCH'])('%s /mcp gives 405 with Allow: POST', async (method) => {
    const w = worker();
    const response = await w.fetch(MCP_URL, { method });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(w.upstreamCalls).toEqual([]);
  });

  it('GET /mcp with a token still gives 405: there is no event stream', async () => {
    const response = await worker().fetch(MCP_URL, { headers: auth() });
    expect(response.status).toBe(405);
  });

  it.each(['/mcpx', '/mcp/other', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/x'])(
    '%s, caught by the wildcard routes, gives 404',
    async (path) => {
      expect((await worker().fetch(`${ORIGIN}${path}`)).status).toBe(404);
    },
  );
});

describe('messages', () => {
  it('answers ping with the same id and an empty result', async () => {
    const response = await worker().fetch(MCP_URL, post(rpcBody('ping', undefined, 'abc'), auth()));
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'abc', result: {} });
  });

  it('answers a notification with 202 and no body', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const response = await worker().fetch(MCP_URL, post(body, auth()));
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it("answers a client's response to a server request with 202", async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} });
    expect((await worker().fetch(MCP_URL, post(body, auth()))).status).toBe(202);
  });

  it('gives method not found for an unknown method, and does not log its name', async () => {
    const w = worker();
    const response = await w.fetch(MCP_URL, post(rpcBody('secret/thing'), auth()));
    expect(response.status).toBe(200);
    expect((await bodyOf(response)).error?.code).toBe(-32601);
    expect(JSON.stringify(w.logs)).not.toContain('secret');
  });

  it('gives a parse error with 400 for bad JSON', async () => {
    const response = await worker().fetch(MCP_URL, post('{nope', auth()));
    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error?.code).toBe(-32700);
  });

  it.each([
    ['a batch', '[{"jsonrpc":"2.0","id":1,"method":"ping"}]'],
    ['a wrong version', '{"jsonrpc":"1.0","id":1,"method":"ping"}'],
    ['a null id', '{"jsonrpc":"2.0","id":null,"method":"ping"}'],
    ['a number as the message', '1'],
    ['no method', '{"jsonrpc":"2.0","id":1}'],
  ])('refuses %s as an invalid request', async (_name, body) => {
    const response = await worker().fetch(MCP_URL, post(body, auth()));
    expect((await bodyOf(response)).error?.code).toBe(-32600);
  });

  it('refuses params that are not an object', async () => {
    const response = await worker().fetch(MCP_URL, post(rpcBody('ping', [1]), auth()));
    expect((await bodyOf(response)).error?.code).toBe(-32602);
  });

  it('reports arguments whoami does not take as a tool error', async () => {
    const body = rpcBody('tools/call', { name: 'whoami', arguments: { x: 1 } });
    const response = await worker().fetch(MCP_URL, post(body, auth()));
    expect((await bodyOf(response)).result).toMatchObject({ isError: true });
  });
});

describe('headers', () => {
  it('refuses an unsupported MCP-Protocol-Version', async () => {
    const headers = { ...auth(), 'mcp-protocol-version': '1999-01-01' };
    expect((await worker().fetch(MCP_URL, post(rpcBody('ping'), headers))).status).toBe(400);
  });

  it('accepts the current revision', async () => {
    const headers = { ...auth(), 'mcp-protocol-version': '2025-11-25' };
    expect((await worker().fetch(MCP_URL, post(rpcBody('ping'), headers))).status).toBe(200);
  });

  it('refuses a body that is not JSON', async () => {
    const init = { method: 'POST', headers: { ...auth(), 'content-type': 'text/plain' }, body: rpcBody('ping') };
    expect((await worker().fetch(MCP_URL, init)).status).toBe(415);
  });

  it('accepts a charset on the content type', async () => {
    const headers = { ...auth(), 'content-type': 'application/json; charset=utf-8' };
    expect((await worker().fetch(MCP_URL, post(rpcBody('ping'), headers))).status).toBe(200);
  });

  it('refuses an oversized body', async () => {
    const big = rpcBody('ping', { padding: 'x'.repeat(2 * 1024 * 1024) });
    expect((await worker().fetch(MCP_URL, post(big, auth()))).status).toBe(413);
  });

  it("refuses another site's page (MCP requires this against DNS rebinding), even with a token", async () => {
    const w = worker();
    const headers = { ...auth(), origin: 'https://evil.test' };
    expect((await w.fetch(MCP_URL, post(rpcBody('ping'), headers))).status).toBe(403);
    expect(w.upstreamCalls).toEqual([]);
  });

  it('accepts its own origin, and clients that send none', async () => {
    const own = { ...auth(), origin: ORIGIN };
    expect((await worker().fetch(MCP_URL, post(rpcBody('ping'), own))).status).toBe(200);
    expect((await worker().fetch(MCP_URL, post(rpcBody('ping'), auth()))).status).toBe(200);
  });
});

describe('the limit by address, before any token is looked at', () => {
  const forged = post(rpcBody('ping'), withToken(assistantToken(), { 'cf-connecting-ip': '192.0.2.1' }));

  it('refuses over the limit without reaching Supabase, so a forged token costs nothing', async () => {
    const asked: string[] = [];
    const w = worker(undefined, {}, { isIpRateLimited: async (address) => (asked.push(address), true) });
    const response = await w.fetch(MCP_URL, forged);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(asked).toEqual(['192.0.2.1']);
    expect(w.upstreamCalls).toEqual([]);
  });

  it('stays open when the limiter fails, or there is no address', async () => {
    const failing = worker(undefined, {}, { isIpRateLimited: () => Promise.reject(new Error('down')) });
    expect((await failing.fetch(MCP_URL, forged)).status).toBe(200);
    const asked = vi.fn(async () => true);
    const none = worker(undefined, {}, { isIpRateLimited: asked });
    expect((await none.fetch(MCP_URL, post(rpcBody('ping'), withToken(assistantToken())))).status).toBe(200);
    expect(asked).not.toHaveBeenCalled();
  });
});
