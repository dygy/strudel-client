/**
 * Hand-written JSON-RPC for MCP's stateless JSON mode (no SDK or zod: Workers Free allows 10 ms of
 * CPU per request, and building a server per request doesn't fit). Pure: no I/O, so it's cheap.
 */
import type { AssistantIdentity } from './auth';
import { TOOLS, whoami } from './tools';

/** The revision this server is written against. */
export const PROTOCOL_VERSION = '2025-11-25';
/**
 * Older revisions it can also answer, since they differ only in things it doesn't use. A client
 * that asks for one of them must get it back, or it disconnects (MCP lifecycle, version negotiation).
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [PROTOCOL_VERSION, '2025-06-18', '2025-03-26'];

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

type Id = string | number | null;

export interface RpcReply {
  body: unknown;
  /** For the log: never holds anything the client chose freely. */
  handler: string;
  outcome: string;
}

const result = (id: Id, value: unknown) => ({ jsonrpc: '2.0', id, result: value });
export const rpcError = (id: Id, code: number, message: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function initialize(params: Record<string, unknown>) {
  const asked = params.protocolVersion;
  return {
    protocolVersion:
      typeof asked === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: 'strudel-mcp', title: 'Strudel', version: '0.0.0' },
  };
}

/**
 * Answers one parsed message. Returns null when no reply is due: a notification, or a client's
 * response to a server request (Streamable HTTP answers those with 202 and no body).
 */
export function dispatch(message: unknown, identity: AssistantIdentity): RpcReply | null {
  if (!isObject(message) || message.jsonrpc !== '2.0') {
    return {
      body: rpcError(null, INVALID_REQUEST, 'Expected one JSON-RPC 2.0 message'),
      handler: 'invalid',
      outcome: 'invalid_request',
    };
  }
  const { id, method } = message;
  if (typeof method !== 'string') {
    if (id !== undefined && ('result' in message || 'error' in message)) return null;
    return {
      body: rpcError(null, INVALID_REQUEST, 'Expected a method'),
      handler: 'invalid',
      outcome: 'invalid_request',
    };
  }
  if (id === undefined) return null;
  if (typeof id !== 'string' && typeof id !== 'number') {
    return {
      body: rpcError(null, INVALID_REQUEST, 'The id must be a string or a number'),
      handler: 'invalid',
      outcome: 'invalid_request',
    };
  }
  const params = message.params ?? {};
  if (!isObject(params)) {
    return {
      body: rpcError(id, INVALID_PARAMS, 'The params must be an object'),
      handler: 'invalid',
      outcome: 'invalid_params',
    };
  }

  switch (method) {
    case 'initialize':
      return { body: result(id, initialize(params)), handler: method, outcome: 'ok' };
    case 'ping':
      return { body: result(id, {}), handler: method, outcome: 'ok' };
    case 'tools/list':
      return { body: result(id, { tools: TOOLS }), handler: method, outcome: 'ok' };
    case 'tools/call':
      return callTool(id, params, identity);
    default:
      return {
        body: rpcError(id, METHOD_NOT_FOUND, 'Method not found'),
        handler: 'unknown_method',
        outcome: 'method_not_found',
      };
  }
}

function callTool(id: Id, params: Record<string, unknown>, identity: AssistantIdentity): RpcReply {
  if (params.name !== 'whoami') {
    return {
      body: rpcError(id, INVALID_PARAMS, 'Unknown tool'),
      handler: 'tools/call:unknown',
      outcome: 'unknown_tool',
    };
  }
  const args = params.arguments ?? {};
  if (!isObject(args) || Object.keys(args).length > 0) {
    return {
      body: result(id, {
        isError: true,
        content: [{ type: 'text', text: 'whoami takes no arguments' }],
      }),
      handler: 'tools/call:whoami',
      outcome: 'invalid_arguments',
    };
  }
  return { body: result(id, whoami(identity)), handler: 'tools/call:whoami', outcome: 'ok' };
}
