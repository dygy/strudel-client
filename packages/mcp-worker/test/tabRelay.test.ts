/**
 * @spec: 018-strudel-mcp-server (slice 1, spike)
 * The relay with fake sockets. Real WebSocket behaviour through the route is checked on prod by
 * the spike; plain vitest has no workerd.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabRelay } from '../src/tabRelay';
import type { Env } from '../src/env';
import { ORIGIN, worker } from './helpers';

class FakeSocket {
  sent: unknown[] = [];
  closed: Array<[number, string]> = [];
  send(message: unknown) {
    this.sent.push(message);
  }
  close(code: number, reason: string) {
    this.closed.push([code, reason]);
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

function makeState() {
  const accepted: FakeSocket[] = [];
  return {
    accepted,
    state: {
      getWebSockets: () => [...accepted],
      acceptWebSocket: (socket: FakeSocket) => accepted.push(socket),
    } as unknown as DurableObjectState,
  };
}

const socketRequest = () => new Request(`${ORIGIN}/mcp/tab`, { headers: { upgrade: 'websocket', origin: ORIGIN } });

beforeEach(() => {
  vi.stubGlobal(
    'WebSocketPair',
    class {
      0 = new FakeSocket();
      1 = new FakeSocket();
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('TabRelay', () => {
  it('accepts a socket through the hibernation API and returns the other end', () => {
    vi.stubGlobal('Response', FakeResponse);
    const { accepted, state } = makeState();
    const response = new TabRelay(state).fetch(socketRequest()) as unknown as FakeResponse;
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeInstanceOf(FakeSocket);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).not.toBe(response.webSocket);
  });

  it('keeps one socket: a new one closes the previous one', () => {
    vi.stubGlobal('Response', FakeResponse);
    const { accepted, state } = makeState();
    const relay = new TabRelay(state);
    relay.fetch(socketRequest());
    relay.fetch(socketRequest());
    expect(accepted[0].closed).toEqual([[1000, 'Replaced by a newer socket']]);
    expect(accepted[1].closed).toEqual([]);
  });

  it('echoes text and binary', () => {
    const socket = new FakeSocket();
    const relay = new TabRelay(makeState().state);
    const binary = new ArrayBuffer(4);
    relay.webSocketMessage(socket as unknown as WebSocket, 'hello');
    relay.webSocketMessage(socket as unknown as WebSocket, binary);
    expect(socket.sent).toEqual(['hello', binary]);
  });

  it('closes on a message over the limit, without echoing it', () => {
    const socket = new FakeSocket();
    new TabRelay(makeState().state).webSocketMessage(socket as unknown as WebSocket, 'x'.repeat(4097));
    expect(socket.sent).toEqual([]);
    expect(socket.closed[0][0]).toBe(1009);
  });

  it('answers 426 to a plain request', () => {
    const response = new TabRelay(makeState().state).fetch(new Request(`${ORIGIN}/mcp/tab`));
    expect(response.status).toBe(426);
  });
});

describe('GET /mcp/tab', () => {
  it('is not served unless switched on, because the echo has no sign-in', async () => {
    const response = await worker().fetch(`${ORIGIN}/mcp/tab`, { headers: { upgrade: 'websocket', origin: ORIGIN } });
    expect(response.status).toBe(404);
  });

  const relayed = () => {
    const fetch = vi.fn(async () => new Response('from the relay'));
    const idFromName = vi.fn(() => 'the-id');
    const namespace = { idFromName, get: () => ({ fetch }) } as unknown as Env['TAB_RELAY'];
    return { fetch, w: worker(undefined, { TAB_RELAY: namespace, TAB_ECHO_ENABLED: '1' }) };
  };

  it('reaches the relay from the site itself', async () => {
    const { fetch, w } = relayed();
    const response = await w.fetch(`${ORIGIN}/mcp/tab`, { headers: { upgrade: 'WebSocket', origin: ORIGIN } });
    expect(await response.text()).toBe('from the relay');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([{ origin: 'https://evil.test' }, {}])('refuses other origins and none: %j', async (extra) => {
    const { fetch, w } = relayed();
    const response = await w.fetch(`${ORIGIN}/mcp/tab`, { headers: { upgrade: 'websocket', ...extra } });
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers 426 without an upgrade and 405 to a POST', async () => {
    const { fetch, w } = relayed();
    expect((await w.fetch(`${ORIGIN}/mcp/tab`, { headers: { origin: ORIGIN } })).status).toBe(426);
    expect((await w.fetch(`${ORIGIN}/mcp/tab`, { method: 'POST' })).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });
});
