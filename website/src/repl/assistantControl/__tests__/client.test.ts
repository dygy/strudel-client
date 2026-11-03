/**
 * @spec: 018-strudel-mcp-server (tech 2.7)
 * The tab's socket: the token goes in the first message and never the address, and off means gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssistantControlClient, HEARTBEAT_MS, onSessionChange, type CommandHandler } from '../client';

class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed: Array<[number | undefined, string | undefined]> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  constructor(readonly url: string) {}
  send(message: string) {
    this.sent.push(message);
  }
  close(code?: number, reason?: string) {
    this.closed.push([code, reason]);
  }
}

const USER = '11111111-1111-4111-8111-111111111111';

function setup(handle: CommandHandler = async () => ({ ok: true, result: {} }), prepareSession = async () => true) {
  const sockets: FakeSocket[] = [];
  const onState = vi.fn();
  const prepare = vi.fn(prepareSession);
  const client = createAssistantControlClient({
    origin: 'https://strudel.test',
    prepareSession: prepare,
    handle,
    onState,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { client, sockets, onState, prepare };
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connecting', () => {
  it('has no socket until started', async () => {
    const { sockets } = setup();
    await flush();
    expect(sockets).toEqual([]);
  });

  it('has nothing about the user or the token in the address, and sends neither on opening', async () => {
    const { client, sockets } = setup();
    client.start();
    await flush();
    expect(sockets[0].url).toBe('wss://strudel.test/mcp/tab');
    sockets[0].onopen!();
    expect(sockets[0].sent).toEqual([]);
  });

  it('brings the session up to date before it opens, which renews an expired cookie', async () => {
    const order: string[] = [];
    const { client, sockets } = setup(undefined, async () => {
      order.push(`session, with ${sockets.length} sockets`);
      return true;
    });
    client.start();
    await flush();
    expect(order).toEqual(['session, with 0 sockets']);
    expect(sockets).toHaveLength(1);
  });

  it('reports connected once the relay accepts it', async () => {
    const { client, sockets, onState } = setup();
    client.start();
    await flush();
    sockets[0].onmessage!({ data: JSON.stringify({ type: 'ready', tabId: 'x' }) });
    expect(onState).toHaveBeenLastCalledWith('connected');
  });

  it('sends a refreshed token', async () => {
    const { client, sockets } = setup();
    client.start();
    await flush();
    client.sendToken('NEW.TOKEN');
    expect(JSON.parse(sockets[0].sent.at(-1)!)).toEqual({ type: 'token', token: 'NEW.TOKEN' });
  });

  it('opens nothing with no session', async () => {
    const { client, sockets } = setup(undefined, async () => false);
    client.start();
    await flush();
    expect(sockets).toEqual([]);
  });
});

describe('commands', () => {
  it('answers with the same id', async () => {
    const handle = vi.fn(async () => ({ ok: true as const, result: { playing: true } }));
    const { client, sockets } = setup(handle);
    client.start();
    await flush();
    sockets[0].onmessage!({ data: JSON.stringify({ type: 'command', id: 'c1', command: 'play', args: { a: 1 } }) });
    await flush();
    expect(handle).toHaveBeenCalledWith('play', { a: 1 });
    expect(JSON.parse(sockets[0].sent.at(-1)!)).toEqual({
      type: 'ack',
      id: 'c1',
      answer: { ok: true, result: { playing: true } },
    });
  });

  it('says so when a command throws, rather than leaving the assistant to time out', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, sockets } = setup(() => Promise.reject(new Error('boom')));
    client.start();
    await flush();
    sockets[0].onmessage!({ data: JSON.stringify({ type: 'command', id: 'c1', command: 'play' }) });
    await flush();
    error.mockRestore();
    expect(JSON.parse(sockets[0].sent.at(-1)!).answer).toEqual({ ok: false, code: 'tab_error' });
  });

  it('ignores what it can not read', async () => {
    const { client, sockets } = setup();
    client.start();
    await flush();
    expect(() => sockets[0].onmessage!({ data: 'not json' })).not.toThrow();
  });
});

describe('turning off', () => {
  it('closes the socket at once, so the relay refuses the next action', async () => {
    const { client, sockets } = setup();
    client.start();
    await flush();
    client.stop();
    expect(sockets[0].closed).toEqual([[1000, 'Turned off']]);
  });

  it('never reconnects after that', async () => {
    const { client, sockets } = setup();
    client.start();
    await flush();
    client.stop();
    sockets[0].onclose?.({ code: 1000 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets).toHaveLength(1);
  });

  it('does not open a socket if turned off while looking up the session', async () => {
    const { client, sockets } = setup();
    client.start();
    client.stop();
    await flush();
    expect(sockets).toEqual([]);
  });
});

describe('staying connected', () => {
  it('reconnects, more slowly each time', async () => {
    const { client, sockets } = setup();
    client.start();
    await flush();
    sockets[0].onclose!({ code: 1006 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    sockets[1].onclose!({ code: 1006 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(3);
  });

  it('does not loop on a refused upgrade: each try waits longer, and renews the session first', async () => {
    const { client, sockets, prepare } = setup();
    client.start();
    await flush();
    // A refused upgrade: closed, and never `ready`.
    const waits = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const [i, ms] of waits.entries()) {
      sockets[i].onclose!({ code: 1006 });
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(sockets).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(i + 2);
    }
    expect(prepare).toHaveBeenCalledTimes(waits.length + 1);
  });

  it('keeps waiting, and opens nothing, while there is no session', async () => {
    const { client, sockets, prepare } = setup(undefined, async () => false);
    client.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sockets).toEqual([]);
    expect(prepare).toHaveBeenCalledTimes(3);
  });

  it('goes back to a quick retry only once the relay has accepted a socket', async () => {
    const { client, sockets } = setup();
    client.start();
    await flush();
    sockets[0].onclose!({ code: 1006 });
    await vi.advanceTimersByTimeAsync(1_000);
    sockets[1].onmessage!({ data: JSON.stringify({ type: 'ready', tabId: 'x' }) });
    sockets[1].onclose!({ code: 1006 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(3);
  });

  it('waits longer after the relay said the session ended', async () => {
    const { client, sockets } = setup();
    client.start();
    await flush();
    sockets[0].onmessage!({ data: JSON.stringify({ type: 'ready', tabId: 'x' }) });
    sockets[0].onclose!({ code: 4401 });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
  });

  it('pings, and closes a socket that stops answering so that it reconnects', async () => {
    const { client, sockets } = setup();
    client.start();
    await flush();
    sockets[0].onopen!();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(sockets[0].sent).toContain('ping');
    sockets[0].onmessage!({ data: 'pong' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets[0].closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(sockets[0].closed).toHaveLength(1);
  });
});

describe('when the session changes', () => {
  const session = (id = USER) => ({ access_token: 'NEW', user: { id } });
  const run = (event: string, value: ReturnType<typeof session> | null, userId: string | null = USER) => {
    const sendToken = vi.fn();
    const turnOff = vi.fn();
    onSessionChange(event, value, userId, { sendToken, turnOff });
    return { sendToken, turnOff };
  };

  it('sends a refreshed token, and stays on', () => {
    const { sendToken, turnOff } = run('TOKEN_REFRESHED', session());
    expect(sendToken).toHaveBeenCalledWith('NEW');
    expect(turnOff).not.toHaveBeenCalled();
  });

  it('turns off on sign-out', () => {
    expect(run('SIGNED_OUT', null).turnOff).toHaveBeenCalledOnce();
  });

  it('turns off when someone else has signed in', () => {
    const { turnOff, sendToken } = run('TOKEN_REFRESHED', session('someone-else'));
    expect(turnOff).toHaveBeenCalledOnce();
    expect(sendToken).not.toHaveBeenCalled();
  });

  it('leaves things alone otherwise', () => {
    const { turnOff, sendToken } = run('USER_UPDATED', session());
    expect(turnOff).not.toHaveBeenCalled();
    expect(sendToken).not.toHaveBeenCalled();
  });
});
