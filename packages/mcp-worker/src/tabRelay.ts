/**
 * Spike only (task slice 1): one socket that echoes, to test a WebSocket through the route. Slice 8
 * replaces it with the real relay, keyed by verified user, with a token as the first message.
 *
 * A plain class on purpose: `cloudflare:workers` doesn't resolve under plain vitest, and workerd
 * doesn't require the DurableObject base class.
 */
const MAX_MESSAGE_LENGTH = 4096;
const MESSAGE_TOO_BIG = 1009;

export class TabRelay {
  constructor(private readonly ctx: DurableObjectState) {}

  fetch(request: Request): Response {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426, headers: { upgrade: 'websocket' } });
    }
    for (const previous of this.ctx.getWebSockets()) previous.close(1000, 'Replaced by a newer socket');
    const { 0: client, 1: server } = new WebSocketPair();
    // The hibernation API: an idle socket costs no Durable Object duration.
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const length = typeof message === 'string' ? message.length : message.byteLength;
    if (length > MAX_MESSAGE_LENGTH) socket.close(MESSAGE_TOO_BIG, 'Message too big');
    else socket.send(message);
  }
}
