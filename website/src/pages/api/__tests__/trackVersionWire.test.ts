/**
 * @spec: 018-strudel-mcp-server (tech 2.4)
 * A real-format `updated_at` through everything real: JSON from the server, the real route, the real
 * supabase-js query builder, and the URL it sends to PostgREST. The value holds microseconds and a
 * `+`, which a query string would turn into a space if it weren't encoded, and Date would truncate.
 * The fake PostgREST at the end decodes the URL the way a server does.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiContext } from './apiTestHelpers';

const VERSION = '2026-11-03T00:09:28.401191+00:00';
const NEXT = '2026-11-03T00:09:30.123456+00:00';

let stored: Record<string, unknown>;
let requestUrls: string[];
let rawFilter: string | null;
let route: (typeof import('../tracks/update'))['PUT'];
let setEnv: (typeof import('../../../lib/server-env'))['setRuntimeEnv'];

function postgrest(input: RequestInfo | URL, init?: RequestInit): Response {
  const url = new URL(String(input));
  requestUrls.push(String(input));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.pathname.endsWith('/auth/v1/user')) return json({ id: 'u1', aud: 'authenticated', email: 'u@example.test' });
  if (!url.pathname.endsWith('/rest/v1/tracks')) return json({ message: 'unexpected' }, 404);

  rawFilter = url.searchParams.get('updated_at');
  const matches =
    url.searchParams.get('id') === `eq.${stored.id}` && (!rawFilter || rawFilter === `eq.${stored.updated_at}`);
  if (init?.method === 'PATCH') {
    if (!matches) return json([]);
    stored = { ...stored, ...JSON.parse(String(init.body)), updated_at: NEXT };
    return json([stored]);
  }
  return json(matches ? [stored] : []);
}

beforeAll(async () => {
  // isolate:false: another file's vi.mock of this module must not apply here, and this one must not leak.
  vi.resetModules();
  vi.doMock('@supabase/supabase-js', async () => {
    const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
    return {
      ...actual,
      createClient: (url: string, key: string, options: Record<string, unknown> = {}) =>
        actual.createClient(url, key, {
          ...options,
          global: { ...(options.global as object), fetch: postgrest as unknown as typeof fetch },
        }),
    };
  });
  route = (await import('../tracks/update')).PUT;
  setEnv = (await import('../../../lib/server-env')).setRuntimeEnv;
});

afterAll(() => {
  vi.doUnmock('@supabase/supabase-js');
  vi.resetModules();
});

beforeEach(() => {
  setEnv({ PUBLIC_SUPABASE_URL: 'http://test', PUBLIC_SUPABASE_ANON_KEY: 'test-anon' });
  stored = { id: 't1', name: 'mine', code: 'a', steps: [], user_id: 'u1', updated_at: VERSION };
  requestUrls = [];
  rawFilter = null;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setEnv({});
  vi.restoreAllMocks();
});

const save = (expectedVersion: string) =>
  route(
    apiContext({
      url: 'http://test/api/tracks/update',
      method: 'PUT',
      token: 'eyJ.test.token',
      body: { trackId: 't1', updates: { code: 'b' }, expectedVersion },
    }),
  );

describe('a real updated_at on the wire', () => {
  it('reaches PostgREST exact, with the + encoded, and the update lands', async () => {
    const res = await save(VERSION);
    expect(res.status).toBe(200);
    expect(rawFilter).toBe(`eq.${VERSION}`);
    const patch = requestUrls.find((url) => url.includes('/rest/v1/tracks'))!;
    expect(patch).toContain('2026-11-03T00%3A09%3A28.401191%2B00%3A00');
    expect(patch).not.toContain('401191+00');
  });

  it('the version the server returns is the one the next save names, unchanged', async () => {
    const first = await (await save(VERSION)).json();
    expect(first.track.updated_at).toBe(NEXT);
    const res = await save(first.track.updated_at);
    expect(res.status).toBe(200);
    expect(rawFilter).toBe(`eq.${NEXT}`);
  });

  it('one microsecond off is a conflict, so nothing rounds it', async () => {
    const res = await save('2026-11-03T00:09:28.401192+00:00');
    expect(res.status).toBe(409);
    expect(stored.code).toBe('a');
    expect((await res.json()).current.version).toBe(VERSION);
  });
});
