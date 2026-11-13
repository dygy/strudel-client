/**
 * The set player's side effects (spec 022 §2.3, tech §2.3 useSetPlayer): the pure state machine in
 * setPlayer.ts, driven against the set bridge.
 *
 * - Cue: open Up next as a library click does (which saves the track being left first), then play
 *   the editor's code on the headphones. Nothing reaches the speakers. While cued, the editor's own
 *   evaluate goes to the headphones too.
 * - Go: the bridge stops the headphones and switches the speakers with the item's transition. A
 *   failed Go leaves the set where it was, still cued.
 * - Stopping the preview with its own button cancels the cue. Update while cued is Go.
 *
 * No React here (useSetPlayer wraps it).
 */
import type { SetItem } from '../../lib/setLists';
import type { SetBridge } from './setBridge';
import { resolveItem, type LibraryTrack } from './resolveItem';
import * as machine from './setPlayer';
import type { PlayerSet, SetPlayerState } from './setPlayer';
import type { SetPosition } from './setPosition';

/** Why a Cue didn't land: no library (zen mode), no headphone preview, or opening/playing failed. */
export type CueFailure = 'no-library' | 'no-preview' | 'failed';

export interface SetPlayerControllerDeps {
  bridge: Pick<
    SetBridge,
    | 'openItem'
    | 'cue'
    | 'go'
    | 'stopPreview'
    | 'redirectEditorToPreview'
    | 'removeRedirect'
    | 'onPreviewStopped'
    | 'setGoHandler'
  >;
  /** The set with this id as it is now (local edits included), or null. */
  getSet: (id: string) => PlayerSet | null;
  /** The library's loaded tracks, keyed by id. */
  getTracks: () => Record<string, LibraryTrack | undefined>;
  /** "Skipped a missing track". */
  onSkippedMissing?: () => void;
  /**
   * A Cue didn't land (the toast says why). The set goes back to Cue, Up next unchanged, so the
   * next press tries again.
   */
  onCueFailed?: (reason: CueFailure) => void;
  /** A Go was ignored because the same switch is still running; the cue is kept. */
  onGoIgnored?: () => void;
  /** Persist the position (null: no set playing). */
  writePosition?: (position: SetPosition | null) => void;
}

export function createSetPlayerController(deps: SetPlayerControllerDeps) {
  const { bridge } = deps;
  let state: SetPlayerState = machine.NO_SET;
  const listeners = new Set<() => void>();
  let removeRedirect: (() => void) | null = null;

  const setState = (next: SetPlayerState) => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const currentSet = () => (state.setId ? deps.getSet(state.setId) : null);
  const isPlayable = (item: SetItem) => resolveItem(item, deps.getTracks()).status === 'ok';
  const savePosition = () =>
    deps.writePosition?.(
      state.setId ? { setId: state.setId, nowItemId: state.nowItemId, nextItemId: state.nextItemId } : null,
    );
  const dropRedirect = () => {
    removeRedirect?.();
    removeRedirect = null;
    bridge.removeRedirect();
  };
  const stopCue = () => {
    dropRedirect();
    bridge.stopPreview();
  };

  async function cue(set: PlayerSet, itemId: string): Promise<void> {
    const item = set.items.find((candidate) => candidate.id === itemId);
    const resolved = item ? resolveItem(item, deps.getTracks()) : ({ status: 'missing' } as const);
    let failure: CueFailure | null = 'failed';
    if (resolved.status === 'ok') {
      const opened = await bridge.openItem(resolved.track, resolved.stepIndex);
      failure = opened === 'opened' ? null : opened;
      // Cancelled (select, end) while the track was opening: don't start the headphones.
      if (failure === null && state.phase === 'cueing' && state.cuedItemId === itemId) {
        const cued = await bridge.cue();
        failure = cued === 'playing' ? null : cued;
      }
    }
    if (state.phase !== 'cueing' || state.cuedItemId !== itemId) {
      // Cancelled while the headphones were starting: stop what just started.
      if (failure === null) bridge.stopPreview();
      return;
    }
    if (failure !== null) {
      setState(machine.cueFailed(state));
      deps.onCueFailed?.(failure);
      return;
    }
    setState(machine.cueLanded(state));
    removeRedirect = bridge.redirectEditorToPreview();
    savePosition();
  }

  async function go(set: PlayerSet | null, itemId: string): Promise<void> {
    const item = set?.items.find((candidate) => candidate.id === itemId);
    dropRedirect();
    const result = await bridge.go(item?.transition ?? null);
    if (state.phase !== 'going' || state.cuedItemId !== itemId) return;
    if (result === 'switched') {
      setState(machine.goLanded(state, currentSet()));
      savePosition();
    } else if (result === 'ignored') {
      // The same switch is still running: still cued (headphones untouched), press Go again.
      setState(machine.goFailed(state));
      removeRedirect = bridge.redirectEditorToPreview();
      deps.onGoIgnored?.();
    } else {
      // The error shows; Now playing keeps playing; still cued: fix the code and Go, or cancel.
      setState(machine.goFailed(state));
      removeRedirect = bridge.redirectEditorToPreview();
    }
  }

  const controller = {
    getState: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Play set `setId` from its first item, or from `fromItemId`. */
    start(setId: string, fromItemId?: string | null): void {
      const set = deps.getSet(setId);
      if (!set) return;
      if (state.phase === 'cued' || state.phase === 'cueing') stopCue();
      setState(machine.start(set, fromItemId));
      savePosition();
    },

    /** After a reload: the same Now playing and Up next, nothing playing. */
    restore(position: SetPosition): void {
      const set = deps.getSet(position.setId);
      if (!set || state.setId !== null) return;
      setState(machine.restore(set, position));
    },

    /** The next key / the Cue-Go button. */
    async press(): Promise<void> {
      const set = currentSet();
      const { state: next, action } = machine.press(state, set, isPlayable);
      setState(next);
      if (action.kind === 'none') {
        if (action.reason === 'end-of-set') savePosition();
        return;
      }
      if (action.kind === 'cue') {
        if (action.skippedMissing) deps.onSkippedMissing?.();
        await cue(set!, action.itemId);
      } else {
        await go(set, action.itemId);
      }
    },

    /** An item clicked while the set plays: it becomes Up next (a cue is cancelled first). */
    select(itemId: string): void {
      const set = currentSet();
      if (!set) return;
      const { state: next, cancelled } = machine.select(state, set, itemId);
      if (cancelled) stopCue();
      setState(next);
      savePosition();
    },

    /** The preview was stopped with its own button: a cue is cancelled, Up next stays. */
    cancelCue(): void {
      if (state.phase !== 'cued' && state.phase !== 'cueing') return;
      dropRedirect();
      setState(machine.cancelCue(state));
    },

    /** End set: the bar hides, the music keeps playing. */
    end(): void {
      dropRedirect();
      setState(machine.end());
      savePosition();
    },

    /** The playing set's items changed (or it was deleted). */
    itemsChanged(): void {
      if (!state.setId) return;
      const set = deps.getSet(state.setId);
      if (!set) {
        controller.end();
        return;
      }
      const { state: next, cueRemoved } = machine.itemsChanged(state, set);
      if (cueRemoved) stopCue();
      setState(next);
    },

    /** Whether Update should be the set's Go right now. */
    isCued: () => state.phase === 'cued',

    dispose(): void {
      unsubscribePreview();
      bridge.setGoHandler(null);
      dropRedirect();
    },
  };

  const unsubscribePreview = bridge.onPreviewStopped(() => controller.cancelCue());
  bridge.setGoHandler({ isCued: controller.isCued, go: () => controller.press() });
  return controller;
}

export type SetPlayerController = ReturnType<typeof createSetPlayerController>;
