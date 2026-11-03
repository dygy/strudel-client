/** HTTP surface of the Worker: everything the two routes in wrangler.jsonc can receive. */
import { bearerToken, checkToken } from './auth';
import type { Deps, Env } from './env';
import { dispatch, INVALID_REQUEST, PARSE_ERROR, rpcError, SUPPORTED_PROTOCOL_VERSIONS } from './jsonrpc';

const MCP_PATH = '/mcp';
const TAB_PATH = '/mcp/tab';
const METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';

/** Room for a 512 KB track (spec 2.4) once it's escaped into JSON. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });

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

  const reply = dispatch(message, check.identity);
  if (!reply) return finish(new Response(null, { status: 202 }), 'notification', 'accepted');
  return finish(json(reply.body), reply.handler, reply.outcome);
}

/**
 * The WebSocket spike (spec task slice 1): the Origin check is the one part of the final relay
 * that's here already, because browsers don't apply CORS to WebSockets.
 */
function tabSocket(request: Request, env: Env, origin: string): Promise<Response> | Response {
  if (env.TAB_ECHO_ENABLED !== '1') return refusal(404, 'Not found');
  if (request.method !== 'GET') return refusal(405, 'Method not allowed', { allow: 'GET' });
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return refusal(426, 'Expected a WebSocket', { upgrade: 'websocket' });
  }
  if (request.headers.get('origin') !== origin) return refusal(403, 'Origin not allowed');
  return env.TAB_RELAY.get(env.TAB_RELAY.idFromName('spike')).fetch(request);
}

export async function handleRequest(request: Request, env: Env, deps: Deps): Promise<Response> {
  const started = Date.now();
  const { origin, pathname } = new URL(request.url);

  if (pathname === METADATA_PATH) return protectedResourceMetadata(request, env, origin);
  if (pathname === TAB_PATH) return tabSocket(request, env, origin);
  if (pathname !== MCP_PATH) return refusal(404, 'Not found');
  if (request.method !== 'POST') return refusal(405, 'Method not allowed', { allow: 'POST' });
  return mcpPost(request, env, deps, origin, started);
}
