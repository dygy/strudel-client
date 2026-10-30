/**
 * Renaming or moving a track: the sibling-name rule and the URL the open track moves to, shared by
 * the client (sidebar) and the server (`/api/tracks/update`).
 *
 * `tracks.folder` is mixed: a folder id (most rows), a raw folder path (older rows) or null/'root'
 * at the root, so two tracks are siblings when their folder values resolve to the same folder.
 */
import { findTrackByFolderAndSlug, generateTrackUrlPath, parseTrackUrlPath, trackNameToSlug } from './slugUtils';

export interface NamedTrack {
  id: string;
  name: string;
  folder?: string | null;
}

export interface PathedFolder {
  id: string;
  name: string;
  path: string;
}

/** What `trackNameToSlug` returns for a name with no letters or digits. */
const UNSLUGGABLE = 'untitled';

/** The folder a `tracks.folder` value points at, as its path ('' for the root). */
export function resolveTrackFolder(folder: string | null | undefined, folders: PathedFolder[]): string {
  if (!folder || folder === 'root') return '';
  return folders.find((f) => f.id === folder)?.path ?? folder;
}

/**
 * Would `name` clash with another track in `folder`? Same trimmed name (case-insensitive), or the
 * same real slug: two such tracks would share one URL, and the URL picks the track autosave
 * writes to. Names with no letters or digits ('untitled') only clash by name.
 */
export function trackNameClashes(
  name: string,
  folder: string | null | undefined,
  trackId: string,
  tracks: NamedTrack[],
  folders: PathedFolder[],
): boolean {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  const slug = trackNameToSlug(trimmed);
  const target = resolveTrackFolder(folder, folders);
  return tracks.some((t) => {
    if (t.id === trackId || resolveTrackFolder(t.folder, folders) !== target) return false;
    const other = (t.name ?? '').trim();
    if (other.toLowerCase() === lower) return true;
    const otherSlug = trackNameToSlug(other);
    return slug !== UNSLUGGABLE && otherSlug !== UNSLUGGABLE && otherSlug === slug;
  });
}

/**
 * The URL to move to when `trackId` gets `next` name/folder, or null when the URL does not point
 * at that track or would not change. Keeps the query (e.g. `?step=`).
 *
 * The autosave guard resolves the open track from the URL, so a stale slug makes it stop saving:
 * the caller must `history.replaceState` to this URL.
 */
export function followedTrackUrl(
  location: { pathname: string; search?: string },
  tracks: NamedTrack[],
  folders: PathedFolder[],
  trackId: string,
  next: { name: string; folder?: string | null },
): string | null {
  const parsed = parseTrackUrlPath(location.pathname);
  if (!parsed) return null;
  const open = findTrackByFolderAndSlug(tracks, parsed.folderPath, parsed.trackSlug, folders);
  if (!open || open.id !== trackId) return null;

  const foldersById = Object.fromEntries(folders.map((f) => [f.id, f]));
  const newPath = generateTrackUrlPath(next.name, next.folder, foldersById);
  return newPath === location.pathname ? null : `${newPath}${location.search ?? ''}`;
}
