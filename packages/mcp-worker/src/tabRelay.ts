/**
 * The relay between an assistant's tool calls and the user's open tabs (spec 018, tech 2.7). One per
 * user: the Worker asks for it by user id, and a socket only counts as a tab once its first message has
 * proved it's that user. A socket that hasn't is never told or asked anything.
 *
 * What's kept across hibernation is on each socket's attachment; the waiting commands are in memory
 * only because a request in flight keeps the object awake. A plain class on purpose:
 * `cloudflare:workers` doesn't resolve under plain vitest, and workerd doesn't require the base class.
 */
import { checkTabToken } from './auth';
import type { Env } from './env';

/** How long a socket may stay silent before saying who it is. */
export const AUTH_DEADLINE_MS = 10_000;
/** A tab refreshes its token before this: past expiry plus this, it's treated as gone. */
export const TOKEN_GRACE_MS = 60_000;
export const STATUS_TIMEOUT_MS = 2_000;
const MAX_SOCKETS = 8;
/** A tab sends tokens and short answers. A hostile socket gets no further than this. */
const MAX_INCOMING_LENGTH = 64 * 1024;

export const CLOSE_NOT_SIGNED_IN = 4401;
export const CLOSE_TRY_AGAIN = 4503;
const CLOSE_TOO_BIG = 1009;

/** Who a socket says it is. `tabId` is null until the token has been checked. */
interface Attachment {
  userId: string;
  tabId: string | null;
  connectedAt: number;
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

  private async connect(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426, headers: { upgrade: 'websocket' } });
    }
    const userId = request.headers.get('x-tab-user');
    if (!userId) return new Response('No user', { status: 400 });

    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= MAX_SOCKETS) {
      // Silent sockets make way, so a stranger can't keep the owner's tabs out. Otherwise, it's full.
      const silent = sockets.find((socket) => this.attachment(socket)?.tabId === null);
      if (!silent) return new Response('Too many tabs', { status: 429 });
      silent.close(CLOSE_NOT_SIGNED_IN, 'Not signed in');
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const now = Date.now();
    server.serializeAttachment({ userId, tabId: null, connectedAt: now, expiresAt: 0 } satisfies Attachment);
    await this.ctx.storage.setAlarm(now + AUTH_DEADLINE_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Closes sockets that never said who they are. */
  alarm(): void {
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (attachment?.tabId === null && now - attachment.connectedAt >= AUTH_DEADLINE_MS) {
        socket.close(CLOSE_NOT_SIGNED_IN, 'Not signed in');
      }
    }
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const length = typeof message === 'string' ? message.length : message.byteLength;
    if (length > MAX_INCOMING_LENGTH) {
      socket.close(CLOSE_TOO_BIG, 'Message too big');
      return;
    }
    const attachment = this.attachment(socket);
    let parsed: { type?: unknown; id?: unknown; token?: unknown; answer?: unknown } | null = null;
    try {
      parsed = typeof message === 'string' ? JSON.parse(message) : null;
    } catch {
      // Falls through: what isn't understood from a socket that hasn't signed in ends it.
    }

    if (parsed?.type === 'auth' && typeof parsed.token === 'string' && attachment) {
      await this.authenticate(socket, attachment, parsed.token);
      return;
    }
    if (!attachment || attachment.tabId === null) {
      socket.close(CLOSE_NOT_SIGNED_IN, 'Not signed in');
      return;
    }
    if (parsed?.type === 'ack' && typeof parsed.id === 'string') {
      const waiting = this.waiting.get(parsed.id);
      // Only the tab that was asked can answer.
      if (waiting && waiting.socket === socket) this.settle(parsed.id, parsed.answer as RelayAnswer);
    }
  }

  /** The first message, and each refreshed token after it. */
  private async authenticate(socket: WebSocket, attachment: Attachment, token: string): Promise<void> {
    const check = await checkTabToken(token, attachment.userId, this.env, this.fetchImpl);
    if (!check.ok) {
      if (check.reason === 'service_unavailable') {
        // Says nothing about the token. A tab already signed in carries on until its token runs out.
        if (attachment.tabId === null) socket.close(CLOSE_TRY_AGAIN, 'Try again');
        return;
      }
      socket.close(CLOSE_NOT_SIGNED_IN, 'Not signed in');
      return;
    }
    const tabId = attachment.tabId ?? crypto.randomUUID();
    socket.serializeAttachment({ ...attachment, tabId, expiresAt: check.expiresAt } satisfies Attachment);
    socket.send(JSON.stringify({ type: 'ready', tabId }));
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

  /** Tabs that proved who they are and whose token still stands. */
  private tabs(): Array<{ socket: WebSocket; tabId: string }> {
    const now = Date.now();
    const tabs: Array<{ socket: WebSocket; tabId: string }> = [];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (!attachment?.tabId) continue;
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
