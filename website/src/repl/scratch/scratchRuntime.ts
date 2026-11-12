/**
 * Vinyl scratch control (spec 019, tech §2.6): the one ScratchController the website uses, the
 * decks it drives, and a nanostore the platter, the deck switch and the MIDI status read.
 *
 * Every input (platter drag, wheel, keyboard, MIDI jog) calls this runtime, which aims it at the
 * selected deck. Scratching changes only what is heard: nothing here touches the editor, the
 * track's code or a save path.
 */
import { map, type MapStore } from 'nanostores';
import { MIDI_JOG_STORAGE_KEY, ScratchController, ScratchDeck } from '@strudel/mixer';
import type {
  MidiJog,
  MidiJogMapping,
  MidiJogState,
  ScratchControllerState,
  ScratchDeckName,
  ScratchSource,
} from '@strudel/mixer';
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
  releaseAll(): void;
  autoRelease(ms: number, source?: ScratchSource): void;
  on(event: 'change', listener: (state: ScratchControllerState) => void): () => void;
}

/** The part of ScratchDeck the runtime uses. */
export interface ScratchDeckLike {
  attach(): Promise<unknown>;
  release(): void;
  destroy(): void;
  getDebugState?(): Promise<ScratchDebugState | null>;
}

/** The part of PreviewEngine the runtime uses: the headphone deck, created when the preview plays. */
export interface PreviewEngineLike {
  ensureScratchDeck(): Promise<ScratchDeckLike | null>;
}

export interface ScratchDebugState {
  mix: number;
  grabbed: boolean;
  pos: number;
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
  setMotor(rate: number, source?: ScratchSource): void;
  releaseAll(): void;
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

/** The deck inputs act on: the stored choice, but the headphones only while their preview runs. */
export const effectiveDeck = (preferred: ScratchDeckName, previewAvailable: boolean): ScratchDeckName =>
  preferred === 'preview' && previewAvailable ? 'preview' : 'main';

/**
 * The selected deck can be scratched now: attached and playing. The one check every input uses
 * (platter, wheel, keys, MIDI), so nothing scratches the tail of a stopped track.
 */
export const isScratchActive = (state: Pick<ScratchState, 'available' | 'playing' | 'selected'>): boolean =>
  state.available[state.selected] && state.playing[state.selected];

export function createScratchRuntime(deps: ScratchRuntimeDeps): ScratchRuntime {
  const midiSupported = deps.midiSupported();
  const preferred = deps.readSelected();
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
  });

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

    releaseAll() {
      // Called before every stop, Update and track switch: nothing to do before the first scratch.
      if (!controller) return;
      controller.releaseAll();
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
      getController().setDeck('preview', deck);
      syncAvailability();
    },

    detachPreview() {
      previewEngine = null;
      if (!previewDeck) return;
      previewDeck.release();
      previewDeck = null;
      controller?.setDeck('preview', null);
      syncAvailability();
      if (!controller?.state) update({ available: { ...store.get().available, preview: false } });
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
});

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  // Browser checks (tech §4): read each worklet's mix and position.
  (window as Window & { __strudelScratch?: ScratchRuntime }).__strudelScratch = scratchRuntime;
}
