/**
 * Text shown for set items (spec 022 §2.2): the track (and step) name, and the transition as
 * "Default" or "<Type> · <length>".
 */
import type { SetItem, SetItemTransition } from '@src/lib/setLists';
import { transitionTypeLabelKey } from '../../transitionSettings';
import { itemLabel, type LibraryTrack } from '../../sets/resolveItem';

type T = (key: string, options?: Record<string, unknown>) => string;

/** "Default", or e.g. "Crossfade · 8". `t` is bound to the `settings` namespace. */
export function transitionText(t: T, transition: SetItemTransition | null): string {
  if (!transition) return t('setListTransitionDefault');
  return `${t(transitionTypeLabelKey(transition.type))} · ${transition.length}`;
}

/** "Track", "Multitrack · Step", or null when the item is Missing. */
export function itemText(item: SetItem, tracks: Record<string, LibraryTrack | undefined>): string | null {
  const label = itemLabel(item, tracks);
  if (!label) return null;
  return label.stepName === undefined ? label.trackName : `${label.trackName} · ${label.stepName}`;
}

/** The text for an item id in a set, or the Missing word. */
export function itemTextById(
  t: T,
  items: readonly SetItem[] | undefined,
  itemId: string | null,
  tracks: Record<string, LibraryTrack | undefined>,
): string {
  const item = itemId ? items?.find((candidate) => candidate.id === itemId) : undefined;
  if (!item) return '—';
  return itemText(item, tracks) ?? t('setListMissing');
}
