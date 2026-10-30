/**
 * Renaming a folder: the rules and the cascade, shared by the client (sidebar) and the
 * server (`/api/folders/update`) so both compute the same new paths.
 *
 * Data facts this works with:
 * - folders carry `id`, `name`, `path` ("parent/child" names, raw, not slugged) and `parent`
 *   (a folder id; the parent's PATH on rows created from the sidebar context menu before
 *   2026-10-30; null/undefined/'' at the root) — always read it through `resolveParentId`;
 * - `tracks.folder` is mixed: a folder id (most rows), a raw folder path (older rows) or null.
 *   Tracks holding an id need no change on rename; tracks holding a renamed path string do.
 */
import { generateTrackUrlPath, findTrackByFolderAndSlug, parseTrackUrlPath, trackNameToSlug } from './slugUtils';

export interface RenamableFolder {
  id: string;
  name: string;
  path: string;
  parent?: string | null;
}

export interface RenamableTrack {
  id: string;
  name: string;
  folder?: string | null;
}

export type FolderRenameError = 'notFound' | 'empty' | 'slash' | 'duplicate';

export interface FolderPathChange {
  id: string;
  oldPath: string;
  newPath: string;
  /**
   * Set when the stored `parent` held the parent's path: it is rewritten to the parent's id, or
   * the folder would lose its parent once that path changes.
   */
  parentFix?: { oldParent: string; newParent: string };
}

export interface FolderRenamePlan {
  folderId: string;
  oldName: string;
  newName: string;
  /** The renamed folder first, then its descendants (parents before children). */
  pathChanges: FolderPathChange[];
  /** Raw path strings held in `tracks.folder` that must be rewritten old → new. */
  trackFolderRemaps: Array<{ oldPath: string; newPath: string }>;
  /** Set when the folder moves to another parent (drag and drop); absent for a plain rename. */
  parentChange?: { oldParent: string | null; newParent: string | null };
}

export type FolderRenameResult = { ok: true; plan: FolderRenamePlan } | { ok: false; error: FolderRenameError };

/** What `trackNameToSlug` returns for a name with no Latin letters or digits. */
const UNSLUGGABLE = 'untitled';

const parentKey = (parent: string | null | undefined): string | null => (parent ? parent : null);

/**
 * The id of a folder's parent, or null at the root. `parent` holds an id, or (older rows) the
 * parent's path; a value matching neither is returned as is (an orphan).
 */
export function resolveParentId(folder: RenamableFolder, folders: RenamableFolder[]): string | null {
  const raw = parentKey(folder.parent);
  if (!raw || folders.some((f) => f.id === raw)) return raw;
  return folders.find((f) => f.path === raw)?.id ?? raw;
}

/**
 * Find a folder by its id or by its path. The sidebar tree identifies folders by path,
 * while the folders map is keyed by id, so both must resolve.
 */
export function findFolderByPathOrId<F extends RenamableFolder>(
  folders: Record<string, F> | F[],
  key: string | null | undefined,
): F | undefined {
  if (!key) return undefined;
  const list = Array.isArray(folders) ? folders : Object.values(folders);
  return list.find((f) => f.id === key) ?? list.find((f) => f.path === key);
}

/**
 * Check a new folder name: not empty, no "/" (it is the path separator), and no sibling
 * (same parent) with the same name (trimmed, case-insensitive) or whose name slugs the same —
 * two such folders would share one URL.
 *
 * The slug comparison only counts real slugs: `trackNameToSlug` turns every non-Latin or
 * symbol-only name into 'untitled', and "Ударные" next to "Бас" is not a clash.
 */
export function validateFolderName(
  rawName: string,
  folder: RenamableFolder,
  folders: RenamableFolder[],
): FolderRenameError | null {
  const name = rawName.trim();
  if (!name) return 'empty';
  if (name.includes('/')) return 'slash';
  const lower = name.toLowerCase();
  const slug = trackNameToSlug(name);
  const clash = folders.some((f) => {
    if (f.id === folder.id || resolveParentId(f, folders) !== resolveParentId(folder, folders)) return false;
    const other = (f.name ?? '').trim();
    if (other.toLowerCase() === lower) return true;
    const otherSlug = trackNameToSlug(other);
    return slug !== UNSLUGGABLE && otherSlug !== UNSLUGGABLE && otherSlug === slug;
  });
  return clash ? 'duplicate' : null;
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : '';
}

/**
 * Plan a folder rename. The new path is built from the parent folder's path (never taken
 * from the caller); descendants (found through `parent` ids) get their paths rebuilt below it.
 */
export function planFolderRename(folders: RenamableFolder[], folderId: string, rawName: string): FolderRenameResult {
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return { ok: false, error: 'notFound' };

  const error = validateFolderName(rawName, folder, folders);
  if (error) return { ok: false, error };

  return { ok: true, plan: planPaths(folders, folder, rawName.trim()) };
}

/** Rebuild the paths of `folder` (renamed to `newName`, under its current `parent`) and its descendants. */
function planPaths(folders: RenamableFolder[], folder: RenamableFolder, newName: string): FolderRenamePlan {
  const parentIdOf = new Map(folders.map((f) => [f.id, resolveParentId(f, folders)]));
  // A `parent` holding a path is rewritten to the id it resolves to.
  const parentFix = (f: RenamableFolder): Pick<FolderPathChange, 'parentFix'> => {
    const raw = parentKey(f.parent);
    const id = parentIdOf.get(f.id) ?? null;
    return raw && id && raw !== id && folders.some((o) => o.id === id)
      ? { parentFix: { oldParent: raw, newParent: id } }
      : {};
  };

  const parentId = parentIdOf.get(folder.id) ?? null;
  const parent = parentId ? folders.find((f) => f.id === parentId) : undefined;
  // An orphan (parent not found) keeps the directory part of its own stored path.
  const parentPath = parent ? parent.path : folder.parent ? dirname(folder.path) : '';
  const newPath = parentPath ? `${parentPath}/${newName}` : newName;

  const pathChanges: FolderPathChange[] = [{ id: folder.id, oldPath: folder.path, newPath, ...parentFix(folder) }];
  const newPathById = new Map<string, string>([[folder.id, newPath]]);
  const queue = [folder.id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of folders) {
      if (parentIdOf.get(child.id) !== current || newPathById.has(child.id)) continue;
      const childPath = `${newPathById.get(current)}/${child.name}`;
      newPathById.set(child.id, childPath);
      pathChanges.push({ id: child.id, oldPath: child.path, newPath: childPath, ...parentFix(child) });
      queue.push(child.id);
    }
  }

  // A path string still held by a folder that is NOT being renamed is ambiguous; leave
  // tracks carrying it alone rather than move them into the renamed folder.
  const untouchedPaths = new Set(folders.filter((f) => !newPathById.has(f.id)).map((f) => f.path));
  const seen = new Set<string>();
  const trackFolderRemaps = pathChanges
    .filter((c) => c.oldPath && c.oldPath !== c.newPath && !untouchedPaths.has(c.oldPath))
    .filter((c) => (seen.has(c.oldPath) ? false : (seen.add(c.oldPath), true)))
    .map(({ oldPath, newPath: np }) => ({ oldPath, newPath: np }));

  return { folderId: folder.id, oldName: folder.name, newName, pathChanges, trackFolderRemaps };
}

/**
 * Plan moving a folder under `newParent` (a folder id, or null for the root): its path, its
 * descendants' paths and path-holding tracks are rebuilt as for a rename. The name is kept
 * exactly as stored (older rows may hold "/" or surrounding spaces); only a clash with a
 * folder already under the new parent is refused.
 */
export function planFolderMove(
  folders: RenamableFolder[],
  folderId: string,
  newParent: string | null,
): FolderRenameResult {
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return { ok: false, error: 'notFound' };
  const parent = parentKey(newParent);
  const movedFolder = { ...folder, parent };
  const moved = folders.map((f) => (f.id === folderId ? movedFolder : f));
  if (
    parent !== resolveParentId(folder, folders) &&
    validateFolderName(folder.name, movedFolder, moved) === 'duplicate'
  ) {
    return { ok: false, error: 'duplicate' };
  }
  const plan = planPaths(moved, movedFolder, folder.name);
  return { ok: true, plan: { ...plan, parentChange: { oldParent: parentKey(folder.parent), newParent: parent } } };
}

/**
 * Apply a plan to an id-keyed folders map. Only `name`, `path` and (for a move) `parent`
 * change; the map stays id-keyed.
 */
export function applyRenameToFolders<F extends RenamableFolder>(
  folders: Record<string, F>,
  plan: FolderRenamePlan,
): Record<string, F> {
  const next = { ...folders };
  for (const change of plan.pathChanges) {
    const key = Object.prototype.hasOwnProperty.call(next, change.id)
      ? change.id
      : Object.keys(next).find((k) => next[k].id === change.id);
    if (!key) continue;
    next[key] = {
      ...next[key],
      path: change.newPath,
      ...(change.id === plan.folderId ? { name: plan.newName } : {}),
      ...(change.parentFix ? { parent: change.parentFix.newParent } : {}),
      ...(change.id === plan.folderId && plan.parentChange ? { parent: plan.parentChange.newParent } : {}),
    };
  }
  return next;
}

/** Ids of tracks whose `folder` holds a path string the plan rewrites. */
export function tracksToRemap<T extends RenamableTrack>(
  tracks: Record<string, T>,
  plan: FolderRenamePlan,
): Array<{ trackId: string; oldFolder: string; newFolder: string }> {
  const remap = new Map(plan.trackFolderRemaps.map((r) => [r.oldPath, r.newPath]));
  return Object.values(tracks)
    .filter((t) => t.folder && remap.has(t.folder))
    .map((t) => ({ trackId: t.id, oldFolder: t.folder as string, newFolder: remap.get(t.folder as string)! }));
}

/** Apply a plan to an id-keyed tracks map. Only `folder` changes on the affected tracks. */
export function applyRenameToTracks<T extends RenamableTrack>(
  tracks: Record<string, T>,
  plan: FolderRenamePlan,
): Record<string, T> {
  const changes = tracksToRemap(tracks, plan);
  if (!changes.length) return tracks;
  const next = { ...tracks };
  for (const c of changes) next[c.trackId] = { ...next[c.trackId], folder: c.newFolder };
  return next;
}

/**
 * The URL the open track must move to after a rename, or null when the track the URL points
 * at does not live in the renamed folder (or a descendant). Keeps the query (e.g. `?step=`).
 *
 * The autosave guard resolves the open track from the URL, so a stale folder slug would make
 * it stop saving — the caller must `history.replaceState` to this URL.
 */
export function renamedTrackUrl<T extends RenamableTrack, F extends RenamableFolder>(
  location: { pathname: string; search?: string },
  before: { tracks: Record<string, T>; folders: Record<string, F> },
  after: { tracks: Record<string, T>; folders: Record<string, F> },
  plan: FolderRenamePlan,
): string | null {
  const parsed = parseTrackUrlPath(location.pathname);
  if (!parsed || !parsed.folderPath) return null;

  const openTrack = findTrackByFolderAndSlug(
    Object.values(before.tracks),
    parsed.folderPath,
    parsed.trackSlug,
    Object.values(before.folders),
  );
  if (!openTrack) return null;

  const renamedIds = new Set(plan.pathChanges.map((c) => c.id));
  const folderValue = openTrack.folder ?? '';
  const affected = renamedIds.has(folderValue) || plan.trackFolderRemaps.some((r) => r.oldPath === folderValue);
  if (!affected) return null;

  const track = after.tracks[openTrack.id] ?? openTrack;
  const foldersById = Object.fromEntries(Object.values(after.folders).map((f) => [f.id, f]));
  const newPath = generateTrackUrlPath(track.name, track.folder, foldersById);
  const url = `${newPath}${location.search ?? ''}`;
  return newPath === location.pathname ? null : url;
}

/** The plan that undoes `plan` (used to revert the client state when the server refuses). */
export function invertFolderRenamePlan(plan: FolderRenamePlan): FolderRenamePlan {
  return {
    folderId: plan.folderId,
    oldName: plan.newName,
    newName: plan.oldName,
    pathChanges: plan.pathChanges.map((c) => ({
      id: c.id,
      oldPath: c.newPath,
      newPath: c.oldPath,
      ...(c.parentFix ? { parentFix: { oldParent: c.parentFix.newParent, newParent: c.parentFix.oldParent } } : {}),
    })),
    trackFolderRemaps: plan.trackFolderRemaps.map((r) => ({ oldPath: r.newPath, newPath: r.oldPath })),
    ...(plan.parentChange
      ? { parentChange: { oldParent: plan.parentChange.newParent, newParent: plan.parentChange.oldParent } }
      : {}),
  };
}

/** Would making `targetParentId` the parent of `folderId` create a cycle? (`parent` may hold ids or paths.) */
export function wouldCreateCycle(folders: RenamableFolder[], folderId: string, targetParentId: string | null): boolean {
  const parentOf = new Map(folders.map((f) => [f.id, resolveParentId(f, folders)]));
  let current: string | null = targetParentId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === folderId) return true;
    visited.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}
