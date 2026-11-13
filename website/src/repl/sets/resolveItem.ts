/**
 * A set item → the library track (and step) it plays, or Missing (spec 022 §2.5, tech §2.1).
 *
 * The track is found by id, which a rename or a move doesn't change, so the item follows it and the
 * name shown is always the live one. Step ids aren't reliable (they can repeat), so a step is found:
 * 1. by `stepId`, when exactly one step has it;
 * 2. by `stepName` slug (several matches: the one at `stepIndex` if it is among them, else the first);
 * otherwise the item is Missing. `stepIndex` alone never picks a step whose name no longer matches.
 */
import type { SetItem } from '../../lib/setLists';
import { trackNameToSlug } from '../../lib/slugUtils';

export interface LibraryStep {
  id?: string;
  name?: string;
}

export interface LibraryTrack {
  id: string;
  name: string;
  folder?: string | null;
  isMultitrack?: boolean;
  steps?: LibraryStep[] | null;
}

export type ResolvedItem<T extends LibraryTrack = LibraryTrack> =
  | { status: 'ok'; track: T; stepIndex?: number }
  | { status: 'missing' };

/** Whether the item points at a multitrack step rather than a whole track. */
export const isStepItem = (item: SetItem): boolean =>
  item.stepId !== undefined || item.stepName !== undefined || item.stepIndex !== undefined;

function findStep(item: SetItem, steps: LibraryStep[]): number | null {
  if (item.stepId !== undefined) {
    const byId = steps.flatMap((step, index) => (step.id === item.stepId ? [index] : []));
    if (byId.length === 1) return byId[0];
  }
  if (item.stepName !== undefined) {
    const wanted = trackNameToSlug(item.stepName);
    const byName = steps.flatMap((step, index) => (trackNameToSlug(step.name ?? '') === wanted ? [index] : []));
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
      return item.stepIndex !== undefined && byName.includes(item.stepIndex) ? item.stepIndex : byName[0];
    }
  }
  return null;
}

/** Resolve `item` against the library's loaded tracks (keyed by id). */
export function resolveItem<T extends LibraryTrack>(
  item: SetItem,
  tracks: Record<string, T | undefined>,
): ResolvedItem<T> {
  const track = tracks[item.trackId];
  if (!track) return { status: 'missing' };
  if (!isStepItem(item)) return { status: 'ok', track };
  const steps = track.isMultitrack && Array.isArray(track.steps) ? track.steps : [];
  const stepIndex = findStep(item, steps);
  return stepIndex === null ? { status: 'missing' } : { status: 'ok', track, stepIndex };
}

/** What an item shows: the track's name, and for a step the step's name too. Null when Missing. */
export function itemLabel(
  item: SetItem,
  tracks: Record<string, LibraryTrack | undefined>,
): { trackName: string; stepName?: string } | null {
  const resolved = resolveItem(item, tracks);
  if (resolved.status === 'missing') return null;
  if (resolved.stepIndex === undefined) return { trackName: resolved.track.name };
  return { trackName: resolved.track.name, stepName: resolved.track.steps?.[resolved.stepIndex]?.name ?? '' };
}
