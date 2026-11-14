/**
 * Vinyl scratch control (spec 019, tech §2.6): the one ScratchController the website uses, the
 * decks it drives, and a nanostore the platter, the deck switch and the MIDI status read.
 *
 * Every input (platter drag, wheel, keyboard, MIDI jog) calls this runtime, which aims it at the
 * selected deck. Scratching changes only what is heard: nothing here touches the editor, the
 * track's code or a save path.
 */
import { map, type MapStore } from 'nanostores';
import {
  MIDI_JOG_STORAGE_KEY,
  PatternOffset,
  SCRATCH_FEEL_DEFAULTS,
  ScratchController,
  ScratchDeck,
  ScratchHandOver,
  sanitizeScratchFeel,
  sanitizeScratchSnapGrid,
} from '@strudel/mixer';
import type {
  MidiJog,
  MidiJogMapping,
  MidiJogState,
  ScratchControllerState,
  ScratchDeckName,
  ScratchFeel,
  ScratchSnapGrid,
  ScratchSource,
} from '@strudel/mixer';

export type { ScratchFeel, ScratchSnapGrid };
import { getScratchDeckSetting, setScratchDeckSetting } from '../../settings';

export interface ScratchMidiStatus {
  state: MidiJogState;
  /** Why MIDI is unavailable: 'unsupported' (no Web MIDI), 'denied', or 'failed'/'error'. */
  reason?: string;
  mapping: MidiJogMapping | null;
}

export interface ScratchState {
  /** A deck's platter is held. */
  grabbed: boolean;
  /**
   * The deck inputs act on now: the headphones only while their preview runs, else the speakers.
   * Derived from `preferred`, which is what the user picked (and what is stored).
   */
  selected: ScratchDeckName;
  /** The user's stored choice. */
  preferred: ScratchDeckName;
  /** A deck is attached and can be scratched (the main deck needs superdough's pre-gain slot). */
  available: { main: boolean; preview: boolean };
  /** The deck is playing (the main repl started; the headphone preview running). */
  playing: { main: boolean; preview: boolean };
  /** Headphones can be picked: the preview deck is attached and the preview is running. */
  previewAvailable: boolean;
  midi: ScratchMidiStatus;
  /**
   * Spec 025: the grid the track's new position is rounded to after a scratch (stored on this
   * device): 'off', 'half' (½ beat), 'beat' (spec 023's "on", the default) or 'bar'.
   */
  snapGrid: ScratchSnapGrid;
  /**
   * Spec 023: snap is on (any grid but 'off').
   * @deprecated Since spec 025: read `snapGrid`. Kept in step with it.
   */
  snap: boolean;
  /** Spec 025: the brake and spin-up, in seconds (stored on this device; both decks). */
  feel: ScratchFeel;
  /**
   * Spec 023 / tech §3: the deck can't be grabbed now. The speakers are blocked while a spec 017
   * track switch evaluates, waits or runs (the platter is dimmed), so a scratch never fights a
   * transition over the pattern's position.
   */
  blocked: { main: boolean; preview: boolean };
  /**
   * Spec 023 review 2: the latest release's plan from the worklet, so the platter spins up on
   * the same curve as the sound (stretched spin-up, then the snap correction). Null until one.
   */
  spin: ScratchSpinPlan | null;
}

/** A release's plan, as the worklet runs it (see `planScratchRelease`). */
export interface ScratchSpinPlan {
  deck: ScratchDeckName;
  id: number;
  upSeconds: number;
  fromRate: number;
  bumpSeconds: number;
  bumpDepth: number;
  targetSeconds: number;
}

/** The part of ScratchController the runtime uses. */
export interface ScratchControllerLike {
  setDeck(name: ScratchDeckName, deck: ScratchDeckLike | null): void;
  selected: ScratchDeckName;
  readonly state?: ScratchControllerState;
  grab(source?: ScratchSource): boolean | void;
  moveBy(seconds: number, source?: ScratchSource): void;
  setMotor(rate: number, source?: ScratchSource): void;
  release(source?: ScratchSource): void;
  releaseAll(options?: { commitPending?: boolean }): void;
  autoRelease(ms: number, source?: ScratchSource): void;
  on(event: 'change', listener: (state: ScratchControllerState) => void): () => void;
}

/** The part of ScratchDeck the runtime uses. */
export interface ScratchDeckLike {
  attach(): Promise<unknown>;
  release(): void;
  destroy(): void;
  getDebugState?(): Promise<ScratchDebugState | null>;
  /**
   * Spec 023: snap the lag to the beat on release.
   * @deprecated Since spec 025: decks with `snapGrid` get that instead.
   */
  snap?: boolean;
  /** Spec 025: the snap grid for the next release. */
  snapGrid?: ScratchSnapGrid;
  /** Spec 025: the brake and spin-up for the next grab / release. */
  setFeel?(feel: ScratchFeel): unknown;
  /** Spec 023: back to live now, dropping a release in progress. */
  abort?(): void;
  /** Spec 023 review 2: the release's plan, once per release. */
  onPlan?(listener: (plan: Omit<ScratchSpinPlan, 'deck'>) => void): () => void;
}

/** Spec 023: the speakers' scratch offset (the main repl's editPattern wraps the transition hook). */
export interface PatternOffsetLike {
  editPattern(pattern: unknown, inner?: (pattern: unknown) => unknown): unknown;
  reset(): void;
  readonly cycles: number;
}

/** Spec 023: what applies a settled scratch to the speakers' repl. */
export interface ScratchHandOverLike {
  destroy(): void;
}

/** Spec 023: the main repl, as the runtime needs it for the track shift. */
export interface MainReplLike {
  setPattern?(pattern: unknown, autostart?: boolean): unknown;
  scheduler?: { cps?: number; started?: boolean } | null;
}

/** The part of PreviewEngine the runtime uses: the headphone deck, created when the preview plays. */
export interface PreviewEngineLike {
  ensureScratchDeck(): Promise<ScratchDeckLike | null>;
}

export interface ScratchDebugState {
  mix: number;
  grabbed: boolean;
  pos: number;
  /** Spec 023: the worklet's phase, lag (s) and record rate. */
  phase?: string;
  lag?: number;
  rate?: number;
}

export interface ScratchRuntimeDeps {
  createController: () => ScratchControllerLike;
  createDeck: (audioContext: AudioContext, superdoughController: unknown) => ScratchDeckLike;
  /** The jog drives `target` (the runtime), so it obeys the same "deck playing" gate as the platter. */
  loadMidiJog: (target: ScratchActions) => Promise<MidiJog>;
  readSelected: () => ScratchDeckName;
  writeSelected: (deck: ScratchDeckName) => void;
  midiSupported: () => boolean;
  hasStoredMidiMapping: () => boolean;
  /**
   * Spec 023: the stored Snap to beat setting (default on) and its writer.
   * @deprecated Since spec 025: used only when `readSnapGrid` / `writeSnapGrid` are not given.
   */
  readSnap?: () => boolean;
  writeSnap?: (snap: boolean) => void;
  /** Spec 025: the stored snap grid (default 'beat') and its writer. */
  readSnapGrid?: () => ScratchSnapGrid;
  writeSnapGrid?: (grid: ScratchSnapGrid) => void;
  /** Spec 025: the stored feel (defaults when missing or damaged) and its writer. */
  readFeel?: () => ScratchFeel;
  writeFeel?: (feel: ScratchFeel) => void;
  /** Spec 023: the speakers' scratch offset. */
  createPatternOffset?: (options: { getRepl: () => MainReplLike | null; isBusy: () => boolean }) => PatternOffsetLike;
  /** Spec 023: applies the speakers deck's settled lag (shift, stale voices, hand-over). */
  createHandOver?: (
    deck: ScratchDeckLike,
    options: { getRepl: () => MainReplLike | null; offset: PatternOffsetLike; isBlocked: () => boolean },
  ) => ScratchHandOverLike;
  /** Where spec 017's track-transition-* events are dispatched (default: window). */
  eventTarget?: EventTarget | null;
}

/**
 * The actions the inputs need. Each input passes its own source ('pointer', 'key', 'wheel',
 * 'midi'): the record is let go of only when no source holds it any more.
 */
export interface ScratchActions {
  /** Grabs the selected deck. Refused (false) unless that deck is attached and playing. */
  grab(source?: ScratchSource): boolean;
  moveBy(seconds: number, source?: ScratchSource): void;
  release(source?: ScratchSource): void;
  autoRelease(ms: number, source?: ScratchSource): void;
}

export interface ScratchRuntime extends ScratchActions {
  readonly store: MapStore<ScratchState>;
  /**
   * Spec 023: turn Snap to beat on or off (stored; applies to the next release on both decks).
   * @deprecated Since spec 025: use `setSnapGrid`. true sets 'beat', false 'off'.
   */
  setSnap(snap: boolean): void;
  /** Spec 025: choose the snap grid (stored; applies to the next release on both decks). */
  setSnapGrid(grid: ScratchSnapGrid): void;
  /**
   * Spec 025: set the brake and / or the spin-up (stored; both decks, from the next grab or
   * release). A field left out keeps its value; an invalid one falls back to its default.
   */
  setFeel(feel: Partial<ScratchFeel>): void;
  /** Spec 025: back to the default brake (0.1 s) and spin-up (0.4 s). */
  resetFeel(): void;
  /**
   * Spec 023: the main repl's editPattern. Runs `inner` (spec 017's transition hook) and shifts
   * the result by the speakers' scratch offset; with offset 0 it returns `inner`'s result as is.
   */
  editMainPattern<T>(pattern: T, inner?: (pattern: T) => T): T;
  /** Spec 023: the main repl (for the shift) and whether a track switch is busy (blocks grabs). */
  setMainRepl(repl: MainReplLike | null, options?: { isBusy?: () => boolean }): void;
  /** Spec 023: a deck stopped: its offset resets and a record spinning up goes back to live. */
  deckStopped(deck: ScratchDeckName): void;
  /** Spec 023: re-read whether a track switch blocks the speakers deck (and dim the platter). */
  refreshBlocked(): void;
  setMotor(rate: number, source?: ScratchSource): void;
  /**
   * Let go of everything. `commitPending` (an Update or Ctrl+Enter): a record already spinning
   * up keeps its planned lag (spec 023 review 4); by default (stop, switch) it is dropped.
   */
  releaseAll(options?: { commitPending?: boolean }): void;
  select(deck: ScratchDeckName): void;
  setPlaying(deck: ScratchDeckName, playing: boolean): void;
  /**
   * Attaches the main (speakers) deck to superdough's controller. Once per controller; a deck that
   * fails to attach is dropped and tried again on the next Play.
   */
  attachMain(audioContext: AudioContext, superdoughController: unknown): Promise<void>;
  detachMain(): void;
  /**
   * Registers the headphone preview's engine. Its deck is created (ensureScratchDeck) only when the
   * preview plays, and a failed attach is retried on the next preview start.
   */
  attachPreview(engine: PreviewEngineLike | null | undefined): void;
  /** Creates and registers the preview deck now (when the preview plays). */
  ensurePreviewDeck(): Promise<void>;
  detachPreview(): void;
  midiLearn(): Promise<MidiJogMapping | null>;
  midiForget(): void;
  /** Reconnects a stored jog mapping (loads the MIDI code only when one exists). */
  restoreMidi(): Promise<void>;
  /** For browser checks: each attached deck's worklet state. */
  debugState(): Promise<Partial<Record<ScratchDeckName, ScratchDebugState | null>>>;
}

const finite = (value: number): boolean => typeof value === 'number' && Number.isFinite(value);

/**
 * Where the snap setting is stored on this device. Spec 025: it holds the grid ('off', 'half',
 * 'beat', 'bar'); spec 023's 'true' / 'false' are still read ('true' → 'beat', 'false' → 'off').
 */
export const SCRATCH_SNAP_STORAGE_KEY = 'strudel-scratch-snap';
/** Spec 025: where the feel (brake, spin-up) is stored on this device, as JSON. */
export const SCRATCH_FEEL_STORAGE_KEY = 'strudel-scratch-feel';

const storageGet = (key: string): string | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch (error: unknown) {
    return null;
  }
};

const storageSet = (key: string, value: string, what: string): void => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch (error: unknown) {
    console.warn(`[scratch] could not store ${what}:`, error);
  }
};

/** Spec 025: the stored snap grid. Legacy 'false' → 'off'; 'true', nothing or unknown → 'beat'. */
export function readScratchSnapGrid(): ScratchSnapGrid {
  return sanitizeScratchSnapGrid(storageGet(SCRATCH_SNAP_STORAGE_KEY));
}

/** Spec 025: store the snap grid. */
export function writeScratchSnapGrid(grid: ScratchSnapGrid): void {
  storageSet(SCRATCH_SNAP_STORAGE_KEY, sanitizeScratchSnapGrid(grid), 'the snap grid');
}

/**
 * Spec 023: the stored Snap to beat setting; on unless it was turned off.
 * @deprecated Since spec 025: use `readScratchSnapGrid`.
 */
export function readScratchSnap(): boolean {
  return readScratchSnapGrid() !== 'off';
}

/**
 * Spec 023: store Snap to beat (as 'true' / 'false', which the grid reader maps to 'beat' / 'off').
 * @deprecated Since spec 025: use `writeScratchSnapGrid`.
 */
export function writeScratchSnap(snap: boolean): void {
  storageSet(SCRATCH_SNAP_STORAGE_KEY, snap ? 'true' : 'false', 'Snap to beat');
}

/** Spec 025: the stored feel; each field falls back to its default when missing or damaged. */
export function readScratchFeel(): ScratchFeel {
  const raw = storageGet(SCRATCH_FEEL_STORAGE_KEY);
  if (raw === null) return sanitizeScratchFeel(null);
  try {
    return sanitizeScratchFeel(JSON.parse(raw));
  } catch (error: unknown) {
    return sanitizeScratchFeel(null);
  }
}

/** Spec 025: store the feel. */
export function writeScratchFeel(feel: ScratchFeel): void {
  storageSet(SCRATCH_FEEL_STORAGE_KEY, JSON.stringify(sanitizeScratchFeel(feel)), 'the scratch feel');
}

/** The spec 017 events that start and end a track switch's waiting and running phases. */
const TRANSITION_EVENTS = ['waiting', 'start', 'end', 'error'].map((name) => `track-transition-${name}`);

/** The deck inputs act on: the stored choice, but the headphones only while their preview runs. */
export const effectiveDeck = (preferred: ScratchDeckName, previewAvailable: boolean): ScratchDeckName =>
  preferred === 'preview' && previewAvailable ? 'preview' : 'main';

/**
 * The selected deck can be scratched now: attached and playing. The one check every input uses
 * (platter, wheel, keys, MIDI), so nothing scratches the tail of a stopped track.
 */
export const isScratchActive = (
  state: Pick<ScratchState, 'available' | 'playing' | 'selected'> & Partial<Pick<ScratchState, 'blocked'>>,
): boolean => state.available[state.selected] && state.playing[state.selected] && !state.blocked?.[state.selected];

/** Spec 023 review 2: the plan the platter follows, the selected deck's latest release. */
export const selectedSpin = (state: Pick<ScratchState, 'selected'> & Partial<Pick<ScratchState, 'spin'>>) =>
  state.spin && state.spin.deck === state.selected ? state.spin : null;

export function createScratchRuntime(deps: ScratchRuntimeDeps): ScratchRuntime {
  const midiSupported = deps.midiSupported();
  const preferred = deps.readSelected();
  const initialGrid: ScratchSnapGrid = deps.readSnapGrid
    ? sanitizeScratchSnapGrid(deps.readSnapGrid())
    : deps.readSnap
      ? sanitizeScratchSnapGrid(deps.readSnap())
      : 'beat';
  const store = map<ScratchState>({
    grabbed: false,
    selected: effectiveDeck(preferred, false),
    preferred,
    available: { main: false, preview: false },
    playing: { main: false, preview: false },
    previewAvailable: false,
    midi: midiSupported
      ? { state: 'off', mapping: null }
      : { state: 'unavailable', reason: 'unsupported', mapping: null },
    snapGrid: initialGrid,
    snap: initialGrid !== 'off',
    feel: sanitizeScratchFeel(deps.readFeel ? deps.readFeel() : null),
    blocked: { main: false, preview: false },
    spin: null,
  });
  // Spec 023 review 2: each deck's plan reaches the store (the platter of the selected deck reads it).
  const unsubscribePlan: Partial<Record<ScratchDeckName, () => void>> = {};
  const watchPlan = (name: ScratchDeckName, deck: ScratchDeckLike | null) => {
    unsubscribePlan[name]?.();
    delete unsubscribePlan[name];
    if (!deck?.onPlan) return;
    unsubscribePlan[name] = deck.onPlan((plan) => {
      if (!plan) return;
      update({
        spin: {
          deck: name,
          id: plan.id,
          upSeconds: plan.upSeconds,
          fromRate: plan.fromRate,
          bumpSeconds: plan.bumpSeconds,
          bumpDepth: plan.bumpDepth,
          targetSeconds: plan.targetSeconds,
        },
      });
    });
  };

  // Spec 023: the speakers' track shift.
  let mainRepl: MainReplLike | null = null;
  let mainBusy: () => boolean = () => false;
  const isMainBusy = (): boolean => {
    try {
      return Boolean(mainBusy());
    } catch (error: unknown) {
      console.warn('[scratch] reading the transition state failed:', error);
      return false;
    }
  };
  const mainOffset: PatternOffsetLike | null =
    deps.createPatternOffset?.({ getRepl: () => mainRepl, isBusy: isMainBusy }) ?? null;
  let mainHandOver: ScratchHandOverLike | null = null;
  let transitionTarget: EventTarget | null = null;
  const onTransitionEvent = () => runtime.refreshBlocked();

  let controller: ScratchControllerLike | null = null;
  let mainDeck: ScratchDeckLike | null = null;
  let mainOwner: unknown = null;
  let mainAttaching: Promise<void> | null = null;
  let mainGeneration = 0;
  // The last attachMain arguments, for the retry on the next Play (null once detached).
  let mainArgs: [AudioContext, unknown] | null = null;
  let previewDeck: ScratchDeckLike | null = null;
  let previewEngine: PreviewEngineLike | null = null;
  let midi: MidiJog | null = null;
  let midiLoading: Promise<MidiJog | null> | null = null;

  /** Spec 025: give a deck the current snap grid and feel (on attach and on every change). */
  const applySettings = (deck: ScratchDeckLike | null) => {
    if (!deck) return;
    const { snapGrid, feel } = store.get();
    // A spec 023 deck (no snapGrid) gets the boolean.
    if ('snapGrid' in deck) deck.snapGrid = snapGrid;
    else deck.snap = snapGrid !== 'off';
    try {
      deck.setFeel?.({ ...feel });
    } catch (error: unknown) {
      console.warn('[scratch] could not apply the feel:', error);
    }
  };

  const update = (patch: Partial<ScratchState>) => {
    const next = { ...store.get(), ...patch };
    next.previewAvailable = next.available.preview && next.playing.preview;
    next.selected = effectiveDeck(next.preferred, next.previewAvailable);
    store.set(next);
    // The controller follows the effective deck (its setter lets go of the old one).
    if (controller && controller.selected !== next.selected) controller.selected = next.selected;
  };

  const getController = (): ScratchControllerLike => {
    if (controller) return controller;
    controller = deps.createController();
    controller.selected = store.get().selected;
    controller.on('change', (state) => {
      if (!state) return;
      update({
        grabbed: Boolean(state.grabbed),
        available: {
          main: Boolean(state.available?.main),
          preview: Boolean(state.available?.preview),
        },
      });
    });
    return controller;
  };

  const syncAvailability = () => {
    const state = controller?.state;
    if (state) {
      update({
        grabbed: Boolean(state.grabbed),
        available: { main: Boolean(state.available?.main), preview: Boolean(state.available?.preview) },
      });
    }
  };

  const syncMidi = () => {
    if (!midi) return;
    update({ midi: { state: midi.state, reason: midi.reason, mapping: midi.mapping ?? null } });
  };

  const ensureMidi = (): Promise<MidiJog | null> => {
    if (midi) return Promise.resolve(midi);
    if (!midiSupported) return Promise.resolve(null);
    midiLoading ??= deps
      .loadMidiJog(runtime)
      .then((jog) => {
        midi = jog;
        jog.on('change', syncMidi);
        syncMidi();
        return jog;
      })
      .catch((error: unknown) => {
        console.warn('[scratch] MIDI jog unavailable:', error);
        midiLoading = null;
        update({ midi: { state: 'unavailable', reason: 'error', mapping: null } });
        return null;
      });
    return midiLoading;
  };

  const runtime: ScratchRuntime = {
    store,

    grab(source) {
      // Spec 023 tech §3: never while a track switch evaluates, waits or runs on the speakers.
      if (store.get().selected === 'main' && isMainBusy() !== store.get().blocked.main) runtime.refreshBlocked();
      // Not while the deck is stopped (spec 2.1): the stopped track's tail must not play.
      if (!isScratchActive(store.get())) return false;
      // ScratchDeck.grab() is idempotent: the wheel and the jog call this on every move.
      const scratch = getController();
      const held = scratch.grab(source) !== false;
      const state = scratch.state;
      update({ grabbed: state ? Boolean(state.grabbed) : held });
      return held;
    },

    moveBy(seconds, source) {
      if (!finite(seconds) || !controller) return;
      controller.moveBy(seconds, source);
    },

    setMotor(rate, source) {
      if (!finite(rate) || !controller) return;
      controller.setMotor(rate, source);
    },

    release(source) {
      if (!controller) return;
      // The record stays held while another source (a held key, the platter) still holds it.
      controller.release(source);
      const state = controller.state;
      update({ grabbed: state ? Boolean(state.grabbed) : false });
    },

    releaseAll(options) {
      // Called before every stop, Update and track switch: nothing to do before the first scratch.
      if (!controller) return;
      if (options) controller.releaseAll(options);
      else controller.releaseAll();
      update({ grabbed: false });
    },

    autoRelease(ms, source) {
      if (controller) controller.autoRelease(ms, source);
    },

    select(deck) {
      const next: ScratchDeckName = deck === 'preview' ? 'preview' : 'main';
      if (next === store.get().preferred) return;
      deps.writeSelected(next);
      // A change of the effective deck lets go of the old one (the controller's setter).
      update({ preferred: next });
    },

    setPlaying(deck, playing) {
      const current = store.get().playing;
      if (current[deck] === playing) return;
      // A deck that stops is let go of: nothing is scratched over silence.
      if (!playing && store.get().selected === deck) runtime.releaseAll();
      update({ playing: { ...current, [deck]: playing } });
      // The headphone deck is created when the preview plays (and retried on each start).
      if (deck === 'preview' && playing) void runtime.ensurePreviewDeck();
      // Retry a speakers deck that failed to attach, once per Play (never a retry storm).
      if (deck === 'main' && playing && !mainDeck && !mainAttaching && mainArgs) {
        void runtime.attachMain(...mainArgs);
      }
    },

    attachMain(audioContext, superdoughController) {
      if (!audioContext || !superdoughController) return Promise.resolve();
      mainArgs = [audioContext, superdoughController];
      if (mainOwner === superdoughController && (mainDeck || mainAttaching)) {
        return mainAttaching ?? Promise.resolve();
      }
      if (mainDeck) runtime.detachMain();
      const generation = ++mainGeneration;
      mainOwner = superdoughController;
      const deck = deps.createDeck(audioContext, superdoughController);
      mainAttaching = deck
        .attach()
        .then((attached) => {
          if (generation !== mainGeneration) {
            // Detached (or replaced) while the worklet loaded.
            deck.destroy();
            return;
          }
          if (attached === false) {
            // No pre-gain slot or no worklet: drop it; the next Play tries again.
            mainOwner = null;
            deck.destroy();
            return;
          }
          mainDeck = deck;
          applySettings(deck);
          watchPlan('main', deck);
          if (mainOffset && deps.createHandOver) {
            mainHandOver = deps.createHandOver(deck, {
              getRepl: () => mainRepl,
              offset: mainOffset,
              isBlocked: isMainBusy,
            });
          }
          getController().setDeck('main', deck);
          syncAvailability();
        })
        .catch((error: unknown) => {
          console.warn('[scratch] main deck could not attach:', error);
          if (generation === mainGeneration) mainOwner = null;
          try {
            deck.destroy();
          } catch (destroyError: unknown) {
            console.warn('[scratch] main deck cleanup failed:', destroyError);
          }
        })
        .finally(() => {
          if (generation === mainGeneration) mainAttaching = null;
        });
      return mainAttaching;
    },

    detachMain() {
      mainArgs = null;
      mainGeneration++;
      mainAttaching = null;
      mainOwner = null;
      const deck = mainDeck;
      mainDeck = null;
      mainHandOver?.destroy();
      mainHandOver = null;
      watchPlan('main', null);
      if (!deck) return;
      deck.release();
      controller?.setDeck('main', null);
      deck.destroy();
      syncAvailability();
      if (!controller?.state) update({ available: { ...store.get().available, main: false } });
    },

    attachPreview(engine) {
      previewEngine = engine ?? null;
      if (previewEngine && store.get().playing.preview) void runtime.ensurePreviewDeck();
    },

    async ensurePreviewDeck() {
      const engine = previewEngine;
      if (!engine) return;
      let deck: ScratchDeckLike | null = null;
      try {
        deck = await engine.ensureScratchDeck();
      } catch (error: unknown) {
        console.warn('[scratch] headphone deck could not attach:', error);
      }
      // Detached (or replaced) meanwhile, failed (retried on the next preview start), or already in.
      if (previewEngine !== engine || !deck || deck === previewDeck) return;
      previewDeck = deck;
      applySettings(deck);
      watchPlan('preview', deck);
      getController().setDeck('preview', deck);
      syncAvailability();
    },

    detachPreview() {
      previewEngine = null;
      if (!previewDeck) return;
      previewDeck.release();
      previewDeck = null;
      watchPlan('preview', null);
      controller?.setDeck('preview', null);
      syncAvailability();
      if (!controller?.state) update({ available: { ...store.get().available, preview: false } });
    },

    setSnap(snap) {
      runtime.setSnapGrid(snap ? 'beat' : 'off');
    },

    setSnapGrid(grid) {
      const next = sanitizeScratchSnapGrid(grid);
      if (deps.writeSnapGrid) deps.writeSnapGrid(next);
      // A runtime built with spec 023's boolean storage only (no grid writer).
      else deps.writeSnap?.(next !== 'off');
      if (store.get().snapGrid !== next) update({ snapGrid: next, snap: next !== 'off' });
      applySettings(mainDeck);
      applySettings(previewDeck);
    },

    setFeel(feel) {
      const patch = feel && typeof feel === 'object' ? feel : {};
      const next = sanitizeScratchFeel({ ...store.get().feel, ...patch });
      const current = store.get().feel;
      if (next.brakeSeconds === current.brakeSeconds && next.spinUpSeconds === current.spinUpSeconds) return;
      deps.writeFeel?.(next);
      update({ feel: next });
      applySettings(mainDeck);
      applySettings(previewDeck);
    },

    resetFeel() {
      runtime.setFeel({ ...SCRATCH_FEEL_DEFAULTS });
    },

    editMainPattern(pattern, inner) {
      if (!mainOffset) return inner ? inner(pattern) : pattern;
      return mainOffset.editPattern(pattern, inner as ((p: unknown) => unknown) | undefined) as typeof pattern;
    },

    setMainRepl(repl, options) {
      mainRepl = repl ?? null;
      mainBusy = options?.isBusy ?? (() => false);
      const target = deps.eventTarget !== undefined ? deps.eventTarget : typeof window !== 'undefined' ? window : null;
      if (target && target !== transitionTarget) {
        for (const name of TRANSITION_EVENTS) {
          transitionTarget?.removeEventListener(name, onTransitionEvent);
          target.addEventListener(name, onTransitionEvent);
        }
        transitionTarget = target;
      }
      runtime.refreshBlocked();
    },

    deckStopped(deck) {
      if (deck === 'main') {
        mainOffset?.reset();
        mainDeck?.abort?.();
      } else {
        previewDeck?.abort?.();
      }
    },

    refreshBlocked() {
      const main = isMainBusy();
      const current = store.get().blocked;
      if (current.main === main) return;
      // A transition starting while the record is held: let go (it never fights the switch).
      if (main && store.get().selected === 'main') controller?.releaseAll();
      update({ blocked: { ...current, main } });
    },

    async midiLearn() {
      const jog = await ensureMidi();
      if (!jog || jog.state === 'unavailable') {
        syncMidi();
        return null;
      }
      const learning = jog.learn();
      syncMidi();
      try {
        return await learning;
      } finally {
        syncMidi();
      }
    },

    midiForget() {
      if (!midi) return;
      midi.forget();
      syncMidi();
    },

    async restoreMidi() {
      if (!midiSupported || !deps.hasStoredMidiMapping()) return;
      await ensureMidi();
    },

    async debugState() {
      const out: Partial<Record<ScratchDeckName, ScratchDebugState | null>> = {};
      if (mainDeck?.getDebugState) out.main = await mainDeck.getDebugState();
      if (previewDeck?.getDebugState) out.preview = await previewDeck.getDebugState();
      return out;
    },
  };

  return runtime;
}

const browserMidiSupported = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';

const storedMidiMapping = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MIDI_JOG_STORAGE_KEY) !== null;
  } catch (error: unknown) {
    return false;
  }
};

/** The website's scratch runtime (a module singleton, tech §2.4). */
export const scratchRuntime: ScratchRuntime = createScratchRuntime({
  createController: () => new ScratchController(),
  createDeck: (audioContext, superdoughController) => new ScratchDeck(audioContext, superdoughController),
  // Lazy, so the Web MIDI code loads only when Learn is used or a mapping exists.
  // The jog calls grab / moveBy / autoRelease on the runtime, gated like every other input.
  loadMidiJog: async (target) => {
    const { createMidiJog } = await import('@strudel/mixer');
    return createMidiJog(target as unknown as ScratchController);
  },
  readSelected: getScratchDeckSetting,
  writeSelected: setScratchDeckSetting,
  midiSupported: browserMidiSupported,
  hasStoredMidiMapping: storedMidiMapping,
  readSnapGrid: readScratchSnapGrid,
  writeSnapGrid: writeScratchSnapGrid,
  readFeel: readScratchFeel,
  writeFeel: writeScratchFeel,
  createPatternOffset: (options) => new PatternOffset(options),
  createHandOver: (deck, options) =>
    new ScratchHandOver(deck as unknown as ScratchDeck, {
      getRepl: options.getRepl,
      offset: options.offset as unknown as PatternOffset,
      isBlocked: options.isBlocked,
    }),
});

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  // Browser checks (tech §4): read each worklet's mix and position.
  (window as Window & { __strudelScratch?: ScratchRuntime }).__strudelScratch = scratchRuntime;
}
