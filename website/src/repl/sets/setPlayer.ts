/**
 * The set player (spec 022 §2.3, tech §2.3): what Cue, Go, cancel, select and end do, as pure
 * functions over a small state. No audio and no React here; `useSetPlayer` runs the side effects
 * (open the track, preview, push to the speakers) and reports back with the *Landed / *Failed calls.
 *
 * - `idle`: a set is playing (or not: `setId === null`) and nothing is cued. The next press Cues.
 * - `cueing`: Up next is being opened and started on the headphones. Presses are ignored.
 * - `cued`: Up next plays on the headphones. The next press Goes.
 * - `going`: the cued item is being mixed onto the speakers. Presses are ignored.
 *
 * There is no Go without a Cue. A failed Go stays `cued` (the button still reads Go).
 */
import type { SetItem } from '../../lib/setLists';

export type SetPlayerPhase = 'idle' | 'cueing' | 'cued' | 'going';

export interface SetPlayerState {
  /** The set being played; null = no set playing (the set bar is hidden). */
  setId: string | null;
  /** On the speakers. */
  nowItemId: string | null;
  /** What the next Cue loads; null = End of set. */
  nextItemId: string | null;
  /** On the headphones, waiting for Go. */
  cuedItemId: string | null;
  phase: SetPlayerPhase;
}

/** What the player needs of a set: its id and its items in order. */
export interface PlayerSet {
  id: string;
  items: readonly SetItem[];
}

/** Whether an item can be played now (its track, or step, still exists). */
export type IsPlayable = (item: SetItem) => boolean;

export const NO_SET: SetPlayerState = Object.freeze({
  setId: null,
  nowItemId: null,
  nextItemId: null,
  cuedItemId: null,
  phase: 'idle',
});

/** What a press asks the side-effect layer to do. */
export type PressAction =
  | { kind: 'none'; reason: 'not-playing' | 'busy' | 'end-of-set' }
  | { kind: 'cue'; itemId: string; skippedMissing: boolean }
  | { kind: 'go'; itemId: string };

const indexOf = (set: PlayerSet, itemId: string | null) =>
  itemId === null ? -1 : set.items.findIndex((item) => item.id === itemId);

/** The item after `itemId` (or the first item for null); null at the end. */
function itemAfter(set: PlayerSet, itemId: string | null): string | null {
  if (itemId === null) return set.items[0]?.id ?? null;
  const index = indexOf(set, itemId);
  if (index < 0) return null;
  return set.items[index + 1]?.id ?? null;
}

/** Start playing `set`. Up next is `fromItemId` when it is in the set, else the first item. */
export function start(set: PlayerSet, fromItemId?: string | null): SetPlayerState {
  const next = fromItemId && indexOf(set, fromItemId) >= 0 ? fromItemId : (set.items[0]?.id ?? null);
  return { setId: set.id, nowItemId: null, nextItemId: next, cuedItemId: null, phase: 'idle' };
}

/** Restore a position read after a reload. Ids no longer in the set are dropped; nothing is cued. */
export function restore(
  set: PlayerSet,
  position: { nowItemId: string | null; nextItemId: string | null },
): SetPlayerState {
  const now = indexOf(set, position.nowItemId) >= 0 ? position.nowItemId : null;
  const next = indexOf(set, position.nextItemId) >= 0 ? position.nextItemId : itemAfter(set, now);
  return { setId: set.id, nowItemId: now, nextItemId: next, cuedItemId: null, phase: 'idle' };
}

/**
 * The next key / the Cue-Go button. In `idle` it cues Up next, skipping Missing items
 * (`skippedMissing`); with nothing playable left it is End of set and does nothing.
 * In `cued` it Goes. In `cueing` / `going` it does nothing.
 */
export function press(
  state: SetPlayerState,
  set: PlayerSet | null,
  isPlayable: IsPlayable,
): { state: SetPlayerState; action: PressAction } {
  if (state.setId === null || !set || set.id !== state.setId) {
    return { state, action: { kind: 'none', reason: 'not-playing' } };
  }
  if (state.phase === 'cueing' || state.phase === 'going') {
    return { state, action: { kind: 'none', reason: 'busy' } };
  }
  if (state.phase === 'cued' && state.cuedItemId !== null) {
    return { state: { ...state, phase: 'going' }, action: { kind: 'go', itemId: state.cuedItemId } };
  }
  const from = indexOf(set, state.nextItemId);
  if (from < 0) {
    return { state: { ...state, nextItemId: null }, action: { kind: 'none', reason: 'end-of-set' } };
  }
  const found = set.items.slice(from).find(isPlayable);
  if (!found) {
    return { state: { ...state, nextItemId: null }, action: { kind: 'none', reason: 'end-of-set' } };
  }
  return {
    state: { ...state, nextItemId: found.id, cuedItemId: found.id, phase: 'cueing' },
    action: { kind: 'cue', itemId: found.id, skippedMissing: found.id !== state.nextItemId },
  };
}

/** The cued item is in the editor and on the headphones. */
export function cueLanded(state: SetPlayerState): SetPlayerState {
  return state.phase === 'cueing' ? { ...state, phase: 'cued' } : state;
}

/** Opening or previewing the cued item failed: back to Cue, Up next unchanged. */
export function cueFailed(state: SetPlayerState): SetPlayerState {
  return state.phase === 'cueing' ? { ...state, cuedItemId: null, phase: 'idle' } : state;
}

/** The cued item is on the speakers: it is Now playing, and the item after it is Up next. */
export function goLanded(state: SetPlayerState, set: PlayerSet | null): SetPlayerState {
  if (state.phase !== 'going' || state.cuedItemId === null) return state;
  const now = state.cuedItemId;
  return {
    ...state,
    nowItemId: now,
    nextItemId: set ? itemAfter(set, now) : null,
    cuedItemId: null,
    phase: 'idle',
  };
}

/** The cued code failed on the speakers: Now playing keeps playing and the button still reads Go. */
export function goFailed(state: SetPlayerState): SetPlayerState {
  return state.phase === 'going' ? { ...state, phase: 'cued' } : state;
}

/** The headphone preview was stopped while cued: back to Cue, Up next unchanged. */
export function cancelCue(state: SetPlayerState): SetPlayerState {
  if (state.phase !== 'cued' && state.phase !== 'cueing') return state;
  return { ...state, cuedItemId: null, phase: 'idle' };
}

/**
 * An item clicked while the set plays becomes Up next. A cue is cancelled first (`cancelled`), so
 * the caller stops the headphones; the editor keeps the cued track. Ignored while going.
 */
export function select(
  state: SetPlayerState,
  set: PlayerSet,
  itemId: string,
): { state: SetPlayerState; cancelled: boolean } {
  if (state.setId !== set.id || indexOf(set, itemId) < 0 || state.phase === 'going') {
    return { state, cancelled: false };
  }
  const cancelled = state.phase === 'cued' || state.phase === 'cueing';
  return { state: { ...state, nextItemId: itemId, cuedItemId: null, phase: 'idle' }, cancelled };
}

/** End set: the set bar hides. The music keeps playing (the caller does nothing to the audio). */
export function end(): SetPlayerState {
  return NO_SET;
}

/**
 * The set's items changed (reorder, add, remove, a remote save). The position is kept by item id:
 * a removed Now playing is forgotten; a removed (or absent) Up next becomes the item after Now
 * playing; a removed cued item cancels the cue (`cueRemoved`, so the caller stops the headphones).
 */
export function itemsChanged(state: SetPlayerState, set: PlayerSet): { state: SetPlayerState; cueRemoved: boolean } {
  if (state.setId !== set.id) return { state, cueRemoved: false };
  const has = (id: string | null) => id !== null && indexOf(set, id) >= 0;
  const now = has(state.nowItemId) ? state.nowItemId : null;
  // Removed while cued: the cue is gone. While cueing/going the effect is still running; it reports back.
  const cueRemoved = state.phase === 'cued' && !has(state.cuedItemId);
  const cued = cueRemoved ? null : state.cuedItemId;
  let next = state.nextItemId;
  if (cued !== null) next = cued;
  else if (!has(next)) next = itemAfter(set, now);
  return {
    state: {
      ...state,
      nowItemId: now,
      nextItemId: next,
      cuedItemId: cued,
      phase: cueRemoved ? 'idle' : state.phase,
    },
    cueRemoved,
  };
}

/** Whether the set bar should say "End of set" instead of Up next. */
export const isEndOfSet = (state: SetPlayerState): boolean =>
  state.setId !== null && state.phase === 'idle' && state.nextItemId === null;

/** What the set bar's one button does on the next press. */
export const buttonMode = (state: SetPlayerState): 'cue' | 'go' =>
  state.phase === 'cued' || state.phase === 'going' ? 'go' : 'cue';
