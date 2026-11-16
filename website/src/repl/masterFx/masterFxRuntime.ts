/**
 * Master FX for the speakers (spec 032 tech §2.5): the one MasterFx stage on the main AudioContext,
 * put into superdough's master insert slot,
 *
 *   track sound → scratch → [master FX] → destinationGain (Dip, transitions) → EQ → speakers volume
 *
 * so recordings, the analyser and the meter hear it and the headphones (preview engine) do not.
 *
 * - Install: like mainEqualizer.ts, once superdough's `audioReady` resolves, registered at mount so it
 *   is in place before the first evaluate; reference-counted because useReplContext mounts more than
 *   once. A controller without the slot (or a stage that fails to build) leaves the output as it was.
 * - Settings (resonance, delay, reverb, repeat length) are remembered in `strudel-master-fx`
 *   (masterFxSettings.ts, sanitised). The filter position is a separate atom that is never stored, so
 *   every load starts centred.
 * - Holds: Delay, Reverb, Beat-repeat and Brake are on while any holder holds them (`pointer:<id>`,
 *   `key`, `midi:<targetId>`). Losing the window (blur) or the tab going hidden releases every pointer
 *   and key holder; MIDI holds are released by the MIDI map (its hold kind). All FX off releases
 *   everything and centres the filter. Stop (the REPL going from started to stopped) releases every
 *   hold and fades the tails out.
 * - The delay follows the scheduler's tempo (polled; the stage glides it).
 * - Beat-repeat starts on the last grid line of its length, counted from the playing track's start as
 *   Snap does, at the cycle audible now (rollGrid.ts).
 * - Brake goes through the scratch runtime (scratchRuntime.brake): the speakers deck, the scratch
 *   Brake and Spin-up times. When it is refused the button is not lit.
 *
 * Nothing here touches a track's code, the editor, auth or a save path.
 */
import { atom, type ReadableAtom } from 'nanostores';
import { getAudioContext, getSuperdoughAudioController } from '@strudel/webaudio';
import { createMasterFx, setMasterInsert, type MasterFxLike, type MasterInsertHost } from './masterFxEngine';
import {
  clampFilterPosition,
  nextRepeatLength,
  readMasterFxSettings,
  sanitizeMasterFxSettings,
  writeMasterFxSettings,
  type MasterFxSettings,
} from './masterFxSettings';
import { rollGridStart } from './rollGrid';

export const MASTER_FX_EFFECTS = Object.freeze(['delay', 'reverb', 'repeat', 'brake'] as const);
export type MasterFxEffect = (typeof MASTER_FX_EFFECTS)[number];
export type MasterFxHeld = Record<MasterFxEffect, boolean>;

/** A settings change: any field, nested ones partly. */
export interface MasterFxSettingsPatch {
  resonance?: number;
  delay?: Partial<MasterFxSettings['delay']>;
  reverb?: Partial<MasterFxSettings['reverb']>;
  repeatLength?: number;
}

/** The main repl's scheduler, as the runtime reads it (core's Cyclist). */
export interface MasterFxScheduler {
  cps?: number;
  latency?: number;
  started?: boolean;
  now?: () => number;
  /** Cyclist's clock: `now()` lags it by `duration` s (absent on NeoCyclist). */
  clock?: { duration?: number } | null;
}

/** Where the runtime reads the tempo and the track's grid origin (set by useReplContext). */
export interface MasterFxReplSource {
  scheduler: () => MasterFxScheduler | null | undefined;
  /** The playing track's cycle 0 on the scheduler grid: the transition origin plus the scratch shift. */
  origin: () => number;
}

/** The scratch runtime's brake (spec 032 tech §2.4) and whether it still holds the speakers deck. */
export interface MasterFxBrakeTarget {
  brake(down: boolean): boolean;
  /** Called whenever the brake's state may have changed (the scratch store). Returns the unsubscribe. */
  watchBraking(listener: (braking: boolean) => void): () => void;
}

export interface MasterFxRuntimeDeps {
  createFx: (audioContext: AudioContext, options: { channelCount: number }) => MasterFxLike;
  storage: () => Storage | null;
  getAudioContext: () => AudioContext;
  getController: () => MasterInsertHost;
  /** Where `blur` is listened for (default none). */
  windowTarget?: EventTarget | null;
  /** Where `visibilitychange` is listened for, and whose `visibilityState` is read. */
  documentTarget?: (EventTarget & { visibilityState?: string }) | null;
  /** The tempo poll (default setInterval / clearInterval, every CPS_POLL_MS). */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export interface MasterFxRuntime {
  readonly settings: ReadableAtom<MasterFxSettings>;
  /** The filter knob, −100..100; 0 at every load (never stored). */
  readonly filter: ReadableAtom<number>;
  /** Which hold effects are on (lit on screen, whatever input holds them). */
  readonly held: ReadableAtom<MasterFxHeld>;
  setSettings(patch: MasterFxSettingsPatch): void;
  /**
   * Move the filter knob. `source` says who moved it (`midi:masterFx.filter` for its own MIDI control,
   * `'all-off'`, or none for the screen); filter listeners get it, so the MIDI map resets the knob's
   * pickup for every change that didn't come from that control.
   */
  setFilter(position: number, source?: string): void;
  /** Call `listener(position, source)` on every filter change. Returns the unsubscribe. */
  subscribeFilter(listener: (position: number, source: string | undefined) => void): () => void;
  /** `holder` holds `effect`. False when refused (a Brake the scratch deck refuses); then not lit. */
  hold(effect: MasterFxEffect, holder: string): boolean;
  /** `holder` lets go of `effect`; the effect stops when no holder is left. */
  release(effect: MasterFxEffect, holder: string): void;
  /** Every holder `match` accepts lets go, of every effect. */
  releaseHolders(match: (holder: string) => boolean): void;
  /** All FX off: every hold released, the filter centred. */
  allOff(): void;
  /** Repeat length 1/2 → 1/4 → 1/8 → 1/16 → 1/2 (the MIDI button). */
  stepRepeatLength(): void;
  /** The REPL started or stopped (Play/Stop). Stopping releases every hold and fades the tails. */
  setPlaying(playing: boolean): void;
  /**
   * Where the tempo and the grid origin are read. Returns the disconnect, which clears the source only
   * if it is still this one (useReplContext mounts more than once).
   */
  setReplSource(source: MasterFxReplSource | null): () => void;
  /** The scratch runtime's brake. Returns the disconnect (only if still this target). */
  setBrakeTarget(target: MasterFxBrakeTarget | null): () => void;
  /** Read the tempo now and pass a change to the stage (the poll calls this). */
  syncCps(): void;
  /** Acquire: create and insert the stage on first use. Pair every call with `releaseInstall()`. */
  init(audioContext?: AudioContext, controller?: MasterInsertHost): MasterFxLike | null;
  releaseInstall(): void;
  /** Install once `ready` resolves; returns the release (which cancels a pending install). */
  installWhenReady(ready: Promise<unknown> | undefined, init?: () => unknown): () => void;
  /** The installed stage, or null. */
  getFx(): MasterFxLike | null;
  /** Tests and hot reload: take the stage out whatever the count, drop holds and listeners. */
  destroy(): void;
}

/** How often the tempo is read (ms). The stage glides the delay time, so this needn't be faster. */
export const CPS_POLL_MS = 100;
const DEFAULT_CPS = 0.5;

const NONE_HELD: MasterFxHeld = Object.freeze({ delay: false, reverb: false, repeat: false, brake: false });

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A pointer or keyboard holder: released when the window loses focus or the tab goes hidden. */
export const isScreenHolder = (holder: string): boolean => holder === 'key' || holder.startsWith('pointer:');

export function createMasterFxRuntime(deps: MasterFxRuntimeDeps): MasterFxRuntime {
  const settings = atom<MasterFxSettings>(readMasterFxSettings(deps.storage()));
  const filter = atom<number>(0);
  const held = atom<MasterFxHeld>(NONE_HELD);
  const holders: Record<MasterFxEffect, Set<string>> = {
    delay: new Set(),
    reverb: new Set(),
    repeat: new Set(),
    brake: new Set(),
  };

  let fx: MasterFxLike | null = null;
  let installedOn: MasterInsertHost | null = null;
  let installedContext: AudioContext | null = null;
  let references = 0;
  let pollHandle: unknown = null;
  let lastCps: number | null = null;
  let playing = false;
  let replSource: MasterFxReplSource | null = null;
  let brakeTarget: MasterFxBrakeTarget | null = null;
  let unwatchBraking: (() => void) | null = null;
  const filterListeners = new Set<(position: number, source: string | undefined) => void>();

  const publish = () => {
    const next: MasterFxHeld = {
      delay: holders.delay.size > 0,
      reverb: holders.reverb.size > 0,
      repeat: holders.repeat.size > 0,
      brake: holders.brake.size > 0,
    };
    const current = held.get();
    if (MASTER_FX_EFFECTS.some((effect) => current[effect] !== next[effect])) held.set(next);
  };

  /** Run a stage call; a failing stage is warned about, never thrown into the UI or MIDI. */
  const onFx = (what: string, call: (stage: MasterFxLike) => void) => {
    if (!fx) return;
    try {
      call(fx);
    } catch (error: unknown) {
      console.warn(`[masterFx] ${what} failed:`, error);
    }
  };

  const readScheduler = (): MasterFxScheduler | null => {
    try {
      return replSource?.scheduler() ?? null;
    } catch (error: unknown) {
      console.warn('[masterFx] reading the scheduler failed:', error);
      return null;
    }
  };

  const currentCps = (): number => {
    const cps = readScheduler()?.cps;
    return finite(cps) && cps > 0 ? cps : DEFAULT_CPS;
  };

  const startRoll = () => {
    const ctx = installedContext;
    if (!fx || !ctx) return;
    const lengthCycles = settings.get().repeatLength;
    const scheduler = readScheduler();
    const cps = currentCps();
    let origin = 0;
    try {
      origin = replSource?.origin() ?? 0;
    } catch (error: unknown) {
      console.warn('[masterFx] reading the track origin failed:', error);
    }
    let nowCycle: number | null = null;
    if (scheduler?.started && typeof scheduler.now === 'function') {
      try {
        nowCycle = scheduler.now();
      } catch (error: unknown) {
        console.warn('[masterFx] reading the scheduler cycle failed:', error);
      }
    }
    const grid =
      nowCycle === null
        ? null
        : rollGridStart({
            nowCycle,
            cps,
            latency: scheduler?.latency ?? 0,
            clockDuration: scheduler?.clock?.duration ?? 0,
            ctxTime: ctx.currentTime,
            originCycle: origin,
            lengthCycles,
          });
    // Without a playing scheduler there is no grid: the slice starts now.
    const startTime = grid ? grid.startTime : ctx.currentTime;
    const length = grid ? grid.lengthSeconds : lengthCycles / cps;
    onFx('roll', (stage) => stage.roll({ startTime, length }));
  };

  /** The effect goes on. Only the brake can be refused. */
  const engage = (effect: MasterFxEffect): boolean => {
    switch (effect) {
      case 'delay':
        onFx('delay throw', (stage) => stage.throwDelay(true));
        return true;
      case 'reverb':
        onFx('reverb throw', (stage) => stage.throwReverb(true));
        return true;
      case 'repeat':
        startRoll();
        return true;
      case 'brake':
        try {
          return Boolean(brakeTarget?.brake(true));
        } catch (error: unknown) {
          console.warn('[masterFx] brake failed:', error);
          return false;
        }
    }
  };

  const disengage = (effect: MasterFxEffect) => {
    switch (effect) {
      case 'delay':
        onFx('delay throw', (stage) => stage.throwDelay(false));
        break;
      case 'reverb':
        onFx('reverb throw', (stage) => stage.throwReverb(false));
        break;
      case 'repeat':
        onFx('roll stop', (stage) => stage.roll(null));
        break;
      case 'brake':
        try {
          brakeTarget?.brake(false);
        } catch (error: unknown) {
          console.warn('[masterFx] brake release failed:', error);
        }
        break;
    }
  };

  /** Give a new stage everything that is set and held now. */
  const applyAll = () => {
    const s = settings.get();
    onFx('settings', (stage) => {
      stage.setResonance(s.resonance);
      stage.setDelay({ ...s.delay });
      stage.setReverb({ ...s.reverb });
      stage.setFilter(filter.get());
    });
    lastCps = null;
    runtime.syncCps();
    if (holders.delay.size) onFx('delay throw', (stage) => stage.throwDelay(true));
    if (holders.reverb.size) onFx('reverb throw', (stage) => stage.throwReverb(true));
    if (holders.repeat.size) startRoll();
  };

  const stopPoll = () => {
    if (pollHandle === null) return;
    (deps.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>)))(pollHandle);
    pollHandle = null;
  };

  const teardown = () => {
    stopPoll();
    if (installedOn && fx) {
      try {
        setMasterInsert(installedOn, null);
      } catch (error: unknown) {
        console.warn('[masterFx] could not take the stage out:', error);
      }
    }
    const stage = fx;
    fx = null;
    installedOn = null;
    installedContext = null;
    lastCps = null;
    try {
      stage?.destroy();
    } catch (error: unknown) {
      console.warn('[masterFx] could not destroy the stage:', error);
    }
  };

  const onBlur = () => runtime.releaseHolders(isScreenHolder);
  const onVisibility = () => {
    if (deps.documentTarget?.visibilityState === 'hidden') runtime.releaseHolders(isScreenHolder);
  };
  deps.windowTarget?.addEventListener('blur', onBlur);
  deps.documentTarget?.addEventListener('visibilitychange', onVisibility);

  const runtime: MasterFxRuntime = {
    settings,
    filter,
    held,

    setSettings(patch) {
      const current = settings.get();
      const p = patch && typeof patch === 'object' ? patch : {};
      const next = sanitizeMasterFxSettings({
        ...current,
        ...p,
        delay: { ...current.delay, ...(p.delay ?? {}) },
        reverb: { ...current.reverb, ...(p.reverb ?? {}) },
      });
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      writeMasterFxSettings(deps.storage(), next);
      settings.set(next);
      if (next.resonance !== current.resonance) onFx('resonance', (stage) => stage.setResonance(next.resonance));
      if (JSON.stringify(next.delay) !== JSON.stringify(current.delay))
        onFx('delay settings', (stage) => stage.setDelay({ ...next.delay }));
      if (JSON.stringify(next.reverb) !== JSON.stringify(current.reverb))
        onFx('reverb settings', (stage) => stage.setReverb({ ...next.reverb }));
      // §2.4: a new length while held applies from the next repeat.
      if (next.repeatLength !== current.repeatLength && holders.repeat.size) {
        onFx('roll length', (stage) => stage.setRollLength(next.repeatLength / currentCps()));
      }
    },

    setFilter(position, source) {
      const next = clampFilterPosition(position);
      if (next === filter.get()) return;
      filter.set(next);
      onFx('filter', (stage) => stage.setFilter(next));
      for (const listener of [...filterListeners]) {
        try {
          listener(next, source);
        } catch (error: unknown) {
          console.warn('[masterFx] filter listener failed:', error);
        }
      }
    },

    subscribeFilter(listener) {
      filterListeners.add(listener);
      return () => {
        filterListeners.delete(listener);
      };
    },

    hold(effect, holder) {
      const set = holders[effect];
      if (!set || typeof holder !== 'string' || holder === '') return false;
      if (set.has(holder)) return true;
      if (set.size === 0 && !engage(effect)) return false;
      set.add(holder);
      publish();
      return true;
    },

    release(effect, holder) {
      const set = holders[effect];
      if (!set || !set.delete(holder)) return;
      if (set.size === 0) disengage(effect);
      publish();
    },

    releaseHolders(match) {
      for (const effect of MASTER_FX_EFFECTS) {
        const set = holders[effect];
        if (set.size === 0) continue;
        for (const holder of [...set]) if (match(holder)) set.delete(holder);
        if (set.size === 0) disengage(effect);
      }
      publish();
    },

    allOff() {
      runtime.releaseHolders(() => true);
      runtime.setFilter(0, 'all-off');
    },

    stepRepeatLength() {
      runtime.setSettings({ repeatLength: nextRepeatLength(settings.get().repeatLength) });
    },

    setPlaying(next) {
      const was = playing;
      playing = Boolean(next);
      if (was && !playing) {
        runtime.releaseHolders(() => true);
        onFx('stop tails', (stage) => stage.stopTails());
      }
    },

    setReplSource(source) {
      replSource = source;
      runtime.syncCps();
      return () => {
        if (replSource === source) replSource = null;
      };
    },

    setBrakeTarget(target) {
      unwatchBraking?.();
      unwatchBraking = null;
      if (brakeTarget && brakeTarget !== target && holders.brake.size) {
        // The old target's hold goes with it.
        disengage('brake');
        holders.brake.clear();
        publish();
      }
      brakeTarget = target;
      if (target) {
        // The deck let go by itself (Stop, a deck switch, a track switch): the button goes dark.
        unwatchBraking = target.watchBraking((braking) => {
          if (braking || holders.brake.size === 0) return;
          holders.brake.clear();
          publish();
        });
      }
      return () => {
        if (brakeTarget === target && target) runtime.setBrakeTarget(null);
      };
    },

    syncCps() {
      if (!fx) return;
      const cps = currentCps();
      if (cps === lastCps) return;
      const previous = lastCps;
      lastCps = cps;
      onFx('tempo', (stage) => stage.setCps(cps));
      if (previous !== null && holders.repeat.size) {
        onFx('roll length', (stage) => stage.setRollLength(settings.get().repeatLength / cps));
      }
    },

    init(audioContext = deps.getAudioContext(), controller = deps.getController()) {
      references++;
      if (fx && installedOn === controller && installedContext === audioContext) return fx;
      teardown();
      let stage: MasterFxLike;
      try {
        const channelCount = audioContext?.destination?.channelCount || 2;
        stage = deps.createFx(audioContext, { channelCount });
      } catch (error: unknown) {
        console.error('[masterFx] could not create the stage:', error);
        return null;
      }
      try {
        if (typeof controller?.setMasterInsert !== 'function') throw new Error('no master insert slot');
        setMasterInsert(controller, stage, (channels) => {
          try {
            stage.setChannelCount(channels);
          } catch (error: unknown) {
            console.warn('[masterFx] could not resize the stage:', error);
          }
        });
      } catch (error: unknown) {
        console.error('[masterFx] could not insert the stage:', error);
        try {
          stage.destroy();
        } catch (destroyError: unknown) {
          console.warn('[masterFx] stage cleanup failed:', destroyError);
        }
        return null;
      }
      fx = stage;
      installedOn = controller;
      installedContext = audioContext;
      applyAll();
      const every = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
      pollHandle = every(() => runtime.syncCps(), CPS_POLL_MS);
      return fx;
    },

    releaseInstall() {
      if (references === 0) return;
      references--;
      if (references === 0) teardown();
    },

    installWhenReady(ready, init = () => runtime.init()) {
      let cancelled = false;
      let acquired = false;
      Promise.resolve(ready)
        .then(() => {
          if (cancelled) return;
          init();
          acquired = true;
        })
        .catch((error: unknown) => console.error('[masterFx] could not install:', error));
      return () => {
        if (cancelled) return;
        cancelled = true;
        if (acquired) runtime.releaseInstall();
      };
    },

    getFx() {
      return fx;
    },

    destroy() {
      references = 0;
      for (const effect of MASTER_FX_EFFECTS) holders[effect].clear();
      publish();
      teardown();
      runtime.setBrakeTarget(null);
      replSource = null;
      playing = false;
      filter.set(0);
      filterListeners.clear();
      deps.windowTarget?.removeEventListener('blur', onBlur);
      deps.documentTarget?.removeEventListener('visibilitychange', onVisibility);
    },
  };

  return runtime;
}

const browserStorage = (): Storage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (error: unknown) {
    return null;
  }
};

/** The website's Master FX runtime (a module singleton). */
export const masterFxRuntime: MasterFxRuntime = createMasterFxRuntime({
  createFx: createMasterFx,
  storage: browserStorage,
  getAudioContext: () => getAudioContext(),
  getController: () => getSuperdoughAudioController() as unknown as MasterInsertHost,
  windowTarget: typeof window !== 'undefined' ? window : null,
  documentTarget: typeof document !== 'undefined' ? document : null,
});

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  // Browser checks (tech §4): reach the stage and the holds.
  (window as Window & { __strudelMasterFx?: MasterFxRuntime }).__strudelMasterFx = masterFxRuntime;
}
