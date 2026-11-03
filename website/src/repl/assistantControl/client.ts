/**
 * The tab's end of the relay: one socket, which exists only while the switch is on. It says who it is
 * in its first message, and again whenever the session's token is refreshed. The token never goes in
 * the URL. Framework-free, with no knowledge of what the commands do.
 */
export const HEARTBEAT_MS = 30_000;
const PONG_WAIT_MS = 10_000;
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
/** Not signed in, as far as the relay can tell: another try needs another token. */
const CLOSE_NOT_SIGNED_IN = 4401;

export type RelayAnswer = { ok: true; result?: unknown } | { ok: false; code: string; [key: string]: unknown };
export type CommandHandler = (command: string, args: Record<string, unknown>) => Promise<RelayAnswer>;
export type ConnectionState = 'connecting' | 'connected' | 'offline';

export interface Session {
  userId: string;
  accessToken: string;
}

export interface AssistantControlClientOptions {
  /** The site's own origin, because the socket's Origin has to be it. */
  origin: string;
  getSession: () => Promise<Session | null>;
  handle: CommandHandler;
  onState?: (state: ConnectionState) => void;
  createSocket?: (url: string) => WebSocket;
}

export function createAssistantControlClient({
  origin,
  getSession,
  handle,
  onState,
  createSocket = (url) => new WebSocket(url),
}: AssistantControlClientOptions) {
  let socket: WebSocket | null = null;
  let stopped = true;
  let retryMs = FIRST_RETRY_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (heartbeat) clearInterval(heartbeat);
    if (pongTimer) clearTimeout(pongTimer);
    heartbeat = null;
    pongTimer = null;
  };

  const retryLater = () => {
    if (stopped || retryTimer) return;
    onState?.('offline');
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  };

  const send = (message: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const answer = async (id: string, command: string, args: Record<string, unknown>) => {
    let reply: RelayAnswer;
    try {
      reply = await handle(command, args);
    } catch (error: unknown) {
      console.error('[assistant control] a command failed:', command, error);
      reply = { ok: false, code: 'tab_error' };
    }
    send({ type: 'ack', id, answer: reply });
  };

  async function connect() {
    if (stopped) return;
    onState?.('connecting');
    let session: Session | null = null;
    try {
      session = await getSession();
    } catch (error: unknown) {
      console.warn('[assistant control] no session:', error);
    }
    if (stopped) return;
    if (!session) {
      retryLater();
      return;
    }
    const { userId, accessToken } = session;
    const opened = createSocket(`${origin.replace(/^http/, 'ws')}/mcp/tab?u=${encodeURIComponent(userId)}`);
    socket = opened;

    opened.onopen = () => {
      if (socket !== opened) return;
      opened.send(JSON.stringify({ type: 'auth', token: accessToken }));
      heartbeat = setInterval(() => {
        // Exactly this text: the relay answers it without waking up.
        if (opened.readyState === WebSocket.OPEN) opened.send('ping');
        pongTimer ??= setTimeout(() => opened.close(), PONG_WAIT_MS);
      }, HEARTBEAT_MS);
    };
    opened.onmessage = (event: MessageEvent) => {
      if (socket !== opened) return;
      if (event.data === 'pong') {
        if (pongTimer) clearTimeout(pongTimer);
        pongTimer = null;
        return;
      }
      let message: { type?: string; id?: string; command?: string; args?: Record<string, unknown> };
      try {
        message = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (message.type === 'ready') {
        retryMs = FIRST_RETRY_MS;
        onState?.('connected');
      } else if (message.type === 'command' && message.id && message.command) {
        void answer(message.id, message.command, message.args ?? {});
      }
    };
    opened.onclose = (event: CloseEvent) => {
      if (socket !== opened) return;
      socket = null;
      clearTimers();
      // A token that was turned down gets a new one on the next try, so that's worth one, slowly.
      if (event.code === CLOSE_NOT_SIGNED_IN) retryMs = Math.max(retryMs, MAX_RETRY_MS / 2);
      retryLater();
    };
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      retryMs = FIRST_RETRY_MS;
      void connect();
    },
    /** Closes at once, so the relay refuses the next action straight away. */
    stop() {
      stopped = true;
      clearTimers();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      const closing = socket;
      socket = null;
      closing?.close(1000, 'Turned off');
    },
    /** The session's token was refreshed. */
    sendToken(accessToken: string) {
      send({ type: 'auth', token: accessToken });
    },
  };
}

export type AssistantControlClient = ReturnType<typeof createAssistantControlClient>;

/**
 * What the session's changes mean to the switch: signed out, or someone else now, turns it off. A
 * refreshed token goes to the relay, which would otherwise drop this tab when the old one runs out.
 */
export function onSessionChange(
  event: string,
  session: { access_token: string; user: { id: string } } | null,
  userId: string | null,
  { sendToken, turnOff }: { sendToken: (token: string) => void; turnOff: () => void },
) {
  if (event === 'SIGNED_OUT' || !session || (userId !== null && session.user.id !== userId)) turnOff();
  else if (event === 'TOKEN_REFRESHED') sendToken(session.access_token);
}
