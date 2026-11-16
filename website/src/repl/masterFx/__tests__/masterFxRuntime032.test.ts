/**
 * @spec: 032-master-fx (§2.2 filter not remembered, §2.3 throws + Stop, §2.4 roll grid, §2.5 brake,
 *   §2.6 holds and auto-release, §2.8 All FX off; tech §2.5, §4)
 * The website's Master FX runtime against a stand-in stage (no Web Audio): installed once (ref-counted)
 * into the master insert slot, settings sanitised and stored, the filter never stored, holds with several
 * holders, blur / hidden releasing only pointer and key holders, All FX off, Stop → stopTails, the tempo
 * followed, the roll starting on the audible grid line, and a refused brake not lit.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MasterFxLike, MasterInsertHost } from '../masterFxEngine';
import { createMasterFxRuntime, type MasterFxRuntimeDeps, type MasterFxScheduler } from '../masterFxRuntime';
import { MASTER_FX_DEFAULTS, MASTER_FX_STORAGE_KEY } from '../masterFxSettings';

function fakeFx() {
  const calls: Array<[string, unknown]> = [];
  const record =
    (name: string) =>
    (arg?: unknown): void => {
      calls.push([name, arg]);
    };
  const fx = {
    input: { id: 'in' } as unknown as AudioNode,
    output: { id: 'out' } as unknown as AudioNode,
    setFilter: record('setFilter'),
    setResonance: record('setResonance'),
    setDelay: record('setDelay'),
    setReverb: record('setReverb'),
    setCps: record('setCps'),
    throwDelay: record('throwDelay'),
    throwReverb: record('throwReverb'),
    roll: record('roll'),
    setRollLength: record('setRollLength'),
    stopTails: record('stopTails'),
    setChannelCount: record('setChannelCount'),
    destroy: record('destroy'),
  } satisfies MasterFxLike;
  const of = (name: string) => calls.filter(([n]) => n === name).map(([, arg]) => arg);
  return { fx, calls, of };
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

function setup(options: { storage?: ReturnType<typeof memoryStorage> } = {}) {
  const storage = options.storage ?? memoryStorage();
  const stage = fakeFx();
  const ctx = { currentTime: 50, destination: { channelCount: 2 } } as unknown as AudioContext;
  const inserts: Array<{ node: AudioNode | null; options?: Parameters<MasterInsertHost['setMasterInsert']>[1] }> = [];
  const controller: MasterInsertHost = {
    setMasterInsert: (node, opts) => {
      inserts.push({ node, options: opts });
    },
  };
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const ticks: Array<() => void> = [];
  const createFx = vi.fn(() => stage.fx);
  const deps: MasterFxRuntimeDeps = {
    createFx,
    storage: () => storage as unknown as Storage,
    getAudioContext: () => ctx,
    getController: () => controller,
    windowTarget: win,
    documentTarget: doc,
    setInterval: (fn) => {
      ticks.push(fn);
      return ticks.length;
    },
    clearInterval: () => {
      ticks.length = 0;
    },
  };
  const runtime = createMasterFxRuntime(deps);
  return { runtime, stage, ctx, controller, inserts, win, doc, ticks, storage, createFx };
}

describe('install (ref-counted, master insert slot)', () => {
  it('creates one stage, inserts input + output with a channel-count hook, and removes it with the last release', () => {
    const { runtime, stage, inserts, createFx } = setup();
    runtime.init();
    runtime.init();
    expect(createFx).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].node).toBe(stage.fx.input);
    expect(inserts[0].options?.output).toBe(stage.fx.output);
    inserts[0].options?.onChannelCount?.(6);
    expect(stage.of('setChannelCount')).toEqual([6]);
    runtime.releaseInstall();
    expect(stage.of('destroy')).toHaveLength(0);
    runtime.releaseInstall();
    expect(inserts.at(-1)?.node).toBeNull();
    expect(stage.of('destroy')).toHaveLength(1);
    expect(runtime.getFx()).toBeNull();
  });

  it('applies the stored settings, the centred filter and the tempo to a new stage', () => {
    const storage = memoryStorage({
      [MASTER_FX_STORAGE_KEY]: JSON.stringify({ resonance: 0.6, delay: { fraction: 0.25, feedback: 0.4, level: 0.5 } }),
    });
    const { runtime, stage } = setup({ storage });
    runtime.init();
    expect(stage.of('setResonance')).toEqual([0.6]);
    expect(stage.of('setDelay')).toEqual([{ fraction: 0.25, feedback: 0.4, level: 0.5 }]);
    expect(stage.of('setReverb')).toEqual([{ ...MASTER_FX_DEFAULTS.reverb }]);
    expect(stage.of('setFilter')).toEqual([0]);
    expect(stage.of('setCps')).toEqual([0.5]);
  });

  it('a controller without the slot leaves the output alone: the stage is destroyed, nothing throws', () => {
    const { runtime, stage } = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runtime.init(undefined, {} as MasterInsertHost)).toBeNull();
    expect(stage.of('destroy')).toHaveLength(1);
    errors.mockRestore();
  });

  it('installWhenReady installs after ready resolves; a release before that cancels it', async () => {
    const a = setup();
    const releaseA = a.runtime.installWhenReady(Promise.resolve());
    await Promise.resolve();
    await Promise.resolve();
    expect(a.runtime.getFx()).toBe(a.stage.fx);
    releaseA();
    expect(a.runtime.getFx()).toBeNull();

    const b = setup();
    let resolve!: () => void;
    const releaseB = b.runtime.installWhenReady(new Promise<void>((r) => (resolve = r)));
    releaseB();
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(b.createFx).not.toHaveBeenCalled();
  });
});

describe('settings (stored in strudel-master-fx, sanitised) and the filter (never stored)', () => {
  it('a change is stored, reaches the stage, and garbage falls back to the defaults', () => {
    const { runtime, stage, storage } = setup();
    runtime.init();
    runtime.setSettings({ delay: { feedback: 0.8 } });
    expect(JSON.parse(storage.getItem(MASTER_FX_STORAGE_KEY)!).delay).toEqual({
      ...MASTER_FX_DEFAULTS.delay,
      feedback: 0.8,
    });
    expect(stage.of('setDelay').at(-1)).toEqual({ ...MASTER_FX_DEFAULTS.delay, feedback: 0.8 });
    runtime.setSettings({ resonance: 7, reverb: { decay: Number.NaN } });
    expect(runtime.settings.get().resonance).toBe(MASTER_FX_DEFAULTS.resonance);
    expect(runtime.settings.get().reverb.decay).toBe(MASTER_FX_DEFAULTS.reverb.decay);
  });

  it('a damaged save loads as the defaults; a reload starts with the filter centred', () => {
    const damaged = memoryStorage({ [MASTER_FX_STORAGE_KEY]: '{not json' });
    expect(setup({ storage: damaged }).runtime.settings.get()).toEqual(MASTER_FX_DEFAULTS);

    const storage = memoryStorage();
    const first = setup({ storage });
    first.runtime.setFilter(-60);
    first.runtime.setSettings({ resonance: 0.8 });
    expect(first.runtime.filter.get()).toBe(-60);
    const reloaded = setup({ storage });
    expect(reloaded.runtime.filter.get()).toBe(0);
    expect(reloaded.runtime.settings.get().resonance).toBe(0.8);
    expect([...storage.data.values()].join()).not.toContain('-60');
  });

  it('the filter clamps to −100..100 and reaches the stage', () => {
    const { runtime, stage } = setup();
    runtime.init();
    runtime.setFilter(-250);
    expect(runtime.filter.get()).toBe(-100);
    expect(stage.of('setFilter').at(-1)).toBe(-100);
  });

  it('Repeat length steps 1/2 → 1/4 → 1/8 → 1/16 → 1/2', () => {
    const { runtime } = setup();
    runtime.setSettings({ repeatLength: 1 / 2 });
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      runtime.stepRepeatLength();
      seen.push(runtime.settings.get().repeatLength);
    }
    expect(seen).toEqual([1 / 4, 1 / 8, 1 / 16, 1 / 2]);
  });
});

describe('holds (§2.6)', () => {
  it('an effect is on while any holder holds it; the send opens once and closes with the last holder', () => {
    const { runtime, stage } = setup();
    runtime.init();
    expect(runtime.hold('delay', 'pointer:1')).toBe(true);
    runtime.hold('delay', 'midi:masterFx.delay');
    expect(stage.of('throwDelay')).toEqual([true]);
    expect(runtime.held.get().delay).toBe(true);
    runtime.release('delay', 'pointer:1');
    expect(runtime.held.get().delay).toBe(true);
    expect(stage.of('throwDelay')).toEqual([true]);
    runtime.release('delay', 'midi:masterFx.delay');
    expect(runtime.held.get().delay).toBe(false);
    expect(stage.of('throwDelay')).toEqual([true, false]);
  });

  it('several effects at once (Delay plus Beat-repeat): both act', () => {
    const { runtime, stage } = setup();
    runtime.init();
    runtime.hold('delay', 'key');
    runtime.hold('repeat', 'pointer:2');
    expect(runtime.held.get()).toMatchObject({ delay: true, repeat: true });
    expect(stage.of('throwDelay')).toEqual([true]);
    expect(stage.of('roll')).toHaveLength(1);
  });

  it('window blur releases pointer and key holders, not MIDI ones', () => {
    const { runtime, stage, win } = setup();
    runtime.init();
    runtime.hold('delay', 'pointer:1');
    runtime.hold('reverb', 'key');
    runtime.hold('repeat', 'midi:masterFx.repeat');
    win.dispatchEvent(new Event('blur'));
    expect(runtime.held.get()).toEqual({ delay: false, reverb: false, repeat: true, brake: false });
    expect(stage.of('throwDelay')).toEqual([true, false]);
    expect(stage.of('throwReverb')).toEqual([true, false]);
  });

  it('the tab going hidden releases them too; visible again does nothing', () => {
    const { runtime, doc } = setup();
    runtime.init();
    runtime.hold('delay', 'pointer:1');
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(runtime.held.get().delay).toBe(true);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(runtime.held.get().delay).toBe(false);
  });

  it('All FX off releases every hold (MIDI ones too) and centres the filter', () => {
    const { runtime, stage } = setup();
    runtime.init();
    runtime.hold('delay', 'midi:masterFx.delay');
    runtime.hold('repeat', 'pointer:1');
    runtime.setFilter(-40);
    runtime.allOff();
    expect(runtime.held.get()).toEqual({ delay: false, reverb: false, repeat: false, brake: false });
    expect(runtime.filter.get()).toBe(0);
    expect(stage.of('roll').at(-1)).toBeNull();
    expect(stage.of('setFilter').at(-1)).toBe(0);
  });

  it('Stop (started → stopped) releases every hold and fades the tails; staying stopped does not', () => {
    const { runtime, stage } = setup();
    runtime.init();
    runtime.setPlaying(false);
    expect(stage.of('stopTails')).toHaveLength(0);
    runtime.setPlaying(true);
    runtime.hold('delay', 'midi:masterFx.delay');
    runtime.setPlaying(false);
    expect(stage.of('stopTails')).toHaveLength(1);
    expect(runtime.held.get().delay).toBe(false);
    expect(stage.of('throwDelay')).toEqual([true, false]);
  });
});

describe('tempo and the roll grid', () => {
  function withScheduler(scheduler: MasterFxScheduler, origin = 0) {
    const ctx = setup();
    ctx.runtime.init();
    ctx.runtime.setReplSource({ scheduler: () => scheduler, origin: () => origin });
    return ctx;
  }

  it('follows the scheduler tempo on the poll; a held roll gets the new slice length', () => {
    const scheduler: MasterFxScheduler = { cps: 0.5, started: true, latency: 0, now: () => 1 };
    const { runtime, stage, ticks } = withScheduler(scheduler);
    runtime.hold('repeat', 'pointer:1');
    scheduler.cps = 1;
    ticks.forEach((tick) => tick());
    expect(stage.of('setCps')).toEqual([0.5, 1]);
    expect(stage.of('setRollLength')).toEqual([0.25]);
    ticks.forEach((tick) => tick());
    expect(stage.of('setCps')).toEqual([0.5, 1]);
  });

  it('the roll starts on the last grid line of the audible cycle, counted from the track origin', () => {
    // cps 0.5, latency 0.1 s, scheduled cycle 10.5 → audible 10.45; origin 10.1, length 1/4 → line 10.35.
    const { runtime, stage, ctx } = withScheduler({ cps: 0.5, started: true, latency: 0.1, now: () => 10.5 }, 10.1);
    runtime.hold('repeat', 'pointer:1');
    const [roll] = stage.of('roll') as Array<{ startTime: number; length: number }>;
    expect(roll.length).toBeCloseTo(0.5, 9);
    expect(roll.startTime).toBeCloseTo(ctx.currentTime - 0.1 / 0.5, 9);
  });

  it('reads the Cyclist clock duration from the scheduler (review 032 #1)', () => {
    // audible = 10.5 + (0.05 − 0.1)·0.5 = 10.475; origin 10.1, length 1/4 → line 10.35, 0.125 cycles back.
    const { runtime, stage, ctx } = withScheduler(
      { cps: 0.5, started: true, latency: 0.1, clock: { duration: 0.05 }, now: () => 10.5 },
      10.1,
    );
    runtime.hold('repeat', 'pointer:1');
    const [roll] = stage.of('roll') as Array<{ startTime: number; length: number }>;
    expect(roll.startTime).toBeCloseTo(ctx.currentTime - 0.125 / 0.5, 9);
  });

  it('a new length while held applies from the next repeat (setRollLength)', () => {
    const { runtime, stage } = withScheduler({ cps: 0.5, started: true, latency: 0, now: () => 1 });
    runtime.hold('repeat', 'pointer:1');
    runtime.setSettings({ repeatLength: 1 / 8 });
    expect(stage.of('setRollLength')).toEqual([0.25]);
    expect(stage.of('roll')).toHaveLength(1);
  });

  it('without a playing scheduler the slice starts now', () => {
    const { runtime, stage, ctx } = withScheduler({ cps: 0.5, started: false, now: () => 0 });
    runtime.hold('repeat', 'key');
    expect(stage.of('roll')).toEqual([{ startTime: ctx.currentTime, length: 0.5 }]);
  });

  it('a disconnected source is cleared only by its own disconnect', () => {
    const { runtime, stage } = setup();
    runtime.init();
    const disconnectOld = runtime.setReplSource({ scheduler: () => ({ cps: 0.25 }), origin: () => 0 });
    runtime.setReplSource({ scheduler: () => ({ cps: 1 }), origin: () => 0 });
    disconnectOld();
    runtime.syncCps();
    expect(stage.of('setCps').at(-1)).toBe(1);
  });
});

describe('brake (through the scratch runtime)', () => {
  function withBrake(accept: boolean) {
    const ctx = setup();
    const listeners = new Set<(braking: boolean) => void>();
    const brake = vi.fn((down: boolean) => (down ? accept : false));
    ctx.runtime.setBrakeTarget({
      brake,
      watchBraking: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    return { ...ctx, brake, emit: (braking: boolean) => listeners.forEach((l) => l(braking)) };
  }

  it('hold → brake(true), release → brake(false); lit while held', () => {
    const { runtime, brake } = withBrake(true);
    expect(runtime.hold('brake', 'pointer:1')).toBe(true);
    expect(runtime.held.get().brake).toBe(true);
    runtime.release('brake', 'pointer:1');
    expect(brake.mock.calls).toEqual([[true], [false]]);
    expect(runtime.held.get().brake).toBe(false);
  });

  it('refused by the scratch deck (platter held): not lit, nothing to release', () => {
    const { runtime, brake } = withBrake(false);
    expect(runtime.hold('brake', 'pointer:1')).toBe(false);
    expect(runtime.held.get().brake).toBe(false);
    runtime.release('brake', 'pointer:1');
    expect(brake.mock.calls).toEqual([[true]]);
  });

  it('the deck let go by itself (a deck switch): the button goes dark', () => {
    const { runtime, emit } = withBrake(true);
    runtime.hold('brake', 'midi:masterFx.brake');
    emit(true);
    expect(runtime.held.get().brake).toBe(true);
    emit(false);
    expect(runtime.held.get().brake).toBe(false);
  });

  it('without a brake target the Brake is refused', () => {
    const { runtime } = setup();
    expect(runtime.hold('brake', 'key')).toBe(false);
  });
});
