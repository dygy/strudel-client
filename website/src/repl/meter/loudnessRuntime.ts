/**
 * The loudness meter's app runtime (spec 033 functional §2.1–§2.6, tech §2.3): one `LufsMeter` on the
 * main AudioContext, fed by passive fan-out edges,
 *
 *   … destinationGain → [EQ … outputGain ─┬─ limiter …] → EQ output ─┬─▶ speakers volume → speakers
 *                                         └──▶ meter input 1          └──▶ meter input 0
 *
 * - **Install:** like masterFxRuntime, once superdough's `audioReady` resolves, and reference-counted
 *   because useReplContext mounts more than once. Only while the meter is on: switching it off destroys
 *   the meter (no worklet, no edges); switching it on installs it again.
 * - **Sources:** input 0 is the main EQ's final output (what Record as heard records and the speakers
 *   volume receives), or superdough's destinationGain while there is no EQ (read only once the context
 *   runs, the spec 030 rule). Input 1 is the EQ's limiter input, only while the EQ is on
 *   (`getLimiterInput()` is null while off). It re-attaches when the main EQ appears or goes away
 *   (subscribeMainEqualizer), on the EQ's own topology changes (on/off, limiter rebuild), and on every
 *   snapshot, which catches superdough's output reset replacing destinationGain. `LufsMeter.attach`
 *   changes only the edges that differ and disconnects by explicit destination, so the speakers' edges
 *   are never touched.
 * - **Store:** the shown snapshot, the latching warning and a 60 s history (600 entries at 10 Hz).
 * - **Reset rules (§2.3):** Play after Stop clears the measurement, the history and the warning. The
 *   instant track switch (spec 017) stops and restarts the scheduler inside `repl.stop()`, with
 *   useReplContext's `isSmoothTransitioningRef` set only during that synchronous stop; onToggle(false)
 *   runs inside it, so `setPlaying(false, { switching: true })` is called from there and the restart
 *   that follows does not reset. Update while playing hot-swaps without a stop (setPattern with the
 *   scheduler already started), and transitions and the set's Go never stop it, so neither resets.
 *   An instant switch whose new code fails leaves the speakers stopped: evaluateNewTrack then calls
 *   `switchEnded(false)`, so that stop counts as a Stop and the next Play resets.
 * - **While stopped:** M, S, peak and RMS show silence; I, TP, LRA and the counts keep their last values;
 *   the history stops. Snapshots arriving while stopped are not shown (the worklet keeps measuring).
 * - **A reset in flight:** the worklet may post one more snapshot from before it handled the reset.
 *   Until a snapshot with less measured time arrives, snapshots are dropped, so Integrated never comes
 *   back after Reset.
 *
 * Drawing is the components' business (only while shown and the tab is visible). Nothing here touches a
 * track's code, the editor, auth or a save path, and nothing is heard.
 */
import { atom, type ReadableAtom } from 'nanostores';
import { getAudioContext, getSuperdoughAudioController } from '@strudel/webaudio';
import { LufsMeter, type LoudnessOverReason, type LoudnessSnapshot } from '@strudel/mixer';
import { getMainEqualizer, subscribeMainEqualizer } from '../mainEqualizer';
import {
  browserStorage,
  readLoudnessMeterSettings,
  sanitizeLoudnessMeterSettings,
  writeLoudnessMeterSettings,
  type LoudnessMeterSettings,
  type LoudnessTarget,
} from './meterSettings';

export type { LoudnessOverReason, LoudnessSnapshot };

/** The over reasons in display order (true peak, limiter, clip). */
export const LOUDNESS_REASONS: readonly LoudnessOverReason[] = Object.freeze(['truePeak', 'limiter', 'clip']);
/** History entries kept: 60 s at the meter's 10 Hz. */
export const LOUDNESS_HISTORY_LENGTH = 600;
/**
 * After a reset, a snapshot is taken as fresh once its measured time is below the last one seen, or
 * below this (s): a fresh one starts near 0.1 s.
 */
const FRESH_SNAPSHOT_SECONDS = 0.3;

/** What the runtime needs of the meter (LufsMeter). */
export interface LufsMeterLike {
  attach(sources?: { postEq?: AudioNode | null; preLimiter?: AudioNode | null }): boolean;
  reset(): void;
  onSnapshot(listener: (snapshot: LoudnessSnapshot) => void): () => void;
  destroy(): void;
}

/** What the runtime needs of the main EQ (AudioEqualizer). */
export interface MeterEqualizerLike {
  getOutput(): AudioNode;
  getLimiterInput(): AudioNode | null;
  onTopologyChange(listener: () => void): () => void;
}

export interface LoudnessWarning {
  /** Lit until cleared (clearWarning or reset), however short the overload was. */
  lit: boolean;
  /** The reasons seen since the light was last cleared, in display order. */
  reasons: LoudnessOverReason[];
}

export interface LoudnessView {
  /** Whether a meter is installed (audio started and the meter on). */
  installed: boolean;
  /** Whether the speakers' scheduler plays. */
  playing: boolean;
  /** The snapshot as shown: null before any; while stopped M, S, peak and RMS are null. */
  snapshot: LoudnessSnapshot | null;
  warning: LoudnessWarning;
}

export interface LoudnessHistoryEntry {
  /** When it arrived (ms, the runtime's clock). */
  t: number;
  m: number | null;
  s: number | null;
  /** Whether an over event started in this snapshot. */
  warn: boolean;
}

export interface LoudnessRuntimeDeps {
  createMeter: (audioContext: BaseAudioContext) => Promise<LufsMeterLike>;
  getAudioContext: () => BaseAudioContext | null;
  getEqualizer: () => MeterEqualizerLike | null;
  subscribeEqualizer: (listener: () => void) => () => void;
  /** superdough's destinationGain, or null before audio has started. */
  destinationGain: () => AudioNode | null;
  storage: () => Storage | null;
  now?: () => number;
}

export interface LoudnessRuntime {
  readonly view: ReadableAtom<LoudnessView>;
  readonly history: ReadableAtom<readonly LoudnessHistoryEntry[]>;
  readonly settings: ReadableAtom<LoudnessMeterSettings>;
  /** Meter on/off (remembered). Off destroys the meter; on installs it again while acquired. */
  setOn(on: boolean): void;
  /** The target, LUFS, or null for Off (remembered). */
  setTarget(target: LoudnessTarget | null): void;
  /**
   * The speakers' scheduler started or stopped. A start resets the measurement unless the stop before
   * it was a track switch (`switching`).
   */
  setPlaying(started: boolean, options?: { switching?: boolean }): void;
  /**
   * The instant switch that stopped the scheduler has ended. Not restarted (the new code failed): the
   * speakers stay stopped, so that stop counts as a Stop and the next Play resets.
   */
  switchEnded(restarted: boolean): void;
  /** The panel's Reset: Integrated, true peak, LRA, the counts, the warning and the history. */
  reset(): void;
  /** Turn the warning light off; the counts stay until reset. */
  clearWarning(): void;
  /** Acquire: install the meter (async) on first use. Pair every call with `releaseInstall()`. */
  init(): void;
  releaseInstall(): void;
  /** Install once `ready` resolves; returns the release (which cancels a pending install). */
  installWhenReady(ready: Promise<unknown> | undefined): () => void;
  /** Re-attach the meter's inputs to the current sources now. */
  reattach(): void;
  /** The installed meter, or null (tests, browser checks). */
  getMeter(): LufsMeterLike | null;
  /** Tests and hot reload: take the meter out whatever the count. */
  destroy(): void;
}

const NO_EVENTS = (): Record<LoudnessOverReason, number> => ({ truePeak: 0, limiter: 0, clip: 0 });
const UNLIT: LoudnessWarning = Object.freeze({ lit: false, reasons: [] }) as LoudnessWarning;

/** The snapshot as shown while stopped: the running values silent, the totals kept. */
function stoppedSnapshot(snapshot: LoudnessSnapshot | null): LoudnessSnapshot | null {
  if (!snapshot) return null;
  return { ...snapshot, m: null, s: null, tpBlock: null, peakDb: [null, null], rmsDb: [null, null] };
}

export function createLoudnessRuntime(deps: LoudnessRuntimeDeps): LoudnessRuntime {
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const settings = atom<LoudnessMeterSettings>(readLoudnessMeterSettings(deps.storage()));
  const view = atom<LoudnessView>({ installed: false, playing: false, snapshot: null, warning: UNLIT });
  const history = atom<readonly LoudnessHistoryEntry[]>([]);

  let references = 0;
  let meter: LufsMeterLike | null = null;
  let meterContext: BaseAudioContext | null = null;
  /** Bumped on every teardown, so a meter still being created is destroyed when it arrives. */
  let generation = 0;
  let creating = false;
  let unsubscribeSnapshot: (() => void) | null = null;
  let unsubscribeEqualizer: (() => void) | null = null;
  let unsubscribeTopology: (() => void) | null = null;
  let followedEqualizer: MeterEqualizerLike | null = null;

  let playing = false;
  let stoppedBySwitch = false;
  let previousEvents = NO_EVENTS();
  let lastMeasured = 0;
  let pendingReset = false;

  const patchView = (patch: Partial<LoudnessView>) => view.set({ ...view.get(), ...patch });

  const sameContext = (node: AudioNode | null | undefined): node is AudioNode =>
    !!node && (!meterContext || !node.context || node.context === meterContext);

  const resolveSources = (): { postEq: AudioNode | null; preLimiter: AudioNode | null } => {
    let equalizer: MeterEqualizerLike | null = null;
    try {
      equalizer = deps.getEqualizer();
    } catch (error: unknown) {
      console.warn('[loudness] reading the main EQ failed:', error);
    }
    let postEq: AudioNode | null = null;
    let preLimiter: AudioNode | null = null;
    try {
      const output = equalizer?.getOutput() ?? null;
      if (sameContext(output)) postEq = output;
      const limiterInput = equalizer?.getLimiterInput() ?? null;
      if (postEq && sameContext(limiterInput)) preLimiter = limiterInput;
    } catch (error: unknown) {
      console.warn('[loudness] reading the EQ taps failed:', error);
    }
    if (!postEq) {
      try {
        const gain = deps.destinationGain();
        if (sameContext(gain)) postEq = gain;
      } catch (error: unknown) {
        console.warn('[loudness] reading destinationGain failed:', error);
      }
    }
    return { postEq, preLimiter };
  };

  /** Listen to the current main EQ's topology (on/off, limiter rebuild); follow a replaced EQ. */
  const followEqualizer = () => {
    let equalizer: MeterEqualizerLike | null = null;
    try {
      equalizer = deps.getEqualizer();
    } catch (error: unknown) {
      equalizer = null;
    }
    if (equalizer === followedEqualizer) return;
    unsubscribeTopology?.();
    unsubscribeTopology = null;
    followedEqualizer = equalizer;
    if (equalizer && typeof equalizer.onTopologyChange === 'function') {
      unsubscribeTopology = equalizer.onTopologyChange(() => runtime.reattach());
    }
  };

  const clearMeasurement = () => {
    previousEvents = NO_EVENTS();
    history.set([]);
    patchView({ snapshot: null, warning: UNLIT });
  };

  const resetMeasurement = () => {
    if (meter) {
      try {
        meter.reset();
        pendingReset = true;
      } catch (error: unknown) {
        console.warn('[loudness] reset failed:', error);
      }
    }
    clearMeasurement();
  };

  const onSnapshot = (snapshot: LoudnessSnapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return;
    // A replaced destinationGain (superdough's output reset) has no event: re-resolve at 10 Hz.
    runtime.reattach();
    const measured = Number.isFinite(snapshot.measuredSeconds) ? snapshot.measuredSeconds : 0;
    if (pendingReset) {
      if (measured >= Math.max(lastMeasured, FRESH_SNAPSHOT_SECONDS)) return; // from before the reset
      pendingReset = false;
    }
    lastMeasured = measured;
    if (!playing) return; // frozen while stopped
    const events = snapshot.events ?? NO_EVENTS();
    const rose = LOUDNESS_REASONS.filter((reason) => (events[reason] ?? 0) > (previousEvents[reason] ?? 0));
    previousEvents = { ...NO_EVENTS(), ...events };
    let warning = view.get().warning;
    if (rose.length) {
      const reasons = LOUDNESS_REASONS.filter((reason) => warning.reasons.includes(reason) || rose.includes(reason));
      warning = { lit: true, reasons };
    }
    const entries = history.get();
    const next = entries.length >= LOUDNESS_HISTORY_LENGTH ? entries.slice(1 - LOUDNESS_HISTORY_LENGTH) : [...entries];
    next.push({ t: now(), m: snapshot.m, s: snapshot.s, warn: rose.length > 0 });
    history.set(next);
    patchView({ snapshot, warning });
  };

  const teardown = () => {
    generation++;
    creating = false;
    unsubscribeSnapshot?.();
    unsubscribeSnapshot = null;
    unsubscribeEqualizer?.();
    unsubscribeEqualizer = null;
    unsubscribeTopology?.();
    unsubscribeTopology = null;
    followedEqualizer = null;
    const old = meter;
    meter = null;
    meterContext = null;
    pendingReset = false;
    lastMeasured = 0;
    try {
      old?.destroy();
    } catch (error: unknown) {
      console.warn('[loudness] could not destroy the meter:', error);
    }
    if (view.get().installed) patchView({ installed: false });
  };

  const ensureMeter = () => {
    if (meter || creating || references === 0 || !settings.get().on) return;
    let audioContext: BaseAudioContext | null = null;
    try {
      audioContext = deps.getAudioContext();
    } catch (error: unknown) {
      console.warn('[loudness] no audio context:', error);
    }
    if (!audioContext) return;
    creating = true;
    const mine = generation;
    const context = audioContext;
    Promise.resolve()
      .then(() => deps.createMeter(context))
      .then((created) => {
        if (mine !== generation || references === 0 || !settings.get().on) {
          created.destroy();
          return;
        }
        creating = false;
        meter = created;
        meterContext = context;
        lastMeasured = 0;
        unsubscribeSnapshot = created.onSnapshot(onSnapshot);
        unsubscribeEqualizer = deps.subscribeEqualizer(() => runtime.reattach());
        runtime.reattach();
        patchView({ installed: true });
      })
      .catch((error: unknown) => {
        if (mine === generation) creating = false;
        console.error('[loudness] could not install the meter:', error);
      });
  };

  const runtime: LoudnessRuntime = {
    view,
    history,
    settings,

    setOn(on) {
      const next = sanitizeLoudnessMeterSettings({ ...settings.get(), on: Boolean(on) });
      if (next.on === settings.get().on) return;
      writeLoudnessMeterSettings(deps.storage(), next);
      settings.set(next);
      if (next.on) {
        clearMeasurement();
        ensureMeter();
      } else {
        teardown();
        clearMeasurement();
      }
    },

    setTarget(target) {
      const next = sanitizeLoudnessMeterSettings({ ...settings.get(), target });
      if (next.target === settings.get().target) return;
      writeLoudnessMeterSettings(deps.storage(), next);
      settings.set(next);
    },

    setPlaying(started, options = {}) {
      const next = Boolean(started);
      if (next === playing) return;
      playing = next;
      if (next) {
        if (!stoppedBySwitch) resetMeasurement();
        stoppedBySwitch = false;
        runtime.reattach();
        patchView({ playing: true });
      } else {
        stoppedBySwitch = Boolean(options.switching);
        patchView({ playing: false, snapshot: stoppedSnapshot(view.get().snapshot) });
      }
    },

    switchEnded(restarted) {
      if (!restarted && !playing) stoppedBySwitch = false;
    },

    reset() {
      resetMeasurement();
    },

    clearWarning() {
      if (!view.get().warning.lit && view.get().warning.reasons.length === 0) return;
      patchView({ warning: UNLIT });
    },

    init() {
      references++;
      ensureMeter();
    },

    releaseInstall() {
      if (references === 0) return;
      references--;
      if (references === 0) teardown();
    },

    installWhenReady(ready) {
      let cancelled = false;
      let acquired = false;
      Promise.resolve(ready)
        .then(() => {
          if (cancelled) return;
          runtime.init();
          acquired = true;
        })
        .catch((error: unknown) => console.error('[loudness] could not install:', error));
      return () => {
        if (cancelled) return;
        cancelled = true;
        if (acquired) runtime.releaseInstall();
      };
    },

    reattach() {
      if (!meter) return;
      followEqualizer();
      try {
        meter.attach(resolveSources());
      } catch (error: unknown) {
        console.warn('[loudness] could not attach the meter:', error);
      }
    },

    getMeter() {
      return meter;
    },

    destroy() {
      references = 0;
      teardown();
      playing = false;
      stoppedBySwitch = false;
      clearMeasurement();
      patchView({ playing: false });
    },
  };

  return runtime;
}

/**
 * superdough's destinationGain, without creating superdough's controller early: only once the main
 * AudioContext is running (see performance/levelMeter.ts defaultDestinationGain).
 */
function runningDestinationGain(): AudioNode | null {
  try {
    const ac = getAudioContext() as BaseAudioContext | undefined;
    if (!ac || ac.state !== 'running') return null;
    return (getSuperdoughAudioController()?.output?.destinationGain as AudioNode | undefined) ?? null;
  } catch (error: unknown) {
    return null;
  }
}

/** The website's loudness meter runtime (a module singleton). */
export const loudnessRuntime: LoudnessRuntime = createLoudnessRuntime({
  createMeter: (audioContext) => LufsMeter.create(audioContext),
  getAudioContext: () => getAudioContext() as BaseAudioContext,
  getEqualizer: () => getMainEqualizer(),
  subscribeEqualizer: subscribeMainEqualizer,
  destinationGain: runningDestinationGain,
  storage: browserStorage,
});

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  // Browser checks (tech §4): reach the meter, its sources and the store.
  (window as Window & { __strudelLoudness?: LoudnessRuntime }).__strudelLoudness = loudnessRuntime;
}
