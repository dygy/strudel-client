/** What a tool gets to work with, how it answers, and the two ways it reaches data. */
import type { AssistantIdentity } from './auth';
import type { Env } from './env';

export interface ToolContext {
  env: Env;
  identity: AssistantIdentity;
  token: string;
  fetch: typeof fetch;
  /** The site's Worker, over the service binding. */
  site: (request: Request) => Promise<Response>;
  origin: string;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Stable codes: an assistant can branch on these. */
export type ErrorCode =
  | 'invalid_arguments'
  | 'not_found'
  | 'version_conflict'
  | 'name_taken'
  | 'too_large'
  | 'folder_not_empty'
  | 'last_step'
  | 'use_local_helper'
  | 'rate_limited'
  | 'reconnect'
  | 'service_unavailable';

export const ok = (structuredContent: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
  structuredContent,
});

export const fail = (
  code: ErrorCode,
  message: string,
  next?: string,
  extra: Record<string, unknown> = {},
): ToolResult => {
  const error = { code, message, ...(next ? { next } : {}), ...extra };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(error) }] };
};

export const unavailable = () =>
  fail('service_unavailable', 'The library could not be reached, and nothing was changed.', 'Try again in a moment.');
export const reconnect = () =>
  fail('reconnect', 'This connection has expired, and nothing was changed.', 'Connect the assistant again.');

/** The same shape as the app's nanoid ids, which `generateTrackUrlPath` tells from paths by their length. */
export function newId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  return Array.from(crypto.getRandomValues(new Uint8Array(21)), (byte) => alphabet[byte & 63]).join('');
}

/** Thrown out of a tool to answer with this result. */
export class ToolFailure extends Error {
  constructor(readonly result: ToolResult) {
    super('tool failure');
  }
}

/** Reads through Supabase REST, as the user, so RLS applies. */
export async function rest<T>(ctx: ToolContext, table: string, params: Record<string, string>): Promise<T[]> {
  const query = new URLSearchParams(params).toString();
  let response: Response;
  try {
    response = await ctx.fetch(`${ctx.env.PUBLIC_SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: { apikey: ctx.env.PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${ctx.token}` },
    });
  } catch {
    throw new ToolFailure(unavailable());
  }
  if (response.status === 401 || response.status === 403) throw new ToolFailure(reconnect());
  if (!response.ok) throw new ToolFailure(unavailable());
  try {
    return (await response.json()) as T[];
  } catch {
    throw new ToolFailure(unavailable());
  }
}

/** Writes through the site's own routes, so its naming and path rules stay in one place. */
export async function siteCall(
  ctx: ToolContext,
  method: string,
  path: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await ctx.site(
      new Request(`${ctx.origin}${path}`, {
        method,
        headers: { authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  } catch {
    throw new ToolFailure(unavailable());
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

/** What a route's refusal means to an assistant. */
export function refusal(what: 'Track' | 'Folder', { status, data }: { status: number; data: Record<string, unknown> }) {
  const said = typeof data.error === 'string' ? data.error : undefined;
  if (status === 401) return reconnect();
  if (status === 404) return fail('not_found', `${what} not found`);
  if (status === 409 && data.code === 'version_conflict') {
    return fail(
      'version_conflict',
      `This ${what.toLowerCase()} changed since you read it`,
      'Read it again, and apply your change to what is there now.',
      { currentVersion: (data.current as { version?: unknown } | undefined)?.version },
    );
  }
  if (status === 409 && data.code === 'folder_not_empty') {
    return fail('folder_not_empty', 'This folder is not empty, and nothing was deleted.', undefined, {
      contents: data.contents,
    });
  }
  if (status === 409) return fail('name_taken', said ?? 'That name is taken here.', 'Use another name.');
  if (status === 413) return fail('too_large', said ?? 'That is too large.');
  if (status >= 400 && status < 500) return fail('invalid_arguments', said ?? 'That was refused.');
  return unavailable();
}
