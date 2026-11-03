/**
 * @spec: 018-strudel-mcp-server (tech 2.7)
 * The relay with fake sockets: who counts as a tab, and how a command gets its answer. The real thing
 * through workerd is covered by the local browser run; plain vitest has no workerd.
 */
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_NOT_SIGNED_IN, TabRelay, TOKEN_GRACE_MS } from '../src/tabRelay';
import type { Env } from '../src/env';
import { fakeLibrary, toolCaller } from './fakeLibrary';
import { assistantToken, env, ISSUER, makeJwt, ORIGIN, USER, worker } from './helpers';

class FakeSocket {
  sent: string[] = [];
  closed: Array<[number, string]> = [];
  attachment: unknown = null;
  onSend?: (message: string) => void;
  send(message: string) {
    this.sent.push(message);
    this.onSend?.(message);
  }
  close(code: number, reason: string) {
    this.closed.push([code, reason]);
  }
  serializeAttachment(value: unknown) {
    this.attachment = value;
  }
  deserializeAttachment() {
    return this.attachment;
  }
}

/** Node's Response refuses status 101 and has no `webSocket`. */
class FakeResponse {
  status: number;
  webSocket: unknown;
  constructor(_body: unknown, init: { status: number; webSocket?: unknown }) {
    this.status = init.status;
    this.webSocket = init.webSocket;
  }
}

const inHour = () => Math.floor(Date.now() / 1000) + 3600;
const webToken = (claims: Record<string, unknown> = {}) =>
  makeJwt({ iss: ISSUER, sub: USER.id, exp: inHour(), ...claims });

const RealResponse = globalThis.Response;

function makeRelay(auth: (token: string) => Response | Promise<Response> = () => Response.json({ id: USER.id })) {
  const accepted: FakeSocket[] = [];
  const state = {
    getWebSockets: () => accepted.filter((socket) => socket.closed.length === 0),
    acceptWebSocket: (socket: FakeSocket) => accepted.push(socket),
  } as unknown as DurableObjectState;
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) =>
    auth(new Headers(init?.headers).get('authorization')!.replace('Bearer ', '')),
  );
  const relay = new TabRelay(state, env as Env, fetchImpl as unknown as typeof fetch);
  const connect = async (expiresAt = Date.now() + 3_600_000): Promise<FakeSocket> => {
    vi.stubGlobal('Response', FakeResponse);
    await relay.fetch(
      new Request('https://relay/connect', {
        headers: { upgrade: 'websocket', 'x-tab-user': USER.id, 'x-tab-expires': String(expiresAt) },
      }),
    );
    vi.stubGlobal('Response', RealResponse);
    return accepted.at(-1)!;
  };
  const tell = (socket: FakeSocket, message: unknown) =>
    relay.webSocketMessage(
      socket as unknown as WebSocket,
      typeof message === 'string' ? message : JSON.stringify(message),
    );
  const tab = async (answer: (command: string, args: unknown) => unknown = () => ({ ok: true, result: {} })) => {
    const socket = await connect();
    socket.onSend = (raw) => {
      const message = JSON.parse(raw);
      if (message.type !== 'command') return;
      void tell(socket, { type: 'ack', id: message.id, answer: answer(message.command, message.args) });
    };
    return socket;
  };
  const command = async (name: string, args: unknown = {}, headers: Record<string, string> = {}) => {
    const response = await relay.fetch(
      new Request('https://relay/command', {
        method: 'POST',
        headers: { 'x-command': name, 'x-timeout-ms': '5000', ...headers },
        body: JSON.stringify(args),
      }),
    );
    return response.json() as Promise<Record<string, unknown>>;
  };
  return { relay, accepted, fetchImpl, connect, tell, tab, command };
}

/** Only the clock: reading a request's body needs the real event loop. */
const fakeClock = (now: number) => vi.useFakeTimers({ now, toFake: ['setTimeout', 'clearTimeout', 'Date'] });

const lastMessage = (socket: FakeSocket) => JSON.parse(socket.sent.at(-1)!);

beforeEach(() => {
  // Other files stub `crypto` and share this global (vitest's isolate is off).
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'WebSocketPair',
    class {
      0 = new FakeSocket();
      1 = new FakeSocket();
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a tab', () => {
  it('is told its id as soon as it connects, and gets commands', async () => {
    const { connect, tell, command } = makeRelay();
    const socket = await connect();
    expect(lastMessage(socket)).toMatchObject({ type: 'ready', tabId: expect.any(String) });
    socket.onSend = (raw) => {
      const { id } = JSON.parse(raw);
      void tell(socket, { type: 'ack', id, answer: { ok: true, result: { done: 1 } } });
    };
    expect(await command('play')).toEqual({ ok: true, result: { done: 1 } });
  });

  it('is refused a place without what the Worker verified', async () => {
    const { relay, accepted } = makeRelay();
    const response = await relay.fetch(new Request('https://relay/connect', { headers: { upgrade: 'websocket' } }));
    expect(response.status).toBe(400);
    expect(accepted).toEqual([]);
  });

  it('has its trust extended by a refreshed token, and keeps its id', async () => {
    fakeClock(1_000_000_000);
    const { connect, tell, command } = makeRelay();
    const socket = await connect(1_000_100_000);
    const { tabId } = lastMessage(socket);
    await tell(socket, { type: 'token', token: makeJwt({ iss: ISSUER, sub: USER.id, exp: 2_000_000 }) });
    vi.setSystemTime(1_000_100_000 + TOKEN_GRACE_MS + 1);
    const reply = command('status');
    await vi.advanceTimersByTimeAsync(2_000);
    await reply;
    expect(socket.closed).toEqual([]);
    expect((socket.attachment as { tabId: string }).tabId).toBe(tabId);
  });

  it('is closed when its session has ended, so a refreshed token is refused', async () => {
    const { connect, tell, command } = makeRelay(() => new Response('no', { status: 401 }));
    const socket = await connect();
    await tell(socket, { type: 'token', token: webToken() });
    expect(socket.closed[0][0]).toBe(CLOSE_NOT_SIGNED_IN);
    expect(await command('play')).toEqual({ ok: false, code: 'no_tab' });
  });

  it("is closed by another user's token, even a valid one", async () => {
    const { connect, tell } = makeRelay(() => Response.json({ id: 'someone-else' }));
    const socket = await connect();
    await tell(socket, { type: 'token', token: webToken({ sub: 'someone-else' }) });
    expect(socket.closed[0][0]).toBe(CLOSE_NOT_SIGNED_IN);
  });

  it("is closed by an assistant's token", async () => {
    const { connect, tell, fetchImpl } = makeRelay();
    const socket = await connect();
    await tell(socket, { type: 'token', token: assistantToken({ exp: inHour() }) });
    expect(socket.closed[0][0]).toBe(CLOSE_NOT_SIGNED_IN);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('carries on when the sign-in service is down, as that says nothing about the token', async () => {
    const { connect, tell } = makeRelay(() => new Response('down', { status: 503 }));
    const socket = await connect();
    await tell(socket, { type: 'token', token: webToken() });
    expect(socket.closed).toEqual([]);
  });

  it('stops being trusted when its token has run out and was never refreshed', async () => {
    fakeClock(1_000_000_000);
    const { connect, command } = makeRelay();
    const socket = await connect(1_000_100_000);
    vi.setSystemTime(1_000_100_000 + TOKEN_GRACE_MS + 1);
    expect(await command('play')).toEqual({ ok: false, code: 'no_tab' });
    expect(socket.closed[0][0]).toBe(CLOSE_NOT_SIGNED_IN);
  });

  it('is refused past the most tabs a user can have, without closing the others', async () => {
    const { connect, relay, accepted } = makeRelay();
    for (let i = 0; i < 8; i++) await connect();
    const response = await relay.fetch(
      new Request('https://relay/connect', {
        headers: { upgrade: 'websocket', 'x-tab-user': USER.id, 'x-tab-expires': String(Date.now() + 1000) },
      }),
    );
    expect(response.status).toBe(429);
    expect(accepted.every((socket) => socket.closed.length === 0)).toBe(true);
  });

  it('closes on a message over the limit, and ignores what it can not read', async () => {
    const { connect, tell } = makeRelay();
    const socket = await connect();
    await tell(socket, 'not json');
    expect(socket.closed).toEqual([]);
    await tell(socket, 'x'.repeat(64 * 1024 + 1));
    expect(socket.closed[0][0]).toBe(1009);
  });
});

describe('commands', () => {
  it('passes arguments to the tab and the answer back', async () => {
    const seen: unknown[] = [];
    const { tab, command } = makeRelay();
    await tab((name, args) => (seen.push([name, args]), { ok: true, result: { playing: true } }));
    expect(await command('update_code', { code: 's("bd")' })).toEqual({ ok: true, result: { playing: true } });
    expect(seen).toEqual([['update_code', { code: 's("bd")' }]]);
  });

  it('passes on what the tab refuses', async () => {
    const { tab, command } = makeRelay();
    await tab(() => ({ ok: false, code: 'transition_in_progress' }));
    expect(await command('play')).toEqual({ ok: false, code: 'transition_in_progress' });
  });

  it('refuses with both listed when two tabs could mean it, and sends neither the command', async () => {
    const asked: string[] = [];
    const { tab, command } = makeRelay();
    const answer = (name: string) => (asked.push(name), { ok: true, result: { playing: false } });
    await tab(answer);
    await tab(answer);
    const reply = await command('play');
    expect(reply).toMatchObject({ ok: false, code: 'ambiguous_tab' });
    expect(reply.tabs).toHaveLength(2);
    expect(asked).toEqual(['status', 'status']);
  });

  it('reaches the named tab only', async () => {
    const asked: string[] = [];
    const { tab, command } = makeRelay();
    const one = await tab(() => (asked.push('one'), { ok: true, result: {} }));
    await tab(() => (asked.push('two'), { ok: true, result: {} }));
    const { tabId } = JSON.parse(one.sent[0]);
    await command('stop', {}, { 'x-tab-id': tabId });
    expect(asked).toEqual(['one']);
  });

  it('says no_tab for a tab id that is not there', async () => {
    const { tab, command } = makeRelay();
    await tab();
    expect(await command('stop', {}, { 'x-tab-id': 'gone' })).toEqual({ ok: false, code: 'no_tab' });
  });

  it('times out when the tab does not answer, within the time asked', async () => {
    fakeClock(Date.now());
    const { connect, tell, command } = makeRelay();
    const socket = await connect();
    const reply = command('play');
    await vi.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void reply.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await reply).toEqual({ ok: false, code: 'tab_timeout' });
  });

  it('answers at once when the tab closes while asked', async () => {
    const { connect, tell, command, relay } = makeRelay();
    const socket = await connect();
    socket.onSend = () => relay.webSocketClose(socket as unknown as WebSocket);
    expect(await command('play')).toEqual({ ok: false, code: 'no_tab' });
  });

  it('takes an answer only from the tab that was asked', async () => {
    fakeClock(Date.now());
    const { connect, tell, command } = makeRelay();
    const asked = await connect();
    const other = await connect();
    const tabId = JSON.parse(asked.sent[0]).tabId;
    const reply = command('play', {}, { 'x-tab-id': tabId });
    await vi.advanceTimersByTimeAsync(0);
    const { id } = JSON.parse(asked.sent.at(-1)!);
    await tell(other, { type: 'ack', id, answer: { ok: true, result: { forged: true } } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await reply).toEqual({ ok: false, code: 'tab_timeout' });
  });

  it('lists tabs that answer, and leaves out one that does not', async () => {
    fakeClock(Date.now());
    const { connect, tell, tab, command } = makeRelay();
    await tab(() => ({ ok: true, result: { playing: true } }));
    const silent = await connect();
    const reply = command('status');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(((await reply).tabs as unknown[]).length).toBe(1);
  });
});

describe('GET /mcp/tab', () => {
  const url = `${ORIGIN}/mcp/tab`;
  const relayed = (upstream?: (url: string, init?: RequestInit) => Response) => {
    const fetch = vi.fn(async (_request: Request) => new Response('from the relay'));
    const idFromName = vi.fn((name: string) => name);
    const get = vi.fn(() => ({ fetch }));
    const namespace = { idFromName, get } as unknown as Env['TAB_RELAY'];
    return { fetch, idFromName, get, w: worker(upstream, { TAB_RELAY: namespace }) };
  };
  const socketHeaders = (extra: Record<string, string> = {}) => ({
    upgrade: 'WebSocket',
    origin: ORIGIN,
    cookie: `other=1; sb-access-token=${encodeURIComponent(webToken())}; more=2`,
    ...extra,
  });

  it("reaches the verified user's relay, saying who and until when", async () => {
    const { fetch, idFromName, w } = relayed();
    const response = await w.fetch(url, { headers: socketHeaders() });
    expect(await response.text()).toBe('from the relay');
    expect(idFromName).toHaveBeenCalledWith(USER.id);
    const sent = fetch.mock.calls[0][0].headers;
    expect(sent.get('x-tab-user')).toBe(USER.id);
    expect(Number(sent.get('x-tab-expires'))).toBeGreaterThan(Date.now());
  });

  it('takes who it is from the token check, not from anything the request says', async () => {
    const { fetch, idFromName, w } = relayed();
    await w.fetch(`${url}?u=someone-else`, {
      headers: socketHeaders({ 'x-tab-user': 'someone-else', 'x-tab-expires': '99999999999999' }),
    });
    expect(idFromName).toHaveBeenCalledWith(USER.id);
    const sent = fetch.mock.calls[0][0].headers;
    expect(sent.get('x-tab-user')).toBe(USER.id);
    expect(sent.get('x-tab-expires')).not.toBe('99999999999999');
  });

  it('never passes the cookie on to the relay', async () => {
    const { fetch, w } = relayed();
    await w.fetch(url, { headers: socketHeaders() });
    expect(fetch.mock.calls[0][0].headers.get('cookie')).toBeNull();
  });

  const refusedWithoutWaking = async (
    headers: Record<string, string>,
    status: number,
    upstream?: (url: string, init?: RequestInit) => Response,
  ) => {
    const { get, idFromName, w } = relayed(upstream);
    const response = await w.fetch(url, { headers });
    expect(response.status).toBe(status);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    return w;
  };

  it.each([{ origin: 'https://evil.test' }, { origin: '' }])('refuses another origin: %j', async (extra) => {
    const w = await refusedWithoutWaking(socketHeaders(extra), 403);
    expect(w.upstreamCalls).toEqual([]);
  });

  it('refuses no origin at all', async () => {
    const { origin: _origin, ...headers } = socketHeaders();
    await refusedWithoutWaking(headers, 403);
  });

  it('refuses no cookie, with 401 and without asking Supabase', async () => {
    const { cookie: _cookie, ...headers } = socketHeaders();
    const w = await refusedWithoutWaking(headers, 401);
    expect(w.upstreamCalls).toEqual([]);
  });

  it('reads nothing but its own cookie', async () => {
    await refusedWithoutWaking(socketHeaders({ cookie: `sb-other=${webToken()}` }), 401);
  });

  it("refuses an assistant's token in the cookie, so it can't pose as a tab", async () => {
    const w = await refusedWithoutWaking(
      socketHeaders({ cookie: `sb-access-token=${assistantToken({ exp: inHour() })}` }),
      401,
    );
    expect(w.upstreamCalls).toEqual([]);
  });

  it('refuses a token Supabase turns down, such as an expired one', async () => {
    await refusedWithoutWaking(socketHeaders(), 401, () => new Response('no', { status: 401 }));
  });

  it('refuses a token from another issuer', async () => {
    const other = makeJwt({ iss: 'https://evil.test/auth/v1', sub: USER.id, exp: inHour() });
    await refusedWithoutWaking(socketHeaders({ cookie: `sb-access-token=${other}` }), 401);
  });

  it('says try again when the sign-in service is down', async () => {
    await refusedWithoutWaking(socketHeaders(), 503, () => new Response('down', { status: 503 }));
  });

  it('logs the outcome and never the token', async () => {
    const { w } = relayed();
    await w.fetch(url, { headers: socketHeaders() });
    expect(w.logs).toEqual([expect.objectContaining({ handler: 'tab/connect', outcome: 'ok' })]);
    expect(JSON.stringify(w.logs)).not.toContain('.signature');
  });

  it('refuses an address over its limit, before looking at the token or waking anything', async () => {
    const addresses: string[] = [];
    const { get, w } = relayed();
    const limited = worker(
      undefined,
      { TAB_RELAY: { idFromName: vi.fn(), get } as never },
      {
        isIpRateLimited: async (address) => (addresses.push(address), true),
      },
    );
    const response = await limited.fetch(url, { headers: socketHeaders({ 'cf-connecting-ip': '192.0.2.1' }) });
    expect(response.status).toBe(429);
    expect(addresses).toEqual(['192.0.2.1']);
    expect(limited.upstreamCalls).toEqual([]);
    expect(get).not.toHaveBeenCalled();
    void w;
  });

  it('answers 426 without an upgrade and 405 to a POST', async () => {
    const { get, w } = relayed();
    expect((await w.fetch(url, { headers: { origin: ORIGIN } })).status).toBe(426);
    expect((await w.fetch(url, { method: 'POST' })).status).toBe(405);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the tab tools', () => {
  /** The real relay behind the real tools, as the Worker reaches it. */
  const withRelay = async (answer?: (command: string, args: unknown) => unknown, tabs = 1) => {
    const made = makeRelay();
    for (let i = 0; i < tabs; i++) await made.tab(answer);
    const namespace = {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (url: string, init: RequestInit) => made.relay.fetch(new Request(url, init)),
      }),
    } as unknown as Env['TAB_RELAY'];
    return { ...made, tools: toolCaller(fakeLibrary(), { TAB_RELAY: namespace }) };
  };

  it('tells an assistant with no tab to ask the user', async () => {
    const { tools } = await withRelay(undefined, 0);
    const { error } = await tools.call('play');
    expect(error).toMatchObject({ code: 'no_tab', next: expect.stringContaining('Allow assistant control') });
    expect((await tools.call('list_tabs')).structured).toEqual({ tabs: [] });
  });

  it('asks for the relay of the user the token is for', async () => {
    const idFromName = vi.fn((name: string) => name);
    const namespace = {
      idFromName,
      get: () => ({ fetch: async () => Response.json({ ok: false, code: 'no_tab' }) }),
    } as unknown as Env['TAB_RELAY'];
    await toolCaller(fakeLibrary(), { TAB_RELAY: namespace }).call('stop');
    expect(idFromName).toHaveBeenCalledWith(USER.id);
  });

  it.each([
    ['play', {}, 'play'],
    ['stop', {}, 'stop'],
    ['update_code', { code: 'x', trackId: 't' }, 'update_code'],
    ['open_track', { trackId: 't' }, 'open_track'],
  ])('%s reaches the tab', async (tool, args, command) => {
    const seen: string[] = [];
    const { tools } = await withRelay((name) => (seen.push(name), { ok: true, result: { playing: true } }));
    expect((await tools.call(tool, args)).structured).toEqual({ playing: true });
    expect(seen).toEqual([command]);
  });

  it.each([
    'transition_in_progress',
    'conflict_open',
    'save_failed',
    'no_track_open',
    'not_found',
    'track_changed',
    'control_off',
    'ignored',
    'open_failed',
    'library_unavailable',
  ])('passes on %s with a next step', async (code) => {
    const { tools } = await withRelay(() => ({ ok: false, code }));
    const { error } = await tools.call('update_code', { code: 'x', trackId: 't' });
    expect(error.code).toBe(code);
    expect(error.next).toBeTruthy();
  });

  it('requires the track, so nothing lands on whatever happens to be open', async () => {
    const seen: string[] = [];
    const { tools } = await withRelay((name) => (seen.push(name), { ok: true, result: {} }));
    const { error } = await tools.call('update_code', { code: 'x' });
    expect(error).toMatchObject({ code: 'invalid_arguments', message: 'arguments.trackId is required' });
    expect(seen).toEqual([]);
  });

  it('says which track is open when the one named is not', async () => {
    const { tools } = await withRelay(() => ({ ok: false, code: 'track_changed', openTrackId: 't2' }));
    expect((await tools.call('update_code', { code: 'x', trackId: 't1' })).error).toMatchObject({
      code: 'track_changed',
      openTrackId: 't2',
    });
  });

  it('says "A transition is in progress" in those words', async () => {
    const { tools } = await withRelay(() => ({ ok: false, code: 'transition_in_progress' }));
    expect((await tools.call('play')).error.message).toBe('A transition is in progress.');
  });

  it('gives the line of a code mistake', async () => {
    const error = { message: 'Unexpected token', line: 3 };
    const { tools } = await withRelay(() => ({ ok: false, code: 'code_error', error }));
    expect((await tools.call('update_code', { code: 'x', trackId: 't' })).error).toMatchObject({
      code: 'code_error',
      error,
    });
  });

  it('lists both tabs when it can not tell which, so the assistant can choose', async () => {
    const { tools } = await withRelay(() => ({ ok: true, result: { playing: true } }), 2);
    const { error } = await tools.call('play');
    expect(error.code).toBe('ambiguous_tab');
    expect(error.tabs).toHaveLength(2);
  });

  it('refuses code over 512 KB before reaching the tab', async () => {
    const seen: string[] = [];
    const { tools } = await withRelay((name) => (seen.push(name), { ok: true, result: {} }));
    const { error } = await tools.call('update_code', { code: 'x'.repeat(512 * 1024 + 1), trackId: 't' });
    expect(error.code).toBe('too_large');
    expect(seen).toEqual([]);
  });

  it('never logs the code', async () => {
    const { tools } = await withRelay(() => ({ ok: true, result: {} }));
    await tools.call('update_code', { code: 'PRIVATE_CODE', trackId: 't' });
    expect(JSON.stringify(tools.logs)).not.toContain('PRIVATE_CODE');
  });

  it('says the relay could not be reached rather than failing the call', async () => {
    const namespace = {
      idFromName: (name: string) => name,
      get: () => ({ fetch: () => Promise.reject(new Error('down')) }),
    } as unknown as Env['TAB_RELAY'];
    const { error } = await toolCaller(fakeLibrary(), { TAB_RELAY: namespace }).call('play');
    expect(error.code).toBe('service_unavailable');
  });
});
