/** Reading the library (spec 018, functional 2.3): plain fetch to Supabase REST, as the user. */
import { hasSteps, reconcileMultitrack, type StepLike } from '../../../website/src/lib/multitrack';
import { generateTrackUrlPath } from '../../../website/src/lib/slugUtils';
import { fail, ok, rest, ToolFailure, type ToolContext, type ToolResult } from './context';

export const PAGE_SIZE = 50;
/** The name a step of old edits gets, as in the app (lib/multitrack.ts). */
export const RECOVERED_STEP_NAME = 'Recovered edits';

export interface FolderRow {
  id: string;
  name: string;
  path: string;
  parent: string | null;
  updated_at: string;
}

export interface TrackRow {
  id: string;
  name: string;
  code: string;
  folder: string | null;
  is_multitrack: boolean | null;
  steps: StepLike[] | null;
  active_step: number | null;
  modified: string;
  created: string;
  updated_at: string;
}

const encodeCursor = (parts: string[]) => btoa(encodeURIComponent(JSON.stringify(parts)));

function decodeCursor(cursor: string, size: number): string[] {
  try {
    const parts = JSON.parse(decodeURIComponent(atob(cursor))) as unknown;
    if (Array.isArray(parts) && parts.length === size && parts.every((part) => typeof part === 'string')) {
      return parts as string[];
    }
  } catch {
    // Falls through to the refusal.
  }
  throw new ToolFailure(fail('invalid_arguments', 'That cursor is not valid.', 'Start again without a cursor.'));
}

/** A value inside a PostgREST `or=(...)`: quoted, so commas and brackets in it mean nothing. */
const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
/** `%` and `_` mean something to LIKE. PostgREST's `*` can't be escaped, so it stays a wildcard. */
const likeEscaped = (value: string) => value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

export const allFolders = (ctx: ToolContext) =>
  rest<FolderRow>(ctx, 'folders', {
    select: 'id,name,path,parent,updated_at',
    user_id: `eq.${ctx.identity.userId}`,
    order: 'id.asc',
  });

/**
 * Where a track opens. The folder goes in as a path: `generateTrackUrlPath` logs when it has to turn an
 * id into one itself, and a folder's name doesn't belong in the logs.
 */
export function webAddress(ctx: ToolContext, name: string, folder: string | null, folders: FolderRow[]) {
  const path = folders.find((f) => f.id === folder)?.path ?? folder;
  return `${ctx.origin}${generateTrackUrlPath(name, path)}`;
}

/** A PostgREST condition for what's in a folder: `tracks.folder` holds an id or, on older rows, a path. */
export const inFolder = (folder: FolderRow | null) =>
  folder
    ? `or(folder.eq.${quoted(folder.id)},folder.eq.${quoted(folder.path)})`
    : 'or(folder.is.null,folder.eq.root,folder.eq."")';

export async function readTrackRow(ctx: ToolContext, trackId: string): Promise<TrackRow> {
  const [row] = await rest<TrackRow>(ctx, 'tracks', {
    select: 'id,name,code,folder,is_multitrack,steps,active_step,modified,created,updated_at',
    id: `eq.${trackId}`,
    user_id: `eq.${ctx.identity.userId}`,
  });
  // The same answer whether it never existed or belongs to someone else: RLS shows neither.
  if (!row) throw new ToolFailure(fail('not_found', 'Track not found'));
  return row;
}

/** A row as the app shows it: `steps` is the truth, and old edits found only in `code` are a step. */
export function reconciled(row: TrackRow) {
  return reconcileMultitrack(
    {
      id: row.id,
      code: row.code ?? '',
      isMultitrack: Boolean(row.is_multitrack),
      steps: row.steps ?? [],
      activeStep: row.active_step ?? 0,
    },
    RECOVERED_STEP_NAME,
  );
}

/** The steps that count: a row not marked multitrack is a plain track, whatever is left in `steps`. */
export const trackSteps = (track: Parameters<typeof hasSteps>[0]): StepLike[] => (hasSteps(track) ? track.steps! : []);

/**
 * What to call a step by. Older rows can hold steps with no id, or the same id twice, so those go by
 * position (`#2`), which can't be wrong while a change has to name the version it read.
 */
export function stepRef(steps: StepLike[], index: number): string {
  const { id } = steps[index];
  return id && steps.filter((step) => step.id === id).length === 1 ? id : `#${index}`;
}

export async function listFolders(ctx: ToolContext, args: { cursor?: string }): Promise<ToolResult> {
  const after = args.cursor ? decodeCursor(args.cursor, 1)[0] : null;
  const rows = await rest<FolderRow>(ctx, 'folders', {
    select: 'id,name,path,parent,updated_at',
    user_id: `eq.${ctx.identity.userId}`,
    order: 'id.asc',
    limit: String(PAGE_SIZE + 1),
    ...(after ? { id: `gt.${after}` } : {}),
  });
  const page = rows.slice(0, PAGE_SIZE);
  return ok({
    folders: page.map((folder) => ({
      id: folder.id,
      name: folder.name,
      path: folder.path,
      parent: folder.parent,
      version: folder.updated_at,
    })),
    nextCursor: rows.length > PAGE_SIZE ? encodeCursor([page[page.length - 1].id]) : null,
  });
}

export async function searchTracks(
  ctx: ToolContext,
  args: { query?: string; folder?: string; cursor?: string },
): Promise<ToolResult> {
  const folders = await allFolders(ctx);
  const conditions: string[] = [];
  if (args.query) {
    const pattern = quoted(`*${likeEscaped(args.query)}*`);
    conditions.push(`or(name.ilike.${pattern},code.ilike.${pattern})`);
  }
  if (args.folder === 'root') {
    conditions.push(inFolder(null));
  } else if (args.folder) {
    const folder = folders.find((f) => f.id === args.folder);
    if (!folder) return fail('not_found', 'Folder not found');
    conditions.push(inFolder(folder));
  }
  if (args.cursor) {
    // Keyset paging, so each row comes once however the pages fall.
    const [modified, id] = decodeCursor(args.cursor, 2);
    conditions.push(`or(modified.lt.${quoted(modified)},and(modified.eq.${quoted(modified)},id.lt.${quoted(id)}))`);
  }
  const rows = await rest<TrackRow>(ctx, 'tracks', {
    // No `code`: a page of 50 stays cheap to parse.
    select: 'id,name,folder,is_multitrack,modified,updated_at',
    user_id: `eq.${ctx.identity.userId}`,
    order: 'modified.desc,id.desc',
    limit: String(PAGE_SIZE + 1),
    ...(conditions.length ? { and: `(${conditions.join(',')})` } : {}),
  });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return ok({
    tracks: page.map((track) => ({
      id: track.id,
      name: track.name,
      folder: track.folder,
      isMultitrack: Boolean(track.is_multitrack),
      modified: track.modified,
      version: track.updated_at,
      webAddress: webAddress(ctx, track.name, track.folder, folders),
    })),
    nextCursor: rows.length > PAGE_SIZE ? encodeCursor([last.modified, last.id]) : null,
  });
}

export async function getTrack(ctx: ToolContext, args: { trackId: string }): Promise<ToolResult> {
  const [row, folders] = await Promise.all([readTrackRow(ctx, args.trackId), allFolders(ctx)]);
  const track = reconciled(row);
  return ok({
    id: row.id,
    name: row.name,
    folder: row.folder,
    code: track.code,
    isMultitrack: Boolean(track.isMultitrack),
    activeStep: track.activeStep ?? 0,
    steps: trackSteps(track).map((step, i, all) => ({
      ref: stepRef(all, i),
      id: step.id ?? null,
      name: step.name ?? '',
      code: step.code ?? '',
    })),
    modified: row.modified,
    version: row.updated_at,
    webAddress: webAddress(ctx, row.name, row.folder, folders),
  });
}
