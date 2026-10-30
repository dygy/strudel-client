import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { getAuthenticatedUser, AuthError } from '../_auth';
import { userClient } from '../_userClient';
import { readJsonObject, invalidDataResponse } from '../../../lib/apiBody';
import { resolveParentId, type RenamableFolder } from '../../../lib/folderRename';
import { trackNameToSlug } from '../../../lib/slugUtils';

export const prerender = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** What `trackNameToSlug` returns for a name with no letters or digits. */
const UNSLUGGABLE = 'untitled';

type ImportFolder = { path: string };
type ImportTrack = {
  name: string;
  code?: string;
  folder?: string | null;
  isMultitrack?: boolean;
  steps?: unknown[];
  activeStep?: number;
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Path segments, trimmed, with empty ones dropped ("/A//B/" → A, B: ZIP tools write odd paths);
 * null when nothing usable is left.
 */
function segmentsOf(path: unknown): string[] | null {
  if (typeof path !== 'string') return null;
  const segments = path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  return segments.length ? segments : null;
}

/** Check every item before anything is saved: a bad item must not leave half an import behind. */
function invalidItem(folders: unknown[], tracks: unknown[]): string | null {
  for (const [i, f] of folders.entries()) {
    if (!isObject(f) || !segmentsOf(f.path)) return `folders[${i}]`;
  }
  for (const [i, t] of tracks.entries()) {
    if (!isObject(t) || typeof t.name !== 'string' || !t.name.trim()) return `tracks[${i}]`;
    if (t.code !== undefined && typeof t.code !== 'string') return `tracks[${i}].code`;
    // Postgres text cannot hold NUL: a binary file in the ZIP would fail the whole insert.
    if (typeof t.code === 'string' && t.code.includes('\u0000')) return `tracks[${i}].code`;
    if (t.folder !== undefined && t.folder !== null && typeof t.folder !== 'string') return `tracks[${i}].folder`;
    if (t.steps !== undefined && t.steps !== null && !Array.isArray(t.steps)) return `tracks[${i}].steps`;
  }
  return null;
}

/**
 * POST /api/library/batch-import — `{ folders: [{ path }], tracks: [{ name, code?, folder?, … }] }`
 * (the ZIP import). Folders are placed by their path: missing ancestors are created, a folder
 * that already exists — by path, or as a sibling with the same name or URL slug — is reused, and
 * every new folder stores its parent's id. Tracks are stored with their folder's id and get a
 * " 2", " 3"… suffix rather than clash with a track already there (same name or URL slug).
 * Nothing is overwritten. Everything is validated before the first write, and the folders are
 * removed again if the tracks cannot be saved.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    // Sign-in is checked before the body is read (api/_auth.ts: Bearer header, then cookie).
    const { user, accessToken } = await getAuthenticatedUser(request);

    // Unparseable or non-object bodies, or a tracks/folders value that is not a list, are refused
    // with 400. A missing key still means "none" (an empty list).
    const body = await readJsonObject(request);
    if (!body) {
      return invalidDataResponse();
    }
    const { tracks = [], folders = [] } = body;
    if (!Array.isArray(tracks) || !Array.isArray(folders)) {
      return invalidDataResponse();
    }
    const bad = invalidItem(folders, tracks);
    if (bad) {
      return json({ error: 'Invalid import item', item: bad }, 400);
    }

    // As the user, so RLS applies; every query is also scoped by the session user's id.
    const supabase = userClient(accessToken);
    const [{ data: folderRows, error: foldersError }, { data: trackRows, error: tracksError }] = await Promise.all([
      supabase.from('folders').select('id, name, path, parent').eq('user_id', user.id),
      supabase.from('tracks').select('id, name, folder').eq('user_id', user.id),
    ]);
    if (foldersError || tracksError) {
      console.error('API /library/batch-import - failed to read the library:', foldersError ?? tracksError);
      return json({ error: 'Batch import failed' }, 500);
    }

    // ---- Folders ---------------------------------------------------------------------------
    const library = (folderRows ?? []) as RenamableFolder[];
    const originalIds = new Set(library.map((f) => f.id));
    const byId = new Map(library.map((f) => [f.id, f]));
    // Siblings by resolved parent id (null = root), built once: imports can be large.
    const childrenOf = new Map<string | null, RenamableFolder[]>();
    const addChild = (parentId: string | null, folder: RenamableFolder) => {
      const list = childrenOf.get(parentId);
      if (list) list.push(folder);
      else childrenOf.set(parentId, [folder]);
    };
    for (const f of library) addChild(resolveParentId(f, library), f);

    const newFolders: Array<RenamableFolder & { user_id: string; created: string }> = [];
    const idByImportPath = new Map<string, string>();
    const sameFolderName = (a: string, b: string) => {
      if (a.toLowerCase() === b.toLowerCase()) return true;
      const sa = trackNameToSlug(a);
      const sb = trackNameToSlug(b);
      return sa !== UNSLUGGABLE && sb !== UNSLUGGABLE && sa === sb;
    };

    /** The folder for these path segments: reused if it exists, created otherwise. */
    const ensureFolder = (segments: string[]): RenamableFolder => {
      const key = segments.join('/');
      const known = idByImportPath.get(key);
      if (known) return byId.get(known)!;

      // "Export all" used to name ZIP directories after the folder id: that is the folder itself.
      if (segments.length === 1 && originalIds.has(segments[0])) {
        idByImportPath.set(key, segments[0]);
        return byId.get(segments[0])!;
      }

      const parent = segments.length > 1 ? ensureFolder(segments.slice(0, -1)) : null;
      const name = segments[segments.length - 1];
      const sibling = (childrenOf.get(parent?.id ?? null) ?? []).find((f) =>
        sameFolderName((f.name ?? '').trim(), name),
      );
      let folder = sibling;
      if (!folder) {
        folder = { id: nanoid(), name, path: parent ? `${parent.path}/${name}` : name, parent: parent?.id ?? null };
        byId.set(folder.id, folder);
        addChild(parent?.id ?? null, folder);
        newFolders.push({ ...folder, user_id: user.id, created: new Date().toISOString() });
      }
      idByImportPath.set(key, folder.id);
      return folder;
    };
    for (const f of folders as ImportFolder[]) ensureFolder(segmentsOf(f.path)!);

    // ---- Tracks ----------------------------------------------------------------------------
    // A track's folder: an imported path, or an existing folder's id or path, becomes that
    // folder's id; any other value is kept as it is.
    const idByPath = new Map<string, string>();
    for (const f of byId.values()) if (!idByPath.has(f.path)) idByPath.set(f.path, f.id);
    const folderIdFor = (value: string | null | undefined): string | null => {
      if (!value || value === 'root') return null;
      const segments = segmentsOf(value);
      const imported = segments && idByImportPath.get(segments.join('/'));
      if (imported) return imported;
      if (byId.has(value)) return value;
      return idByPath.get(value) ?? value;
    };
    /** The folder a `tracks.folder` value points at, as its path ('' at the root) — see trackRename. */
    const folderKey = (value: string | null | undefined) =>
      !value || value === 'root' ? '' : (byId.get(value)?.path ?? value);

    // Taken names and URL slugs per folder: the same rule as trackNameClashes, indexed.
    const taken = new Map<string, { names: Set<string>; slugs: Set<string> }>();
    const takenIn = (key: string) => {
      let entry = taken.get(key);
      if (!entry) taken.set(key, (entry = { names: new Set(), slugs: new Set() }));
      return entry;
    };
    const take = (key: string, name: string) => {
      const entry = takenIn(key);
      entry.names.add(name.trim().toLowerCase());
      const slug = trackNameToSlug(name.trim());
      if (slug !== UNSLUGGABLE) entry.slugs.add(slug);
    };
    const isTaken = (key: string, name: string) => {
      const entry = takenIn(key);
      const slug = trackNameToSlug(name);
      return entry.names.has(name.toLowerCase()) || (slug !== UNSLUGGABLE && entry.slugs.has(slug));
    };
    for (const t of (trackRows ?? []) as Array<{ name: string; folder?: string | null }>) {
      if (typeof t.name === 'string') take(folderKey(t.folder), t.name);
    }

    const now = new Date().toISOString();
    const newTracks = (tracks as ImportTrack[]).map((track) => {
      const folder = folderIdFor(track.folder);
      const key = folderKey(folder);
      const base = track.name.trim();
      let name = base;
      for (let n = 2; isTaken(key, name); n++) name = `${base} ${n}`;
      take(key, name);
      return {
        id: nanoid(), // always a new track: an import never overwrites
        user_id: user.id,
        name,
        code: track.code ?? '',
        created: now,
        modified: now,
        folder,
        is_multitrack: track.isMultitrack === true,
        steps: Array.isArray(track.steps) ? track.steps : [],
        active_step: Number.isInteger(track.activeStep) ? track.activeStep : 0,
      };
    });

    // ---- Write -----------------------------------------------------------------------------
    // Parents come before children in `newFolders` (ensureFolder creates ancestors first).
    if (newFolders.length) {
      const { error } = await supabase.from('folders').insert(newFolders).select('id');
      if (error) {
        console.error('API /library/batch-import - creating folders failed:', error);
        return json({ error: 'Batch import failed' }, 500);
      }
    }
    if (newTracks.length) {
      const { error } = await supabase.from('tracks').insert(newTracks).select('id');
      if (error) {
        console.error('API /library/batch-import - creating tracks failed:', error);
        // The insert may have committed even though its answer was lost: never remove folders
        // that saved tracks point at.
        const { data: saved, error: checkError } = await supabase
          .from('tracks')
          .select('id')
          .eq('user_id', user.id)
          .in(
            'id',
            newTracks.map((t) => t.id),
          );
        if (!checkError && (saved ?? []).length === newTracks.length) {
          return json(
            {
              success: true,
              results: {
                tracksCreated: newTracks.length,
                foldersCreated: newFolders.length,
                totalCreated: newTracks.length + newFolders.length,
                errors: [],
              },
            },
            200,
          );
        }
        // Leave the library as it was: remove the folders this import created (never reused ones).
        if (newFolders.length && !checkError && (saved ?? []).length === 0) {
          const { error: undoError } = await supabase
            .from('folders')
            .delete()
            .eq('user_id', user.id)
            .in(
              'id',
              newFolders.map((f) => f.id),
            );
          if (undoError) console.error('API /library/batch-import - removing the new folders failed:', undoError);
        }
        return json({ error: 'Batch import failed' }, 500);
      }
    }

    return json(
      {
        success: true,
        results: {
          tracksCreated: newTracks.length,
          foldersCreated: newFolders.length,
          totalCreated: newTracks.length + newFolders.length,
          errors: [],
        },
      },
      200,
    );
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return json({ error: 'Not authenticated' }, 401);
    }
    console.error('API /library/batch-import - unexpected error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
};
