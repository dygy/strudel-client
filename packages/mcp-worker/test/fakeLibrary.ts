/**
 * A stand-in for the two things tools talk to: Supabase REST, where RLS shows a user only their own
 * rows, and the site's routes, which behave as the real ones do on what the Worker relies on.
 */
import { trackNameClashes } from '../../../website/src/lib/trackRename';
import { runQuery } from './fakePostgrest.mjs';
import { acceptingUpstream, assistantToken, MCP_URL, post, rpcBody, USER, withToken, worker } from './helpers';
import type { Deps, Env } from '../src/env';

export const OTHER_USER = 'user-2';

export interface Row {
  [key: string]: unknown;
  id: string;
  user_id: string;
  updated_at: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function fakeLibrary() {
  let clock = 0;
  const nextVersion = () => `opaque-${++clock}`;
  const tracks: Row[] = [];
  const folders: Row[] = [];
  const siteCalls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const failing = { rest: false, restStatus: 500, site: false, siteStatus: 0 };
  /** Runs just before a route looks at the row: another writer getting in first. */
  const hooks: { beforeRoute?: () => void } = {};

  const addFolder = (fields: Partial<Row> & { id: string; name: string }) => {
    const row = {
      path: fields.name,
      parent: null,
      user_id: USER.id,
      updated_at: nextVersion(),
      ...fields,
    } as Row;
    folders.push(row);
    return row;
  };
  const addTrack = (fields: Partial<Row> & { id: string; name: string }) => {
    const row = {
      code: '',
      folder: null,
      is_multitrack: false,
      steps: null,
      active_step: null,
      modified: '2026-01-01T00:00:00.000Z',
      created: '2026-01-01T00:00:00.000Z',
      user_id: USER.id,
      updated_at: nextVersion(),
      ...fields,
    } as Row;
    tracks.push(row);
    return row;
  };
  const mine = (rows: Row[]) => rows.filter((row) => row.user_id === USER.id);

  const upstream = (url: string): Response => {
    if (url.includes('/auth/v1/user')) return acceptingUpstream(url) as Response;
    if (failing.rest) return new Response('nope', { status: failing.restStatus });
    const { pathname, searchParams } = new URL(url);
    const table = pathname.split('/').pop();
    return json(runQuery(mine(table === 'tracks' ? tracks : folders), searchParams));
  };

  const updateTrackRoute = ({ trackId, updates, expectedVersion }: Record<string, never>) => {
    const row = mine(tracks).find((t) => t.id === trackId);
    if (!row) return json({ error: 'Track not found' }, 404);
    const { name, folder } = updates as { name?: string; folder?: string | null };
    if (name !== undefined || folder !== undefined) {
      const siblings = mine(tracks) as unknown as Parameters<typeof trackNameClashes>[3];
      const inFolders = mine(folders) as unknown as Parameters<typeof trackNameClashes>[4];
      if (folder && !mine(folders).some((f) => f.id === folder || f.path === folder)) {
        return json({ error: 'Folder not found or access denied' }, 400);
      }
      const target = folder !== undefined ? folder : (row.folder as string | null);
      if (trackNameClashes(name ?? (row.name as string), target, trackId, siblings, inFolders)) {
        return json({ error: 'A track with that name already exists here', code: 'duplicate' }, 409);
      }
    }
    // As the real route: with no version the write is unconditional.
    if (expectedVersion !== undefined && row.updated_at !== expectedVersion) {
      return json({ error: 'changed', code: 'version_conflict', current: { version: row.updated_at } }, 409);
    }
    const { code, steps, isMultitrack, activeStep } = updates as Record<string, unknown>;
    if (name !== undefined) row.name = name;
    if (folder !== undefined) row.folder = folder;
    if (code !== undefined) row.code = code;
    if (steps !== undefined) row.steps = steps;
    if (isMultitrack !== undefined) row.is_multitrack = isMultitrack;
    if (activeStep !== undefined) row.active_step = activeStep;
    row.updated_at = nextVersion();
    return json({ success: true, track: row });
  };

  const site = async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    const body = (await request.json()) as Record<string, never>;
    siteCalls.push({ method: request.method, path: pathname, body });
    if (failing.site) throw new Error('binding down');
    if (failing.siteStatus) return json({ error: 'said no' }, failing.siteStatus);
    hooks.beforeRoute?.();
    switch (`${request.method} ${pathname}`) {
      case 'PUT /api/tracks/update':
        return updateTrackRoute(body);
      case 'POST /api/tracks/create': {
        const { name, code, folder, isMultitrack, steps, activeStep } = body as Record<string, unknown>;
        const row = addTrack({
          id: `track-${clock}`,
          name: name as string,
          code: code as string,
          folder,
          is_multitrack: Boolean(isMultitrack),
          steps,
          active_step: activeStep ?? null,
        });
        return json({ success: true, track: { ...row, version: row.updated_at } }, 201);
      }
      case 'DELETE /api/tracks/delete': {
        const row = mine(tracks).find((t) => t.id === body.trackId);
        if (!row) return json({ error: 'Track not found' }, 404);
        if (row.updated_at !== body.expectedVersion) {
          return json({ code: 'version_conflict', current: { version: row.updated_at } }, 409);
        }
        tracks.splice(tracks.indexOf(row), 1);
        return json({ success: true });
      }
      case 'POST /api/folders/create': {
        const { id, name, parent } = body as Record<string, string | null>;
        if (mine(folders).some((f) => f.name === name && (f.parent ?? null) === (parent ?? null))) {
          return json({ error: 'taken', code: 'duplicate' }, 409);
        }
        return json({ data: addFolder({ id: id as string, name: name as string, parent }) });
      }
      case 'PUT /api/folders/update': {
        const row = mine(folders).find((f) => f.id === body.folderId);
        if (!row) return json({ error: 'Folder not found or access denied' }, 404);
        if (row.updated_at !== body.expectedVersion) {
          return json({ code: 'version_conflict', current: { version: row.updated_at } }, 409);
        }
        Object.assign(row, body.updates, { updated_at: nextVersion() });
        return json({ success: true, folder: row });
      }
      case 'DELETE /api/folders/delete': {
        const row = mine(folders).find((f) => f.id === body.folderId);
        if (!row) return json({ error: 'Folder not found' }, 404);
        if (row.updated_at !== body.expectedVersion) {
          return json({ code: 'version_conflict', current: { version: row.updated_at } }, 409);
        }
        const held = mine(tracks).filter((t) => t.folder === row.id || t.folder === row.path);
        if (held.length) {
          return json(
            {
              code: 'folder_not_empty',
              contents: { folderCount: 0, trackCount: held.length, folders: [], tracks: held.map((t) => t.name) },
            },
            409,
          );
        }
        folders.splice(folders.indexOf(row), 1);
        return json({ success: true });
      }
    }
    return json({ error: `no such route: ${request.method} ${pathname}` }, 404);
  };

  return { tracks, folders, siteCalls, failing, hooks, addFolder, addTrack, upstream, site };
}

export type FakeLibrary = ReturnType<typeof fakeLibrary>;

export interface ToolAnswer {
  isError?: boolean;
  structured: Record<string, never>;
  error: Record<string, never>;
  text: string;
}

/** Calls tools the way an assistant does, through the whole handler. */
export function toolCaller(library: FakeLibrary, overrides: Partial<Env> = {}, deps: Partial<Deps> = {}) {
  const w = worker(library.upstream, overrides, { site: library.site, ...deps });
  const call = async (name: string, args: unknown = {}): Promise<ToolAnswer> => {
    const response = await w.fetch(
      MCP_URL,
      post(rpcBody('tools/call', { name, arguments: args }), withToken(assistantToken())),
    );
    const { result } = (await response.json()) as {
      result: { isError?: boolean; structuredContent: Record<string, never>; content: Array<{ text: string }> };
    };
    const text = result.content[0].text;
    return {
      isError: result.isError,
      structured: result.structuredContent,
      error: result.isError ? JSON.parse(text) : {},
      text,
    };
  };
  return { ...w, call };
}
