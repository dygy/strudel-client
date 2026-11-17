/**
 * @spec: 033-loudness-meter (functional §2.1 sources, §2.3 reset, §2.4 latching warning, §2.6 history and
 *   on/off; tech §2.3, §3 track-switch reset trap, two mounts; §4 runtime)
 * The website's loudness runtime against a stand-in meter (no Web Audio): one meter for two installs,
 * attached to the EQ output (else destinationGain) and the limiter input, re-attached on EQ install /
 * remove / topology; Play after Stop resets, the instant switch's stop/start (through the real
 * evaluateNewTrack) does not, Update and transitions never toggle; Reset resets and drops a stale
 * snapshot; the warning latches until cleared; the history keeps 600 entries and freezes on Stop; off
 * destroys the meter.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LoudnessSnapshot } from '@strudel/mixer';
import {
  createLoudnessRuntime,
  LOUDNESS_HISTORY_LENGTH,
  type LoudnessRuntimeDeps,
  type LufsMeterLike,
  type MeterEqualizerLike,
} from '../loudnessRuntime';
import { LOUDNESS_METER_STORAGE_KEY } from '../meterSettings';
import { evaluateNewTrack } from '../../evaluateNewTrack';

const node = (id: string, context: unknown = null) => ({ id, context }) as unknown as AudioNode;

/** Like the worklet: measured time counts up 0.1 s per snapshot and restarts at reset. */
function fakeMeter() {
  let measured = 0;
  const attaches: Array<{ postEq: AudioNode | null; preLimiter: AudioNode | null }> = [];
  let listener: ((snapshot: LoudnessSnapshot) => void) | null = null;
  const meter = {
    attach: vi.fn((sources: { postEq?: AudioNode | null; preLimiter?: AudioNode | null } = {}) => {
      attaches.push({ postEq: sources.postEq ?? null, preLimiter: sources.preLimiter ?? null });
      return true;
    }),
    reset: vi.fn(() => {
      measured = 0;
    }),
    onSnapshot: vi.fn((cb: (snapshot: LoudnessSnapshot) => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    }),
    destroy: vi.fn(),
  } satisfies LufsMeterLike;
  const last = () => attaches[attaches.length - 1];
  const emit = (snapshot: LoudnessSnapshot) => {
    measured = Math.round((measured + 0.1) * 10) / 10;
    listener?.({ measuredSeconds: measured, ...snapshot });
  };
  return { meter, attaches, last, emit, listening: () => listener !== null };
}

function fakeEqualizer(id: string, enabled = true) {
  const output = node(`${id}-out`);
  const limiter = node(`${id}-limiter`);
  const listeners = new Set<() => void>();
  let on = enabled;
  const eq: MeterEqualizerLike & { setEnabled(on: boolean): void; listenerCount(): number } = {
    getOutput: () => output,
    getLimiterInput: () => (on ? limiter : null),
    onTopologyChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEnabled(next) {
      on = next;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
  return { eq, output, limiter };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
    data,
  };
}

/** A snapshot; its measuredSeconds comes from the fake meter unless given. */
function snap(patch: Partial<LoudnessSnapshot> = {}): LoudnessSnapshot {
  return {
    m: -20,
    s: -21,
    i: -22,
    lra: 3,
    tpMax: -3,
    tpBlock: -4,
    peakDb: [-6, -6],
    rmsDb: [-12, -12],
    events: { truePeak: 0, limiter: 0, clip: 0 },
    preLimiter: true,
    ...patch,
  } as LoudnessSnapshot;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(options: { storage?: ReturnType<typeof memoryStorage>; equalizer?: MeterEqualizerLike | null } = {}) {
  const storage = options.storage ?? memoryStorage();
  const meters: Array<ReturnType<typeof fakeMeter>> = [];
  let equalizer: MeterEqualizerLike | null = options.equalizer ?? null;
  const eqListeners = new Set<() => void>();
  let destinationGain: AudioNode | null = node('destinationGain');
  const ctx = { id: 'main-ac' } as unknown as BaseAudioContext;
  const createMeter = vi.fn(async () => {
    const m = fakeMeter();
    meters.push(m);
    return m.meter;
  });
  const deps: LoudnessRuntimeDeps = {
    createMeter,
    getAudioContext: () => ctx,
    getEqualizer: () => equalizer,
    subscribeEqualizer: (listener) => {
      eqListeners.add(listener);
      return () => eqListeners.delete(listener);
    },
    destinationGain: () => destinationGain,
    storage: () => storage as unknown as Storage,
    now: () => 1000,
  };
  const runtime = createLoudnessRuntime(deps);
  return {
    runtime,
    storage,
    meters,
    createMeter,
    meter: () => meters[meters.length - 1],
    setEqualizer(next: MeterEqualizerLike | null) {
      equalizer = next;
      eqListeners.forEach((listener) => listener());
    },
    setDestinationGain(next: AudioNode | null) {
      destinationGain = next;
    },
    eqListenerCount: () => eqListeners.size,
  };
}

async function installed(options: Parameters<typeof setup>[0] = {}) {
  const s = setup(options);
  s.runtime.init();
  await flush();
  return s;
}

describe('install (tech §2.3, §3 two mounts)', () => {
  it('two installs make one meter; it goes with the last release', async () => {
    const s = setup();
    const releaseA = s.runtime.installWhenReady(Promise.resolve());
    const releaseB = s.runtime.installWhenReady(Promise.resolve());
    await flush();
    expect(s.createMeter).toHaveBeenCalledTimes(1);
    expect(s.runtime.view.get().installed).toBe(true);
    releaseA();
    expect(s.meter().meter.destroy).not.toHaveBeenCalled();
    releaseB();
    expect(s.meter().meter.destroy).toHaveBeenCalledTimes(1);
    expect(s.runtime.getMeter()).toBeNull();
    expect(s.runtime.view.get().installed).toBe(false);
  });

  it('a release before the audio is ready cancels the install', async () => {
    const s = setup();
    let ready: () => void = () => {};
    const release = s.runtime.installWhenReady(new Promise<void>((resolve) => (ready = resolve)));
    release();
    ready();
    await flush();
    expect(s.createMeter).not.toHaveBeenCalled();
  });

  it('a meter that arrives after the last release is destroyed, not kept', async () => {
    const s = setup();
    s.runtime.init();
    s.runtime.releaseInstall();
    await flush();
    expect(s.meters).toHaveLength(1);
    expect(s.meter().meter.destroy).toHaveBeenCalledTimes(1);
    expect(s.runtime.getMeter()).toBeNull();
  });

  it('nothing is created while the meter is off', async () => {
    const storage = memoryStorage({ [LOUDNESS_METER_STORAGE_KEY]: JSON.stringify({ on: false, target: -14 }) });
    const s = await installed({ storage });
    expect(s.createMeter).not.toHaveBeenCalled();
  });
});

describe('sources (functional §2.1, tech §2.3)', () => {
  it('no EQ: destinationGain on input 0, nothing on input 1', async () => {
    const s = await installed();
    expect(s.meter().last()).toEqual({ postEq: expect.objectContaining({ id: 'destinationGain' }), preLimiter: null });
  });

  it('EQ on: its output and its limiter input; off: the output only', async () => {
    const { eq, output, limiter } = fakeEqualizer('eq1');
    const s = await installed({ equalizer: eq });
    expect(s.meter().last()).toEqual({ postEq: output, preLimiter: limiter });
    eq.setEnabled(false);
    expect(s.meter().last()).toEqual({ postEq: output, preLimiter: null });
    eq.setEnabled(true);
    expect(s.meter().last()).toEqual({ postEq: output, preLimiter: limiter });
  });

  it('follows the main EQ appearing, being replaced and going away', async () => {
    const s = await installed();
    const first = fakeEqualizer('eq1');
    s.setEqualizer(first.eq);
    expect(s.meter().last()).toEqual({ postEq: first.output, preLimiter: first.limiter });
    const second = fakeEqualizer('eq2');
    s.setEqualizer(second.eq);
    expect(s.meter().last()).toEqual({ postEq: second.output, preLimiter: second.limiter });
    expect(first.eq.listenerCount()).toBe(0); // stopped following the old EQ
    s.setEqualizer(null);
    expect(s.meter().last().postEq).toEqual(expect.objectContaining({ id: 'destinationGain' }));
    expect(second.eq.listenerCount()).toBe(0);
  });

  it('a replaced destinationGain (output reset, no event) is picked up on the next snapshot', async () => {
    const s = await installed();
    const fresh = node('destinationGain-2');
    s.setDestinationGain(fresh);
    s.meter().emit(snap());
    expect(s.meter().last().postEq).toBe(fresh);
  });

  it('a node on another context is never attached', async () => {
    const s = setup();
    const other = node('elsewhere', { id: 'preview-ac' });
    s.setDestinationGain(other);
    s.runtime.init();
    await flush();
    expect(s.meter().last()).toEqual({ postEq: null, preLimiter: null });
  });

  it('teardown unsubscribes from the main EQ and its topology', async () => {
    const { eq } = fakeEqualizer('eq1');
    const s = await installed({ equalizer: eq });
    expect(s.eqListenerCount()).toBe(1);
    expect(eq.listenerCount()).toBe(1);
    s.runtime.releaseInstall();
    expect(s.eqListenerCount()).toBe(0);
    expect(eq.listenerCount()).toBe(0);
    expect(s.meter().listening()).toBe(false);
  });
});

describe('reset rules (functional §2.3, tech §3)', () => {
  it('Play after Stop resets the meter, the history and the warning', async () => {
    const s = await installed();
    s.runtime.setPlaying(true);
    s.meter().meter.reset.mockClear();
    s.meter().emit(snap({ events: { truePeak: 1, limiter: 0, clip: 0 } }));
    expect(s.runtime.view.get().warning.lit).toBe(true);
    s.runtime.setPlaying(false);
    expect(s.meter().meter.reset).not.toHaveBeenCalled();
    s.runtime.setPlaying(true);
    expect(s.meter().meter.reset).toHaveBeenCalledTimes(1);
    expect(s.runtime.history.get()).toEqual([]);
    expect(s.runtime.view.get().warning.lit).toBe(false);
    expect(s.runtime.view.get().snapshot).toBeNull();
  });

  it('a stop flagged as a track switch does not reset on the restart', async () => {
    const s = await installed();
    s.runtime.setPlaying(true);
    s.meter().emit(snap({ i: -18 }));
    s.meter().meter.reset.mockClear();
    s.runtime.setPlaying(false, { switching: true });
    s.runtime.setPlaying(true);
    expect(s.meter().meter.reset).not.toHaveBeenCalled();
    expect(s.runtime.history.get()).toHaveLength(1);
    // The next real Stop and Play resets again.
    s.runtime.setPlaying(false);
    s.runtime.setPlaying(true);
    expect(s.meter().meter.reset).toHaveBeenCalledTimes(1);
  });

  it('a repeated start (no stop between) never resets', async () => {
    const s = await installed();
    s.runtime.setPlaying(true);
    s.meter().meter.reset.mockClear();
    s.runtime.setPlaying(true);
    expect(s.meter().meter.reset).not.toHaveBeenCalled();
  });

  /**
   * The instant switch through the real evaluateNewTrack and a scheduler stand-in that behaves like
   * core's Cyclist: stop() calls onToggle(false) synchronously; evaluate() on a stopped scheduler starts
   * it after an await (beforeStart) and calls onToggle(true); evaluate() on a started one only swaps the
   * pattern. onToggle reads the switching flag the way useReplContext's does.
   */
  function replHarness(runtime: ReturnType<typeof setup>['runtime']) {
    const restarting = { current: false };
    const toggles: boolean[] = [];
    const scheduler = { started: false };
    /** The next evaluate fails (the repl shows the error, resolves undefined, the scheduler isn't started). */
    const failNext = { current: false };
    const onToggle = (playing: boolean) => {
      toggles.push(playing);
      runtime.setPlaying(playing, { switching: restarting.current });
    };
    const repl = {
      scheduler,
      stop: () => {
        scheduler.started = false;
        onToggle(false);
      },
      evaluate: async () => {
        await Promise.resolve(); // the evaluate itself
        if (failNext.current) {
          failNext.current = false;
          return undefined;
        }
        if (!scheduler.started) {
          await Promise.resolve(); // Cyclist.start awaits beforeStart
          scheduler.started = true;
          onToggle(true);
        }
        return { pattern: true };
      },
    };
    const deps = {
      repl,
      globalSettings: () => ({ type: 'off' }) as never,
      controllerBusy: () => false,
      getController: () => null,
      flash: () => {},
      resetBeforeTransition: async () => {},
      cleanupCanvases: async () => {
        await Promise.resolve();
      },
      setRestarting: (value: boolean) => {
        restarting.current = value;
      },
      switchEnded: (restarted: boolean) => runtime.switchEnded(restarted),
    };
    return { repl, deps, toggles, scheduler, failNext };
  }

  it('the instant switch (spec 017) stops and restarts the scheduler without resetting Integrated', async () => {
    const s = await installed();
    const h = replHarness(s.runtime);
    await h.repl.evaluate(); // Play
    s.meter().emit(snap({ i: -18 }));
    s.meter().meter.reset.mockClear();
    const result = await evaluateNewTrack(h.deps, 'next track', { restart: true, prepare: async () => {} });
    expect(result).toBe('ok');
    expect(h.toggles).toEqual([true, false, true]); // it really does stop and start again
    expect(s.meter().meter.reset).not.toHaveBeenCalled();
    s.meter().emit(snap({ i: -18.5 }));
    expect(s.runtime.view.get().snapshot?.i).toBe(-18.5);
    expect(s.runtime.history.get()).toHaveLength(2);
  });

  it('an instant switch whose new code fails leaves the speakers stopped; the next Play resets (§2.3)', async () => {
    const s = await installed();
    const h = replHarness(s.runtime);
    await h.repl.evaluate(); // Play
    s.meter().emit(snap({ i: -18 }));
    s.meter().meter.reset.mockClear();
    h.failNext.current = true;
    expect(await evaluateNewTrack(h.deps, 'broken track', { restart: true })).toBe('failed');
    expect(h.toggles).toEqual([true, false]); // stopped, never restarted
    expect(h.scheduler.started).toBe(false);
    expect(s.meter().meter.reset).not.toHaveBeenCalled(); // I is kept while stopped
    await h.repl.evaluate(); // the user's Play
    expect(h.toggles).toEqual([true, false, true]);
    expect(s.meter().meter.reset).toHaveBeenCalledTimes(1);
    expect(s.runtime.history.get()).toEqual([]);
  });

  it('negative: switchEnded(true) after a restarted switch, or while playing, changes nothing', async () => {
    const s = await installed();
    s.runtime.setPlaying(true);
    s.meter().meter.reset.mockClear();
    s.runtime.setPlaying(false, { switching: true });
    s.runtime.switchEnded(true); // restarted: the flag must survive until the start
    s.runtime.setPlaying(true);
    expect(s.meter().meter.reset).not.toHaveBeenCalled();
    s.runtime.switchEnded(false); // already playing again: nothing to clear
    s.runtime.setPlaying(false, { switching: true });
    s.runtime.setPlaying(true);
    expect(s.meter().meter.reset).not.toHaveBeenCalled();
  });

  it('negative: the same stop/start read without the switching flag would reset (why onToggle reads it)', async () => {
    const s = await installed();
    s.runtime.setPlaying(true);
    s.meter().meter.reset.mockClear();
    s.runtime.setPlaying(false); // what an effect on `started` would see: the flag is already false
    s.runtime.setPlaying(true);
    expect(s.meter().meter.reset).toHaveBeenCalledTimes(1);
  });

  it('Update while playing hot-swaps without a toggle, so nothing resets', async () => {
    const s = await installed();
    const h = replHarness(s.runtime);
    await h.repl.evaluate(); // Play
    s.meter().meter.reset.mockClear();
    await h.repl.evaluate(); // Update
    expect(h.toggles).toEqual([true]);
    expect(s.meter().meter.reset).not.toHaveBeenCalled();
  });

  it('negative: Stop then Play through the same harness does reset', async () => {
    const s = await installed();
    const h = replHarness(s.runtime);
    await h.repl.evaluate();
    s.meter().meter.reset.mockClear();
    h.repl.stop();
    await h.repl.evaluate();
    expect(h.toggles).toEqual([true, false, true]);
    expect(s.meter().meter.reset).toHaveBeenCalledTimes(1);
  });

  it('Reset clears everything while measuring continues, and drops a snapshot from before it', async () => {
    const s = await installed();
    s.runtime.setPlaying(true);
    s.meter().emit(snap()); // the first after Play's own reset
    s.meter().emit(snap({ measuredSeconds: 30, i: -14, events: { truePeak: 0, limiter: 2, clip: 0 } }));
    expect(s.runtime.view.get().warning.lit).toBe(true);
    s.meter().meter.reset.mockClear();
    s.runtime.reset();
    expect(s.meter().meter.reset).toHaveBeenCalledTimes(1);
    expect(s.runtime.view.get().snapshot).toBeNull();
    expect(s.runtime.view.get().warning).toEqual({ lit: false, reasons: [] });
    expect(s.runtime.history.get()).toEqual([]);
    // In flight before the worklet handled the reset: ignored.
    s.meter().emit(snap({ measuredSeconds: 30.1, i: -14, events: { truePeak: 0, limiter: 2, clip: 0 } }));
    expect(s.runtime.view.get().snapshot).toBeNull();
    expect(s.runtime.view.get().warning.lit).toBe(false);
    // The first fresh one is taken, and so is what follows.
    s.meter().emit(snap({ measuredSeconds: 0.1, i: null }));
    expect(s.runtime.view.get().snapshot?.measuredSeconds).toBe(0.1);
    s.meter().emit(snap({ measuredSeconds: 0.2, i: -20 }));
    expect(s.runtime.view.get().snapshot?.i).toBe(-20);
    expect(s.runtime.history.get()).toHaveLength(2);
  });
});

describe('stopped (functional §2.3) and history (functional §2.6)', () => {
  it('Stop: M, S, peak and RMS silent; I, TP, LRA and counts kept; later snapshots not shown', async () => {
    const s = await installed();
    s.runtime.setPlaying(true);
    s.meter().emit(snap({ i: -16, tpMax: -1.5, lra: 4, events: { truePeak: 0, limiter: 3, clip: 0 } }));
    s.runtime.setPlaying(false);
    const shown = s.runtime.view.get().snapshot;
    expect(shown).toMatchObject({ m: null, s: null, i: -16, tpMax: -1.5, lra: 4, peakDb: [null, null] });
    expect(shown?.events.limiter).toBe(3);
    s.meter().emit(snap({ i: -30 }));
    expect(s.runtime.view.get().snapshot?.i).toBe(-16);
    expect(s.runtime.history.get()).toHaveLength(1);
  });

  it('keeps the last 600 entries (60 s at 10 Hz)', async () => {
    const s = await installed();
    s.runtime.setPlaying(true);
    for (let i = 0; i < LOUDNESS_HISTORY_LENGTH + 25; i++) s.meter().emit(snap({ s: -i }));
    const entries = s.runtime.history.get();
    expect(entries).toHaveLength(LOUDNESS_HISTORY_LENGTH);
    expect(entries[0].s).toBe(-25);
    expect(entries[entries.length - 1].s).toBe(-(LOUDNESS_HISTORY_LENGTH + 24));
  });

  it('nothing is recorded before the first Play', async () => {
    const s = await installed();
    s.meter().emit(snap());
    expect(s.runtime.history.get()).toEqual([]);
    expect(s.runtime.view.get().snapshot).toBeNull();
  });
});

describe('latching warning (functional §2.4)', () => {
  it('lights when a count rises, names the reasons, stays lit until cleared; counts stay', async () => {
    const s = await installed();
    s.runtime.setPlaying(true);
    s.meter().emit(snap());
    expect(s.runtime.view.get().warning.lit).toBe(false);
    s.meter().emit(snap({ events: { truePeak: 0, limiter: 1, clip: 0 } }));
    expect(s.runtime.view.get().warning).toEqual({ lit: true, reasons: ['limiter'] });
    expect(s.runtime.history.get().map((entry) => entry.warn)).toEqual([false, true]);
    s.meter().emit(snap({ events: { truePeak: 0, limiter: 1, clip: 0 } }));
    expect(s.runtime.view.get().warning.lit).toBe(true); // latched, nothing new
    s.meter().emit(snap({ events: { truePeak: 2, limiter: 1, clip: 0 } }));
    expect(s.runtime.view.get().warning.reasons).toEqual(['truePeak', 'limiter']);
    s.runtime.clearWarning();
    expect(s.runtime.view.get().warning).toEqual({ lit: false, reasons: [] });
    expect(s.runtime.view.get().snapshot?.events).toEqual({ truePeak: 2, limiter: 1, clip: 0 });
    s.meter().emit(snap({ events: { truePeak: 2, limiter: 1, clip: 0 } }));
    expect(s.runtime.view.get().warning.lit).toBe(false); // the same counts don't light it again
    s.meter().emit(snap({ events: { truePeak: 2, limiter: 1, clip: 1 } }));
    expect(s.runtime.view.get().warning).toEqual({ lit: true, reasons: ['clip'] });
  });
});

describe('on/off and target (functional §2.6)', () => {
  it('off destroys the meter and clears the readings; on installs a new one', async () => {
    const s = await installed();
    s.runtime.setPlaying(true);
    s.meter().emit(snap());
    const first = s.meter();
    s.runtime.setOn(false);
    expect(first.meter.destroy).toHaveBeenCalledTimes(1);
    expect(s.runtime.getMeter()).toBeNull();
    expect(s.runtime.view.get().snapshot).toBeNull();
    expect(JSON.parse(s.storage.data.get(LOUDNESS_METER_STORAGE_KEY) ?? '{}')).toEqual({ on: false, target: -14 });
    s.runtime.setOn(true);
    await flush();
    expect(s.meters).toHaveLength(2);
    expect(s.runtime.getMeter()).toBe(s.meter().meter);
  });

  it('off while the meter is still being created destroys it when it arrives', async () => {
    const s = setup();
    s.runtime.init();
    s.runtime.setOn(false);
    await flush();
    expect(s.meter().meter.destroy).toHaveBeenCalledTimes(1);
    expect(s.runtime.getMeter()).toBeNull();
  });

  it('the target is remembered, sanitised', async () => {
    const s = await installed();
    s.runtime.setTarget(-23);
    expect(JSON.parse(s.storage.data.get(LOUDNESS_METER_STORAGE_KEY) ?? '{}')).toEqual({ on: true, target: -23 });
    s.runtime.setTarget(null);
    expect(s.runtime.settings.get().target).toBeNull();
    s.runtime.setTarget(-5 as never);
    expect(s.runtime.settings.get().target).toBe(-14);
    const reloaded = setup({ storage: s.storage });
    expect(reloaded.runtime.settings.get()).toEqual({ on: true, target: -14 });
  });
});
