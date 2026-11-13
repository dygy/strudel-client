/**
 * @spec: 022-set-playlist (2.2 saving; tech §2.2)
 * The client wrapper: Bearer header, error codes surfaced, writes to one set serialized with the
 * version read at send time, a 401 retried once.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSetsApi, SetsApiError } from '../setsApi';

type Call = { url: string; init: RequestInit };

function fakeFetch(
  responder: (
    call: Call,
    index: number,
  ) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>,
) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    const { status, body } = await responder(call, calls.length - 1);
    return new Response(JSON.stringify(body), { status });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const set = (version: string) => ({ id: 's1', name: 'A', items: [], version });

describe('setsApi', () => {
  it('sends the access token as a Bearer header', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: { sets: [] } }));
    const api = createSetsApi({ fetch: fn, getAccessToken: async () => 'tok', baseUrl: 'http://x' });
    await api.list();
    expect(calls[0].url).toBe('http://x/api/sets/list');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('refuses to call the API when signed out', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: {} }));
    const api = createSetsApi({ fetch: fn, getAccessToken: async () => null, baseUrl: 'http://x' });
    await expect(api.list()).rejects.toMatchObject({ status: 401 });
    expect(calls).toEqual([]);
  });

  it('surfaces name_taken and version_conflict with the current set', async () => {
    const { fn } = fakeFetch((_call, i) =>
      i === 0
        ? { status: 409, body: { error: 'name_taken' } }
        : { status: 409, body: { error: 'version_conflict', current: set('v9') } },
    );
    const api = createSetsApi({ fetch: fn, getAccessToken: async () => 'tok', baseUrl: 'http://x' });
    await expect(api.create('A')).rejects.toMatchObject({ code: 'name_taken', status: 409 });
    const error = await api.update('s1', { name: 'B' }, 'v1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SetsApiError);
    expect(error).toMatchObject({ code: 'version_conflict', current: set('v9') });
  });

  it('serializes writes to one set and reads the version when each write is sent', async () => {
    let release: (() => void) | null = null;
    const { fn, calls } = fakeFetch(async (call, i) => {
      if (i === 0) await new Promise<void>((resolve) => (release = resolve));
      const body = JSON.parse(call.init.body as string);
      return { status: 200, body: { set: set(`after-${body.expectedVersion}`) } };
    });
    const api = createSetsApi({ fetch: fn, getAccessToken: async () => 'tok', baseUrl: 'http://x' });
    let version = 'v1';
    const first = api.update('s1', { name: 'B' }, () => version).then((s) => (version = s.version));
    const second = api.update('s1', { name: 'C' }, () => version);
    await vi.waitFor(() => expect(calls.length).toBe(1));
    // The second write waits for the first.
    await new Promise((r) => setTimeout(r, 5));
    expect(calls.length).toBe(1);
    release!();
    await first;
    await second;
    expect(calls.map((c) => JSON.parse(c.init.body as string).expectedVersion)).toEqual(['v1', 'after-v1']);
  });

  it('a failed write does not block the next one', async () => {
    const { fn } = fakeFetch((_c, i) =>
      i === 0 ? { status: 500, body: { error: 'boom' } } : { status: 200, body: { set: set('v2') } },
    );
    const api = createSetsApi({ fetch: fn, getAccessToken: async () => 'tok', baseUrl: 'http://x' });
    const a = api.update('s1', { name: 'B' }, 'v1').catch(() => 'failed');
    const b = api.update('s1', { name: 'C' }, 'v1');
    expect(await a).toBe('failed');
    expect((await b).version).toBe('v2');
  });

  it('retries once after a 401', async () => {
    const { fn, calls } = fakeFetch((_c, i) =>
      i === 0 ? { status: 401, body: {} } : { status: 200, body: { sets: [] } },
    );
    const api = createSetsApi({ fetch: fn, getAccessToken: async () => 'tok', baseUrl: 'http://x' });
    await expect(api.list()).resolves.toEqual([]);
    expect(calls).toHaveLength(2);
  });
});

// Review 022 #4: the pagehide flush awaited a session check, then fetched without keepalive, so the
// page could be gone before the request left.
describe('sendOnUnload', () => {
  it('calls fetch synchronously, in the same call, with keepalive and the cached token', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: { sets: [] } }));
    const getAccessToken = vi.fn(async () => 'tok');
    const api = createSetsApi({ fetch: fn, getAccessToken, baseUrl: 'http://x' });
    await api.list(); // a normal request caches the token
    calls.length = 0;
    getAccessToken.mockClear();

    const items = [{ id: 'i1', trackId: 't1', transition: null }];
    expect(api.sendOnUnload('s1', { items }, 'v3')).toBe('sent');
    // Already sent, before any await: nothing asynchronous was needed.
    expect(calls).toHaveLength(1);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(calls[0].url).toBe('http://x/api/sets/update');
    expect(calls[0].init).toMatchObject({ method: 'PUT', keepalive: true, credentials: 'include' });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ id: 's1', items, expectedVersion: 'v3' });
  });

  it('without a cached token still sends at once, on the session cookie', () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: {} }));
    const api = createSetsApi({ fetch: fn, getAccessToken: async () => 'tok', baseUrl: 'http://x' });
    expect(api.sendOnUnload('s1', { items: [] }, 'v1')).toBe('sent');
    expect(calls).toHaveLength(1);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("negative: a body over the keepalive limit isn't sent ('too-large')", () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: {} }));
    const api = createSetsApi({ fetch: fn, getAccessToken: async () => 'tok', baseUrl: 'http://x' });
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: `item-${i}`.padEnd(64, 'x'),
      trackId: `track-${i}`.padEnd(64, 'y'),
      transition: null,
    }));
    expect(api.sendOnUnload('s1', { items }, 'v1')).toBe('too-large');
    expect(calls).toHaveLength(0);
  });
});
