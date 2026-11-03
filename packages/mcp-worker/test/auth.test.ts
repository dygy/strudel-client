/**
 * @spec: 018-strudel-mcp-server (2.1, tech 2.3)
 * Nothing without a token issued to an assistant. A signed-in web session isn't one, and an
 * outage at Supabase must not look like a bad token.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import {
  ANON_KEY,
  assistantToken,
  CLIENT_ID,
  ISSUER,
  makeJwt,
  MCP_URL,
  ORIGIN,
  post,
  rpcBody,
  SUPABASE_URL,
  USER,
  webSessionToken,
  withToken,
  worker,
} from './helpers';

const whoamiCall = rpcBody('tools/call', { name: 'whoami', arguments: {} });
const METADATA_URL = `${ORIGIN}/.well-known/oauth-protected-resource/mcp`;

const expectInvalidTokenChallenge = (response: Response) => {
  expect(response.status).toBe(401);
  const header = response.headers.get('www-authenticate')!;
  expect(header).toMatch(/^Bearer /);
  expect(header).toContain('error="invalid_token"');
  expect(header).toContain(`resource_metadata="${METADATA_URL}"`);
};

describe('no token', () => {
  it('answers 401 with a challenge pointing to the resource metadata, and no data', async () => {
    const w = worker();
    const response = await w.fetch(MCP_URL, post(whoamiCall));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${METADATA_URL}"`);
    expect(JSON.stringify(await response.json())).not.toContain(USER.id);
    expect(w.upstreamCalls).toEqual([]);
  });

  it('a session cookie is not a token', async () => {
    const response = await worker().fetch(MCP_URL, post(whoamiCall, { cookie: `sb-access-token=${assistantToken()}` }));
    expect(response.status).toBe(401);
  });

  it('the SDK client finds the metadata and the issuer from the challenge', async () => {
    const w = worker();
    const challenged = await w.fetch(MCP_URL, post(whoamiCall));
    const { resourceMetadataUrl } = extractWWWAuthenticateParams(challenged);
    expect(String(resourceMetadataUrl)).toBe(METADATA_URL);

    const metadata = await discoverOAuthProtectedResourceMetadata(
      MCP_URL,
      { resourceMetadataUrl },
      w.fetch as typeof fetch,
    );
    expect(metadata.resource).toBe(MCP_URL);
    expect(metadata.authorization_servers).toEqual([ISSUER]);
  });

  it('the SDK client is refused at connect', async () => {
    const w = worker();
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: w.fetch as typeof fetch });
    const client = new Client({ name: 'conformance-test', version: '1.0.0' });
    await expect(client.connect(transport)).rejects.toThrow(/Sign in to use this server/);
  });
});

describe('the resource metadata document', () => {
  it('is public, and readable from any origin', async () => {
    const response = await worker().fetch(METADATA_URL);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({
      resource: MCP_URL,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
    });
  });

  it('answers a CORS preflight, and only reads', async () => {
    const w = worker();
    expect((await w.fetch(METADATA_URL, { method: 'OPTIONS' })).status).toBe(204);
    expect((await w.fetch(METADATA_URL, { method: 'POST' })).status).toBe(405);
  });
});

describe('a web session', () => {
  it('is refused with a challenge, without asking Supabase', async () => {
    const w = worker();
    const response = await w.fetch(MCP_URL, post(whoamiCall, withToken(webSessionToken())));
    expectInvalidTokenChallenge(response);
    expect(JSON.stringify(await response.json())).not.toContain(USER.id);
    expect(w.upstreamCalls).toEqual([]);
  });

  it.each([null, '', 42])('a client_id of %j is no client_id', async (clientId) => {
    const response = await worker().fetch(
      MCP_URL,
      post(whoamiCall, withToken(assistantToken({ client_id: clientId }))),
    );
    expectInvalidTokenChallenge(response);
  });
});

describe('a token Supabase does not accept', () => {
  it.each([401, 403])('a %i from /auth/v1/user (revoked or expired) gives a challenge', async (status) => {
    const w = worker(() => new Response('{}', { status }));
    expectInvalidTokenChallenge(await w.fetch(MCP_URL, post(whoamiCall, withToken(assistantToken()))));
  });

  it('a token from another issuer is refused before the network', async () => {
    const w = worker();
    const token = makeJwt({ iss: 'https://other.test/auth/v1', client_id: CLIENT_ID });
    expectInvalidTokenChallenge(await w.fetch(MCP_URL, post(whoamiCall, withToken(token))));
    expect(w.upstreamCalls).toEqual([]);
  });

  it.each(['abc', 'a.b.c', 'a.bm90IGpzb24.c', `a.${Buffer.from('[1]').toString('base64url')}.c`, 'x'.repeat(9000)])(
    'a malformed token is refused before the network',
    async (token) => {
      const w = worker();
      expectInvalidTokenChallenge(await w.fetch(MCP_URL, post(whoamiCall, withToken(token))));
      expect(w.upstreamCalls).toEqual([]);
    },
  );
});

describe('Supabase is out', () => {
  it.each([500, 503, 429])('a %i gives a retryable 503, not a sign-in challenge', async (status) => {
    const w = worker(() => new Response('{}', { status }));
    const response = await w.fetch(MCP_URL, post(whoamiCall, withToken(assistantToken())));
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(response.headers.get('www-authenticate')).toBeNull();
  });

  it('a network failure gives the same', async () => {
    const w = worker(() => Promise.reject(new TypeError('network')));
    expect((await w.fetch(MCP_URL, post(whoamiCall, withToken(assistantToken())))).status).toBe(503);
  });

  it('a body that is not a user gives the same', async () => {
    const w = worker(() => new Response('<html>', { status: 200 }));
    expect((await w.fetch(MCP_URL, post(whoamiCall, withToken(assistantToken())))).status).toBe(503);
  });
});

describe('a valid token', () => {
  it('gets whoami, with the identity Supabase answered', async () => {
    const w = worker();
    const token = assistantToken();
    const response = await w.fetch(MCP_URL, post(whoamiCall, withToken(token)));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: number; result: { structuredContent: unknown } };
    expect(body.id).toBe(1);
    expect(body.result.structuredContent).toEqual({ user_id: USER.id, email: USER.email, client_id: CLIENT_ID });
  });

  it('is checked against /auth/v1/user with the anon key', async () => {
    const w = worker();
    const token = assistantToken();
    await w.fetch(MCP_URL, post(whoamiCall, withToken(token)));
    expect(w.upstreamCalls).toHaveLength(1);
    expect(w.upstreamCalls[0].url).toBe(`${SUPABASE_URL}/auth/v1/user`);
    expect(w.upstreamCalls[0].headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(w.upstreamCalls[0].headers.get('apikey')).toBe(ANON_KEY);
  });

  it('is checked on every request, so a revocation applies to the next one', async () => {
    let accepted = true;
    const w = worker(() => (accepted ? new Response(JSON.stringify(USER)) : new Response('{}', { status: 403 })));
    const request = () => w.fetch(MCP_URL, post(whoamiCall, withToken(assistantToken())));
    expect((await request()).status).toBe(200);
    accepted = false;
    expectInvalidTokenChallenge(await request());
  });

  it('two users of one client each get their own identity', async () => {
    const other = { id: 'user-2', email: 'other@example.test' };
    const w = worker((_url, init) => {
      const auth = new Headers(init?.headers).get('authorization')!;
      return new Response(JSON.stringify(auth.includes(assistantToken()) ? USER : other));
    });
    const call = async (token: string) => {
      const response = await w.fetch(MCP_URL, post(whoamiCall, withToken(token)));
      return ((await response.json()) as { result: { structuredContent: { user_id: string } } }).result
        .structuredContent.user_id;
    };
    expect(await call(assistantToken())).toBe(USER.id);
    expect(await call(assistantToken({ sub: other.id }))).toBe(other.id);
  });

  it('logs the handler and the outcome, never the token or the email', async () => {
    const w = worker();
    const token = assistantToken();
    await w.fetch(MCP_URL, post(whoamiCall, withToken(token)));
    expect(w.logs).toEqual([{ handler: 'tools/call:whoami', outcome: 'ok', ms: expect.any(Number) }]);
    expect(JSON.stringify(w.logs)).not.toContain(token);
    expect(JSON.stringify(w.logs)).not.toContain(USER.email);
  });
});
