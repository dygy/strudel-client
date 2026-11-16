/**
 * The manual crossfader (spec 031 §2.5, tech §2.6): mixes the next track in by hand through the
 * transition controller's manual mode (beginManual / setManualProgress / handManualToTimed).
 *
 * - The playing track owns one end of the fader, the left at first (not remembered across reloads).
 *   For a fader position x the mix progress is p = x when the playing end is the left, 1 − x when it
 *   is the right.
 * - Leaving the playing end (p > 2 %) starts a mix to the next track, in this order: the set's cued
 *   item (through the set player's manual Go, which stops the headphones as Go does); otherwise the
 *   editor's track when it differs from the playing one (the switch Update would make); otherwise
 *   nothing: the fader is inert ("Nothing cued").
 * - While mixing, every position is the progress. The controller completes the mix at the far end
 *   (≥ 98 %) and abandons it back at the playing end (≤ 2 %).
 * - Complete: the playing end flips to the far end (the next mix goes the other way), and the set
 *   advances as Go's completion does. Abandon: the item stays cued (the set player re-cues it).
 * - A mix only starts from the playing end: after a failed, refused or handed-over mix, or after
 *   moving the fader with nothing cued, the fader has to come back to the playing end first, so a
 *   fader sitting mid-way never brings a track in at half level.
 *
 * No React and no audio here: the REPL supplies the deps (useMidiMap), the UI and MIDI call
 * setPosition.
 */
import { MANUAL_ABANDON_AT } from '@strudel/mixer';

export type CrossfaderEnd = 'left' | 'right';
/** How a manual mix ended. */
export type ManualOutcome = 'complete' | 'abandoned' | 'failed' | 'ignored';
/** Where the next track comes from. */
export type CrossfaderNext = 'set' | 'editor' | null;

export interface CrossfaderState {
  /** The fader, 0 (left, A) … 1 (right, B). */
  position: number;
  playingEnd: CrossfaderEnd;
  /** A manual mix is in flight (starting, mixing, or handed to the timed path). */
  mixing: boolean;
  /** The fader sits at the playing end: the next move away starts a mix. */
  armed: boolean;
  /** The last move found no next track. */
  inert: boolean;
}

export interface CrossfaderDeps {
  /** Whether the speakers play (nothing to mix from otherwise). */
  isPlaying: () => boolean;
  /** The set has a cued item ready to Go. */
  setCued: () => boolean;
  /** The editor holds a different track than the playing one. */
  editorDiffers: () => boolean;
  /** The set player's manual Go of the cued item. */
  beginSet: () => Promise<ManualOutcome>;
  /** The editor's track through the Update path, as a manual mix. */
  beginEditor: () => Promise<ManualOutcome>;
  /** TrackTransitionController.setManualProgress. */
  setProgress: (p: number) => boolean;
  /** TrackTransitionController.handManualToTimed (Go during a mix). */
  handOver: () => boolean;
}

/** The mix progress for fader position `x` when `playingEnd` plays. */
export function progressFor(x: number, playingEnd: CrossfaderEnd): number {
  return playingEnd === 'left' ? x : 1 - x;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** While a mix is starting, the progress is pushed again this often until the controller takes it. */
const RETRY_MS = 50;
const RETRIES = 40;

export const INITIAL_CROSSFADER_STATE: CrossfaderState = Object.freeze({
  position: 0,
  playingEnd: 'left',
  mixing: false,
  armed: true,
  inert: false,
});

export function createCrossfader(initialDeps: CrossfaderDeps | null = null) {
  let deps = initialDeps;
  let state: CrossfaderState = INITIAL_CROSSFADER_STATE;
  const listeners = new Set<() => void>();
  let accepted = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const set = (patch: Partial<CrossfaderState>) => {
    const next = { ...state, ...patch };
    if (
      next.position === state.position &&
      next.playingEnd === state.playingEnd &&
      next.mixing === state.mixing &&
      next.armed === state.armed &&
      next.inert === state.inert
    ) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const progress = () => progressFor(state.position, state.playingEnd);

  const stopRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };

  /** Push the current progress; until the controller has the mix, retry for a while. */
  const push = (tries = RETRIES) => {
    if (!deps || !state.mixing) return;
    const took = deps.setProgress(progress());
    accepted = accepted || took;
    stopRetry();
    if (!took && !accepted && tries > 0) retryTimer = setTimeout(() => push(tries - 1), RETRY_MS);
  };

  const finish = (outcome: ManualOutcome, mine: number) => {
    if (mine !== generation || !state.mixing) return;
    stopRetry();
    const playingEnd: CrossfaderEnd =
      outcome === 'complete' ? (state.playingEnd === 'left' ? 'right' : 'left') : state.playingEnd;
    set({
      mixing: false,
      playingEnd,
      armed: progressFor(state.position, playingEnd) <= MANUAL_ABANDON_AT,
      inert: false,
    });
  };

  /** Where the next track comes from right now. */
  const next = (): CrossfaderNext => {
    if (!deps || !deps.isPlaying()) return null;
    if (deps.setCued()) return 'set';
    if (deps.editorDiffers()) return 'editor';
    return null;
  };

  const begin = (source: 'set' | 'editor') => {
    if (!deps) return;
    const mine = ++generation;
    accepted = false;
    set({ mixing: true, armed: false, inert: false });
    let started: Promise<ManualOutcome>;
    try {
      started = source === 'set' ? deps.beginSet() : deps.beginEditor();
    } catch (error: unknown) {
      console.warn('[crossfader] the mix did not start:', error);
      finish('failed', mine);
      return;
    }
    push();
    started.then(
      (outcome) => finish(outcome, mine),
      (error: unknown) => {
        console.warn('[crossfader] the mix failed:', error);
        finish('failed', mine);
      },
    );
  };

  const crossfader = {
    getState: (): CrossfaderState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** The REPL's pieces (fresh closures; called once by useMidiMap). */
    setDeps(next: CrossfaderDeps | null) {
      deps = next;
    },
    /** Where the next mix would come from (null: inert, "Nothing cued"). */
    nextSource: next,
    /** The progress from the playing end for the current position. */
    progress,

    /** Move the fader to `x` (0 = left/A … 1 = right/B), from the slider or MIDI. */
    setPosition(x: number) {
      if (typeof x !== 'number' || !Number.isFinite(x)) return;
      set({ position: clamp01(x) });
      const p = progress();
      if (state.mixing) {
        push();
        return;
      }
      if (p <= MANUAL_ABANDON_AT) {
        set({ armed: true, inert: false });
        return;
      }
      if (!state.armed) return;
      const source = next();
      if (!source) {
        set({ armed: false, inert: true });
        return;
      }
      begin(source);
    },

    /** Go during a mix: continue as the timed transition from here. */
    handOver(): boolean {
      return state.mixing && Boolean(deps?.handOver());
    },

    /** Tests only. */
    reset() {
      generation++;
      stopRetry();
      state = INITIAL_CROSSFADER_STATE;
      for (const listener of [...listeners]) listener();
    },
    destroy() {
      generation++;
      stopRetry();
      listeners.clear();
      deps = null;
    },
  };
  return crossfader;
}

export type Crossfader = ReturnType<typeof createCrossfader>;
