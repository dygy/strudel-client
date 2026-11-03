/**
 * The tab's end of the relay: one socket, which exists only while the switch is on. The Worker checks
 * the session cookie the browser sends with the upgrade, and a refused upgrade looks the same here as a
 * network failure. So before every try the session is brought up to date, which is what renews an
 * expired cookie, and only a socket the relay has accepted resets the wait between tries. A refreshed
 * token is sent over the socket. Framework-free, with no knowledge of what the commands do.
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

export interface AssistantControlClientOptions {
  /** The site's own origin, because the socket's Origin has to be it. */
  origin: string;
  /** Brings the session and its cookie up to date. False if there's no session. */
  prepareSession: () => Promise<boolean>;
  handle: CommandHandler;
  onState?: (state: ConnectionState) => void;
  createSocket?: (url: string) => WebSocket;
}

export function createAssistantControlClient({
  origin,
  prepareSession,
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
    let signedIn = false;
    try {
      signedIn = await prepareSession();
    } catch (error: unknown) {
      console.warn('[assistant control] no session:', error);
    }
    if (stopped) return;
    if (!signedIn) {
      retryLater();
      return;
    }
    const opened = createSocket(`${origin.replace(/^http/, 'ws')}/mcp/tab`);
    socket = opened;

    opened.onopen = () => {
      if (socket !== opened) return;
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
      // Its session has ended, or nearly: not worth a quick try.
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
      send({ type: 'token', token: accessToken });
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
