/**
 * @spec: 018-strudel-mcp-server (tech 2.7)
 * The relay with fake sockets: who counts as a tab, and how a command gets its answer. The real thing
 * through workerd is covered by the local browser run; plain vitest has no workerd.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_DEADLINE_MS, CLOSE_NOT_SIGNED_IN, CLOSE_TRY_AGAIN, TabRelay, TOKEN_GRACE_MS } from '../src/tabRelay';
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
  const alarms: number[] = [];
  const state = {
    getWebSockets: () => accepted.filter((socket) => socket.closed.length === 0),
    acceptWebSocket: (socket: FakeSocket) => accepted.push(socket),
    storage: { setAlarm: async (at: number) => void alarms.push(at) },
  } as unknown as DurableObjectState;
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) =>
    auth(new Headers(init?.headers).get('authorization')!.replace('Bearer ', '')),
  );
  const relay = new TabRelay(state, env as Env, fetchImpl as unknown as typeof fetch);
  const connect = async (): Promise<FakeSocket> => {
    vi.stubGlobal('Response', FakeResponse);
    await relay.fetch(
      new Request('https://relay/connect', { headers: { upgrade: 'websocket', 'x-tab-user': USER.id } }),
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
    await tell(socket, { type: 'auth', token: webToken() });
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
  return { relay, accepted, alarms, fetchImpl, connect, tell, tab, command };
}

/** Only the clock: reading a request's body needs the real event loop. */
const fakeClock = (now: number) => vi.useFakeTimers({ now, toFake: ['setTimeout', 'clearTimeout', 'Date'] });

const lastMessage = (socket: FakeSocket) => JSON.parse(socket.sent.at(-1)!);

beforeEach(() => {
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

describe('who counts as a tab', () => {
  it('nobody, until the first message has proved it', async () => {
    const { connect, command } = makeRelay();
    const socket = await connect();
    expect(await command('play')).toEqual({ ok: false, code: 'no_tab' });
    expect(socket.sent).toEqual([]);
  });

  it('a web session of this user, which gets a tab id and commands', async () => {
    const { connect, tell, command } = makeRelay();
    const socket = await connect();
    await tell(socket, { type: 'auth', token: webToken() });
    expect(lastMessage(socket)).toMatchObject({ type: 'ready', tabId: expect.any(String) });
    socket.onSend = (raw) => {
      const { id } = JSON.parse(raw);
      void tell(socket, { type: 'ack', id, answer: { ok: true, result: { done: 1 } } });
    };
    expect(await command('play')).toEqual({ ok: true, result: { done: 1 } });
  });

  it("not another user's session, even a valid one", async () => {
    const { connect, tell, command } = makeRelay(() => Response.json({ id: 'someone-else' }));
    const socket = await connect();
    await tell(socket, { type: 'auth', token: webToken({ sub: 'someone-else' }) });
    expect(socket.closed).toEqual([[CLOSE_NOT_SIGNED_IN, 'Not signed in']]);
    expect(await command('play')).toEqual({ ok: false, code: 'no_tab' });
  });

  it("not an assistant's token, which must not be able to pose as a tab", async () => {
    const { connect, tell, fetchImpl } = makeRelay();
    const socket = await connect();
    await tell(socket, { type: 'auth', token: assistantToken({ exp: inHour() }) });
    expect(socket.closed[0][0]).toBe(CLOSE_NOT_SIGNED_IN);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('not a token Supabase refuses, or anything sent before signing in', async () => {
    const { connect, tell } = makeRelay(() => new Response('no', { status: 401 }));
    const refused = await connect();
    await tell(refused, { type: 'auth', token: webToken() });
    expect(refused.closed[0][0]).toBe(CLOSE_NOT_SIGNED_IN);
    const early = await connect();
    await tell(early, { type: 'ack', id: 'x', answer: { ok: true } });
    expect(early.closed[0][0]).toBe(CLOSE_NOT_SIGNED_IN);
  });

  it('asks a socket to try again when the sign-in service is down, as that says nothing about the token', async () => {
    const { connect, tell } = makeRelay(() => new Response('down', { status: 503 }));
    const socket = await connect();
    await tell(socket, { type: 'auth', token: webToken() });
    expect(socket.closed[0][0]).toBe(CLOSE_TRY_AGAIN);
  });

  it('closes a socket that stays silent past the deadline, and leaves a tab alone', async () => {
    fakeClock(1_000_000);
    const { connect, tell, relay, alarms } = makeRelay();
    const silent = await connect();
    const tab = await connect();
    await tell(tab, { type: 'auth', token: makeJwt({ iss: ISSUER, sub: USER.id, exp: 2_000_000 }) });
    expect(alarms.at(-1)).toBe(1_000_000 + AUTH_DEADLINE_MS);
    vi.setSystemTime(1_000_000 + AUTH_DEADLINE_MS);
    relay.alarm();
    expect(silent.closed[0][0]).toBe(CLOSE_NOT_SIGNED_IN);
    expect(tab.closed).toEqual([]);
  });

  it('takes a refreshed token and keeps the same tab id', async () => {
    const { tab, tell } = makeRelay();
    const socket = await tab();
    const { tabId } = lastMessage(socket);
    socket.onSend = undefined;
    await tell(socket, { type: 'auth', token: webToken() });
    expect(lastMessage(socket).tabId).toBe(tabId);
  });

  it('drops a tab whose token ran out and was never refreshed', async () => {
    fakeClock(1_000_000_000);
    const { connect, tell, command } = makeRelay();
    const socket = await connect();
    await tell(socket, { type: 'auth', token: makeJwt({ iss: ISSUER, sub: USER.id, exp: 1_000_100 }) });
    vi.setSystemTime(1_000_100_000 + TOKEN_GRACE_MS + 1);
    expect(await command('play')).toEqual({ ok: false, code: 'no_tab' });
    expect(socket.closed[0][0]).toBe(CLOSE_NOT_SIGNED_IN);
  });

  it('makes a silent socket give way rather than letting strangers keep the tabs out', async () => {
    const { connect } = makeRelay();
    const first = await connect();
    for (let i = 0; i < 7; i++) await connect();
    await connect();
    expect(first.closed[0][0]).toBe(CLOSE_NOT_SIGNED_IN);
  });

  it('closes on a message over the limit', async () => {
    const { connect, tell } = makeRelay();
    const socket = await connect();
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
    await tell(socket, { type: 'auth', token: webToken() });
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
    await tell(socket, { type: 'auth', token: webToken() });
    socket.onSend = () => relay.webSocketClose(socket as unknown as WebSocket);
    expect(await command('play')).toEqual({ ok: false, code: 'no_tab' });
  });

  it('takes an answer only from the tab that was asked', async () => {
    fakeClock(Date.now());
    const { connect, tell, command } = makeRelay();
    const asked = await connect();
    await tell(asked, { type: 'auth', token: webToken() });
    const other = await connect();
    await tell(other, { type: 'auth', token: webToken() });
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
    await tell(silent, { type: 'auth', token: webToken() });
    const reply = command('status');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(((await reply).tabs as unknown[]).length).toBe(1);
  });
});

describe('GET /mcp/tab', () => {
  const relayed = () => {
    const fetch = vi.fn(async (_request: Request) => new Response('from the relay'));
    const idFromName = vi.fn((name: string) => name);
    const namespace = { idFromName, get: () => ({ fetch }) } as unknown as Env['TAB_RELAY'];
    return { fetch, idFromName, w: worker(undefined, { TAB_RELAY: namespace }) };
  };
  const url = `${ORIGIN}/mcp/tab?u=11111111-1111-4111-8111-111111111111`;

  it("reaches that user's relay, from the site itself", async () => {
    const { fetch, idFromName, w } = relayed();
    const response = await w.fetch(url, { headers: { upgrade: 'WebSocket', origin: ORIGIN } });
    expect(await response.text()).toBe('from the relay');
    expect(idFromName).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(fetch.mock.calls[0][0].headers.get('x-tab-user')).toBe('11111111-1111-4111-8111-111111111111');
  });

  it("doesn't let a request say for itself who it was checked to be", async () => {
    const { fetch, w } = relayed();
    await w.fetch(url, { headers: { upgrade: 'websocket', origin: ORIGIN, 'x-tab-user': 'someone-else' } });
    expect(fetch.mock.calls[0][0].headers.get('x-tab-user')).toBe('11111111-1111-4111-8111-111111111111');
  });

  it.each([{ origin: 'https://evil.test' }, {}])('refuses other origins and none: %j', async (extra) => {
    const { fetch, w } = relayed();
    const response = await w.fetch(url, { headers: { upgrade: 'websocket', ...extra } });
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a missing or malformed user', async () => {
    const { fetch, w } = relayed();
    const headers = { upgrade: 'websocket', origin: ORIGIN };
    expect((await w.fetch(`${ORIGIN}/mcp/tab`, { headers })).status).toBe(400);
    expect((await w.fetch(`${ORIGIN}/mcp/tab?u=../x`, { headers })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers 426 without an upgrade and 405 to a POST', async () => {
    const { fetch, w } = relayed();
    expect((await w.fetch(url, { headers: { origin: ORIGIN } })).status).toBe(426);
    expect((await w.fetch(url, { method: 'POST' })).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
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
    ['update_code', { code: 'x' }, 'update_code'],
    ['open_track', { trackId: 't' }, 'open_track'],
  ])('%s reaches the tab', async (tool, args, command) => {
    const seen: string[] = [];
    const { tools } = await withRelay((name) => (seen.push(name), { ok: true, result: { playing: true } }));
    expect((await tools.call(tool, args)).structured).toEqual({ playing: true });
    expect(seen).toEqual([command]);
  });

  it.each(['transition_in_progress', 'conflict_open', 'save_failed', 'no_track_open', 'not_found'])(
    'passes on %s with a next step',
    async (code) => {
      const { tools } = await withRelay(() => ({ ok: false, code }));
      const { error } = await tools.call('update_code', { code: 'x' });
      expect(error.code).toBe(code);
      expect(error.next).toBeTruthy();
    },
  );

  it('says "A transition is in progress" in those words', async () => {
    const { tools } = await withRelay(() => ({ ok: false, code: 'transition_in_progress' }));
    expect((await tools.call('play')).error.message).toBe('A transition is in progress.');
  });

  it('gives the line of a code mistake', async () => {
    const error = { message: 'Unexpected token', line: 3 };
    const { tools } = await withRelay(() => ({ ok: false, code: 'code_error', error }));
    expect((await tools.call('update_code', { code: 'x' })).error).toMatchObject({ code: 'code_error', error });
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
    const { error } = await tools.call('update_code', { code: 'x'.repeat(512 * 1024 + 1) });
    expect(error.code).toBe('too_large');
    expect(seen).toEqual([]);
  });

  it('never logs the code', async () => {
    const { tools } = await withRelay(() => ({ ok: true, result: {} }));
    await tools.call('update_code', { code: 'PRIVATE_CODE' });
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
