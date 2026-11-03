/**
 * @spec: 018-strudel-mcp-server (slice 1)
 * Conformance: the official SDK's client, over its real Streamable HTTP transport, against the
 * hand-written handler. The SDK validates every response with its own schemas.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/jsonrpc';
import { assistantToken, CLIENT_ID, MCP_URL, post, rpcBody, USER, withToken, worker } from './helpers';

let client: Client | null = null;

async function connect(token = assistantToken()) {
  const w = worker();
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: w.fetch as typeof fetch,
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  client = new Client({ name: 'conformance-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport, ...w };
}

afterEach(async () => {
  await client?.close();
  client = null;
});

describe('the official SDK client', () => {
  it('completes the handshake on revision 2025-11-25', async () => {
    const { client, transport } = await connect();
    expect(LATEST_PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
    expect(transport.protocolVersion).toBe('2025-11-25');
    expect(client.getServerVersion()).toMatchObject({ name: 'strudel-mcp' });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {} });
  });

  it('pings', async () => {
    const { client } = await connect();
    await expect(client.ping()).resolves.toEqual({});
  });

  it('lists whoami with its annotations and schemas', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['whoami']);
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tools[0].outputSchema).toBeDefined();
  });

  it('calls whoami, and the result passes the SDK check against the output schema', async () => {
    const { client } = await connect();
    await client.listTools();
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    const expected = { user_id: USER.id, email: USER.email, client_id: CLIENT_ID };
    expect(result.structuredContent).toEqual(expected);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(expected) }]);
  });

  it('gets a protocol error for an unknown tool', async () => {
    const { client } = await connect();
    await expect(client.callTool({ name: 'nope', arguments: {} })).rejects.toThrow(/Unknown tool/);
  });
});

describe('version negotiation', () => {
  const askFor = async (protocolVersion: string) => {
    const response = await worker().fetch(
      MCP_URL,
      post(
        rpcBody('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'x', version: '1' } }),
        withToken(assistantToken()),
      ),
    );
    return ((await response.json()) as { result: { protocolVersion: string } }).result.protocolVersion;
  };

  it('answers a supported older revision with that revision', async () => {
    expect(await askFor('2025-06-18')).toBe('2025-06-18');
  });

  it('answers an unknown revision with its own', async () => {
    expect(await askFor('1999-01-01')).toBe('2025-11-25');
  });
});
