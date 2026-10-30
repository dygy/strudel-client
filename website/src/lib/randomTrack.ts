/**
 * The track `/repl` opens when no track is named (spec 005): a random one, chosen only among
 * tracks whose URL leads back to them.
 */
import { findTrackByFolderAndSlug, generateTrackUrlPath, parseTrackUrlPath, trackNameToSlug } from './slugUtils';

export interface RandomTrackCandidate {
  id: string;
  name: string;
  folder?: string | null;
  isMultitrack?: boolean;
  steps?: Array<{ name: string }> | null;
}

/**
 * The URL of a random track, or null when no track's URL resolves back to it.
 *
 * The REPL page redirects to this URL and then looks the track up by it. A track whose URL finds
 * nothing (its folder value points at no folder, say) would send the page to another random
 * track on every load, a redirect loop; such tracks are skipped. A multitrack gets its first step.
 */
export function randomTrackUrl<T extends RandomTrackCandidate>(
  tracks: T[],
  folders: Array<{ id: string; path: string; name: string }>,
  random: () => number = Math.random,
): string | null {
  const foldersMap = Object.fromEntries(folders.map((f) => [f.id, f]));
  const candidates = tracks.slice();
  while (candidates.length) {
    const [track] = candidates.splice(Math.floor(random() * candidates.length), 1);
    const path = generateTrackUrlPath(track.name, track.folder, foldersMap);
    const parsed = parseTrackUrlPath(path);
    const found = parsed && findTrackByFolderAndSlug(tracks, parsed.folderPath, parsed.trackSlug, folders);
    if (!found) continue;
    // A slug twin answers for this URL: open the track that URL really opens, so the editor and
    // autosave agree on it.
    const opened = found as T;
    const firstStep = opened.isMultitrack ? opened.steps?.[0] : undefined;
    return firstStep ? `${path}?step=${trackNameToSlug(firstStep.name)}` : path;
  }
  return null;
}
