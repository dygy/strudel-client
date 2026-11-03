/** HTTP surface of the Worker: everything the two routes in wrangler.jsonc can receive. */
import { bearerToken, checkTabToken, checkToken, sessionCookie } from './auth';
import { fail, type ToolContext } from './context';
import { isTool } from './tools';
import type { Deps, Env } from './env';
import { dispatch, INVALID_REQUEST, PARSE_ERROR, rpcError, SUPPORTED_PROTOCOL_VERSIONS } from './jsonrpc';

const MCP_PATH = '/mcp';
const TAB_PATH = '/mcp/tab';
const METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';

/** Room for a 512 KB track (spec 2.4) once it's escaped into JSON. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Must match `ratelimits` in wrangler.jsonc. */
export const RATE_LIMIT_PER_MINUTE = 120;

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });

/** A tool call gets a result it can act on; anything else, the HTTP answer. */
function rateLimited(message: unknown) {
  const { id, method, params } = (message ?? {}) as { id?: string | number; method?: unknown; params?: unknown };
  const text = `Too many requests: at most ${RATE_LIMIT_PER_MINUTE} a minute.`;
  if (method === 'tools/call' && id !== undefined) {
    const name = (params as { name?: unknown } | undefined)?.name;
    const reply = fail('rate_limited', text, 'Wait a minute, then try again. Nothing was changed.');
    return {
      body: { jsonrpc: '2.0', id, result: reply },
      status: 200,
      headers: {} as Record<string, string>,
      handler: `tools/call:${isTool(name) ? name : 'unknown'}`,
    };
  }
  return {
    body: rpcError(null, INVALID_REQUEST, `${text} Wait a minute, then try again.`),
    status: 429,
    headers: { 'retry-after': '60' },
    handler: 'transport',
  };
}

const refusal = (status: number, message: string, headers: Record<string, string> = {}) =>
  json(rpcError(null, INVALID_REQUEST, message), status, headers);

const metadataUrl = (origin: string) => `${origin}${METADATA_PATH}`;

/** RFC 9728 + RFC 6750: where to sign in, and, when a token was sent, that it was no good. */
function challenge(origin: string, description?: string): Response {
  const parts = [`resource_metadata="${metadataUrl(origin)}"`];
  if (description) parts.unshift('error="invalid_token"', `error_description="${description}"`);
  return json(rpcError(null, INVALID_REQUEST, description ?? 'Sign in to use this server'), 401, {
    'www-authenticate': `Bearer ${parts.join(', ')}`,
  });
}

function protectedResourceMetadata(request: Request, env: Env, origin: string): Response {
  const cors = { 'access-control-allow-origin': '*' };
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': '*' },
    });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return refusal(405, 'Method not allowed', { allow: 'GET, HEAD, OPTIONS' });
  }
  return json(
    {
      resource: `${origin}${MCP_PATH}`,
      authorization_servers: [`${env.PUBLIC_SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ['header'],
    },
    200,
    { ...cors, 'cache-control': 'public, max-age=3600' },
  );
}

async function mcpPost(request: Request, env: Env, deps: Deps, origin: string, started: number): Promise<Response> {
  const finish = (response: Response, handler: string, outcome: string) => {
    deps.log({ handler, outcome, ms: Date.now() - started });
    return response;
  };

  // MCP requires this against DNS rebinding. Browsers always send Origin, and non-browser clients
  // don't, so this only ever refuses a page on another site.
  const pageOrigin = request.headers.get('origin');
  if (pageOrigin !== null && pageOrigin !== origin) {
    return finish(refusal(403, 'Origin not allowed'), 'auth', 'bad_origin');
  }

  const token = bearerToken(request);
  if (!token) return finish(challenge(origin), 'auth', 'no_token');
  const check = await checkToken(token, env, deps.fetch);
  if (!check.ok) {
    if (check.reason === 'service_unavailable') {
      return finish(
        refusal(503, 'The sign-in service could not be reached. Try again.', { 'retry-after': '5' }),
        'auth',
        check.reason,
      );
    }
    const description =
      check.reason === 'web_session'
        ? 'This token was not issued to an assistant. Connect through the sign-in flow.'
        : 'The token is not valid or has been revoked. Connect again.';
    return finish(challenge(origin, description), 'auth', check.reason);
  }

  const version = request.headers.get('mcp-protocol-version');
  if (version !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return finish(refusal(400, 'Unsupported MCP-Protocol-Version'), 'transport', 'bad_protocol_version');
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    return finish(refusal(415, 'Expected application/json'), 'transport', 'bad_content_type');
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return finish(refusal(413, 'The request is too large'), 'transport', 'too_large');
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return finish(refusal(413, 'The request is too large'), 'transport', 'too_large');
  }

  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return finish(json(rpcError(null, PARSE_ERROR, 'Parse error'), 400), 'transport', 'parse_error');
  }

  // Per user, so one assistant can't use up the account's quota. Eventually consistent, as the binding
  // is, and open if it's missing or fails: a limit must never be why the library can't be reached.
  const limited = await deps.isRateLimited?.(check.identity.userId).catch(() => false);
  if (limited) {
    const over = rateLimited(message);
    return finish(json(over.body, over.status, over.headers), over.handler, 'rate_limited');
  }

  const ctx: ToolContext = {
    env,
    identity: check.identity,
    token,
    fetch: deps.fetch,
    site: deps.site,
    origin,
  };
  const reply = await dispatch(message, ctx);
  if (!reply) return finish(new Response(null, { status: 202 }), 'notification', 'accepted');
  return finish(json(reply.body), reply.handler, reply.outcome);
}

/**
 * The WebSocket spike (spec task slice 1): the Origin check is the one part of the final relay
 * that's here already, because browsers don't apply CORS to WebSockets.
 */
/**
 * A tab's socket, authenticated here at the upgrade with the session cookie the browser sends to its own
 * origin: the one place this Worker reads a cookie. Anything refused never reaches a Durable Object, so
 * a stranger can't wake one. Browsers don't apply CORS to WebSockets, so the Origin is checked first.
 */
async function tabSocket(request: Request, env: Env, deps: Deps, origin: string, started: number): Promise<Response> {
  const finish = (response: Response, outcome: string) => {
    deps.log({ handler: 'tab/connect', outcome, ms: Date.now() - started });
    return response;
  };
  if (request.method !== 'GET') return refusal(405, 'Method not allowed', { allow: 'GET' });
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return refusal(426, 'Expected a WebSocket', { upgrade: 'websocket' });
  }
  if (request.headers.get('origin') !== origin) return finish(refusal(403, 'Origin not allowed'), 'bad_origin');

  const token = sessionCookie(request);
  if (!token) return finish(refusal(401, 'Sign in'), 'no_cookie');
  const check = await checkTabToken(token, env, deps.fetch);
  if (!check.ok) {
    return check.reason === 'service_unavailable'
      ? finish(refusal(503, 'Try again', { 'retry-after': '5' }), check.reason)
      : finish(refusal(401, 'Sign in'), check.reason);
  }
  // A new request, so these say what was verified here. Nothing the client sent gets through.
  const response = await env.TAB_RELAY.get(env.TAB_RELAY.idFromName(check.userId)).fetch(
    new Request('https://relay/connect', {
      headers: { upgrade: 'websocket', 'x-tab-user': check.userId, 'x-tab-expires': String(check.expiresAt) },
    }),
  );
  return finish(response, 'ok');
}

export async function handleRequest(request: Request, env: Env, deps: Deps): Promise<Response> {
  const started = Date.now();
  const { origin, pathname } = new URL(request.url);

  if (pathname === METADATA_PATH) return protectedResourceMetadata(request, env, origin);
  if (pathname === TAB_PATH) return tabSocket(request, env, deps, origin, started);
  if (pathname !== MCP_PATH) return refusal(404, 'Not found');
  if (request.method !== 'POST') return refusal(405, 'Method not allowed', { allow: 'POST' });
  return mcpPost(request, env, deps, origin, started);
}
