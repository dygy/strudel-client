import { handleRequest } from '../src/handler';
import type { Deps, Env, LogEntry } from '../src/env';

export const ORIGIN = 'https://strudel.test';
export const MCP_URL = `${ORIGIN}/mcp`;
export const SUPABASE_URL = 'https://project.supabase.test';
export const ISSUER = `${SUPABASE_URL}/auth/v1`;
export const ANON_KEY = 'anon-key';

export const USER = { id: 'user-1', email: 'user@example.test' };
export const CLIENT_ID = 'client-1';

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function makeJwt(claims: Record<string, unknown>): string {
  return `${base64url({ alg: 'ES256' })}.${base64url(claims)}.signature`;
}

export const assistantToken = (extra: Record<string, unknown> = {}) =>
  makeJwt({ iss: ISSUER, sub: USER.id, client_id: CLIENT_ID, ...extra });

/** A normal web session: valid, but with no `client_id`. */
export const webSessionToken = () => makeJwt({ iss: ISSUER, sub: USER.id });

export type Upstream = (input: string, init?: RequestInit) => Promise<Response> | Response;

export const acceptingUpstream: Upstream = () => new Response(JSON.stringify(USER), { status: 200 });

export const env = {
  PUBLIC_SUPABASE_URL: SUPABASE_URL,
  PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  TAB_RELAY: undefined,
} as unknown as Env;

/** The Worker's handler with a fake Supabase, plus what it logged and asked upstream. */
export function worker(
  upstream: Upstream = acceptingUpstream,
  overrides: Partial<Env> = {},
  extra: Partial<Deps> = {},
) {
  const logs: LogEntry[] = [];
  const upstreamCalls: Array<{ url: string; headers: Headers }> = [];
  const deps: Deps = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      upstreamCalls.push({ url: String(input), headers: new Headers(init?.headers) });
      return upstream(String(input), init);
    }) as typeof fetch,
    site: async () => new Response('no site in this test', { status: 500 }),
    log: (entry) => logs.push(entry),
    ...extra,
  };
  const fetchWorker = (input: RequestInfo | URL, init?: RequestInit) =>
    handleRequest(new Request(input, init), { ...env, ...overrides }, deps);
  return { fetch: fetchWorker, logs, upstreamCalls };
}

export const rpcBody = (method: string, params?: unknown, id: number | string = 1) =>
  JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

export const post = (body: string, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body,
});

export const withToken = (token: string, headers: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  ...headers,
});
