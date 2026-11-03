/**
 * The relay between an assistant's tool calls and the user's open tabs (spec 018, tech 2.7). One per
 * user. Every socket here was checked by the Worker at the upgrade (handler.ts), which is also what
 * chose this object, so all of them are this user's tabs. A session only lasts as long as its token: a
 * tab re-sends the token when it's refreshed, and past expiry a socket isn't trusted any more.
 *
 * What's kept across hibernation is on each socket's attachment; the waiting commands are in memory
 * only because a request in flight keeps the object awake. A plain class on purpose:
 * `cloudflare:workers` doesn't resolve under plain vitest, and workerd doesn't require the base class.
 */
import { checkTabToken } from './auth';
import type { Env } from './env';

/** A tab refreshes its token before this: past expiry plus this, it's treated as gone. */
export const TOKEN_GRACE_MS = 60_000;
export const STATUS_TIMEOUT_MS = 2_000;
const MAX_TABS = 8;
/** A tab sends tokens and short answers. */
const MAX_INCOMING_LENGTH = 64 * 1024;

export const CLOSE_NOT_SIGNED_IN = 4401;
const CLOSE_TOO_BIG = 1009;

/** What the Worker verified, and until when. */
interface Attachment {
  userId: string;
  tabId: string;
  expiresAt: number;
}

export type RelayAnswer = { ok: true; [key: string]: unknown } | { ok: false; code: string; [key: string]: unknown };

interface Waiting {
  socket: WebSocket;
  resolve: (answer: RelayAnswer) => void;
  timer: ReturnType<typeof setTimeout>;
}

const answerJson = (answer: RelayAnswer) =>
  new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } });

const NO_TAB: RelayAnswer = { ok: false, code: 'no_tab' };

export class TabRelay {
  private readonly waiting = new Map<string, Waiting>();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {
    // Answered without waking the object, so a tab's heartbeat costs nothing while nothing happens.
    ctx.setWebSocketAutoResponse?.(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  fetch(request: Request): Response | Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/connect') return this.connect(request);
    if (pathname === '/command') return this.command(request);
    return new Response('Not found', { status: 404 });
  }

  private attachment(socket: WebSocket): Attachment | null {
    return socket.deserializeAttachment() as Attachment | null;
  }

  private connect(request: Request): Response {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426, headers: { upgrade: 'websocket' } });
    }
    const userId = request.headers.get('x-tab-user');
    const expiresAt = Number(request.headers.get('x-tab-expires'));
    if (!userId || !expiresAt) return new Response('Not verified', { status: 400 });
    // Asks each socket whether it still stands, so ones past their token don't hold a place.
    if (this.tabs().length >= MAX_TABS) return new Response('Too many tabs', { status: 429 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const tabId = crypto.randomUUID();
    server.serializeAttachment({ userId, tabId, expiresAt } satisfies Attachment);
    server.send(JSON.stringify({ type: 'ready', tabId }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const length = typeof message === 'string' ? message.length : message.byteLength;
    if (length > MAX_INCOMING_LENGTH) {
      socket.close(CLOSE_TOO_BIG, 'Message too big');
      return;
    }
    let parsed: { type?: unknown; id?: unknown; token?: unknown; answer?: unknown } | null = null;
    try {
      parsed = typeof message === 'string' ? JSON.parse(message) : null;
    } catch {
      return;
    }
    if (parsed?.type === 'token' && typeof parsed.token === 'string') {
      await this.refresh(socket, parsed.token);
    } else if (parsed?.type === 'ack' && typeof parsed.id === 'string') {
      const waiting = this.waiting.get(parsed.id);
      // Only the tab that was asked can answer.
      if (waiting && waiting.socket === socket) this.settle(parsed.id, parsed.answer as RelayAnswer);
    }
  }

  /** The session's token was refreshed. It has to be the same user's, and it extends this socket's trust. */
  private async refresh(socket: WebSocket, token: string): Promise<void> {
    const attachment = this.attachment(socket);
    if (!attachment) return;
    const check = await checkTabToken(token, this.env, this.fetchImpl);
    if (check.ok && check.userId === attachment.userId) {
      socket.serializeAttachment({ ...attachment, expiresAt: check.expiresAt } satisfies Attachment);
    } else if (check.ok || check.reason === 'rejected') {
      socket.close(CLOSE_NOT_SIGNED_IN, 'Not signed in');
    }
    // An outage says nothing about the token: the socket carries on until the old one runs out.
  }

  webSocketClose(socket: WebSocket): void {
    this.forget(socket);
  }

  webSocketError(socket: WebSocket): void {
    this.forget(socket);
  }

  /** A tab that goes away while asked answers at once, rather than at the timeout. */
  private forget(socket: WebSocket): void {
    for (const [id, waiting] of this.waiting) {
      if (waiting.socket === socket) this.settle(id, NO_TAB);
    }
  }

  private settle(id: string, answer: RelayAnswer): void {
    const waiting = this.waiting.get(id);
    if (!waiting) return;
    this.waiting.delete(id);
    clearTimeout(waiting.timer);
    waiting.resolve(answer);
  }

  /** Tabs whose token still stands. One that has run out is closed. */
  private tabs(): Array<{ socket: WebSocket; tabId: string }> {
    const now = Date.now();
    const tabs: Array<{ socket: WebSocket; tabId: string }> = [];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (!attachment) continue;
      if (attachment.expiresAt + TOKEN_GRACE_MS < now) {
        socket.close(CLOSE_NOT_SIGNED_IN, 'Not signed in');
        continue;
      }
      tabs.push({ socket, tabId: attachment.tabId });
    }
    return tabs;
  }

  /** `argsJson` goes through as text: code can be 512 KB, and parsing it here would be CPU for nothing. */
  private ask(socket: WebSocket, command: string, argsJson: string, timeoutMs: number): Promise<RelayAnswer> {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => this.settle(id, { ok: false, code: 'tab_timeout' }), timeoutMs);
      this.waiting.set(id, { socket, resolve, timer });
      try {
        socket.send(
          `{"type":"command","id":${JSON.stringify(id)},"command":${JSON.stringify(command)},"args":${argsJson}}`,
        );
      } catch {
        this.settle(id, NO_TAB);
      }
    });
  }

  /** What each tab says it's doing. One that doesn't answer in time isn't listed. */
  private async statuses(tabs: Array<{ socket: WebSocket; tabId: string }>): Promise<unknown[]> {
    const answers = await Promise.all(
      tabs.map(async ({ socket, tabId }) => {
        const answer = await this.ask(socket, 'status', '{}', STATUS_TIMEOUT_MS);
        return answer?.ok ? { ...(answer.result as object), tabId } : null;
      }),
    );
    return answers.filter((answer) => answer !== null);
  }

  /**
   * One command to one tab: `x-tab-id` names it, or it's the only one there is. `status` with no id asks
   * them all. The body is the command's arguments as JSON.
   */
  private async command(request: Request): Promise<Response> {
    const command = request.headers.get('x-command') ?? '';
    const tabId = request.headers.get('x-tab-id');
    const timeoutMs = Number(request.headers.get('x-timeout-ms'));
    const tabs = this.tabs();

    if (command === 'status' && !tabId) return answerJson({ ok: true, tabs: await this.statuses(tabs) });
    if (tabs.length === 0) return answerJson(NO_TAB);

    let target = tabs[0];
    if (tabId) {
      const named = tabs.find((tab) => tab.tabId === tabId);
      if (!named) return answerJson(NO_TAB);
      target = named;
    } else if (tabs.length > 1) {
      return answerJson({ ok: false, code: 'ambiguous_tab', tabs: await this.statuses(tabs) });
    }
    return answerJson(await this.ask(target.socket, command, await request.text(), timeoutMs));
  }
}
