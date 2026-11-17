/**
 * @spec: 033-loudness-meter (functional §2.3 "A track switch inside a set doesn't reset anything: the set
 *   playlist's Go, transitions and the manual crossfader"; tech §2.3 reset rules, §3 track switch reset trap)
 * A set's Go runs through the real evaluateNewTrack with `keepOldOnFailure: true` and the item's transition
 * (useReplContext's runUpdate). Every way it can reach the speakers must leave Integrated accumulating:
 * an item transition and Off-as-Cut through the controller (no scheduler toggle), the crossfader's manual
 * mix, and the two instant fallbacks (no controller; a controller that throws), which stop and restart the
 * scheduler under `setRestarting`. The negative pair: a Go while the speakers are stopped is a Play after
 * Stop, so it resets.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LoudnessSnapshot } from '@strudel/mixer';
import { createLoudnessRuntime, type LufsMeterLike } from '../loudnessRuntime';
import { evaluateNewTrack, type EvaluateNewTrackDeps, type SwitchingController } from '../../evaluateNewTrack';
import { DEFAULT_TRANSITION, type TransitionSettings } from '../../transitionSettings';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** A runtime with a stand-in meter whose measured time counts 0.1 s per snapshot and restarts at reset. */
async function installedRuntime() {
  let listener: ((snapshot: LoudnessSnapshot) => void) | null = null;
  let measured = 0;
  const meter = {
    attach: vi.fn(() => true),
    reset: vi.fn(() => {
      measured = 0;
    }),
    onSnapshot: (cb: (snapshot: LoudnessSnapshot) => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    destroy: vi.fn(),
  } satisfies LufsMeterLike;
  const runtime = createLoudnessRuntime({
    createMeter: async () => meter,
    getAudioContext: () => ({}) as BaseAudioContext,
    getEqualizer: () => null,
    subscribeEqualizer: () => () => {},
    destinationGain: () => null,
    storage: () => null,
    now: () => 0,
  });
  runtime.init();
  await flush();
  const emit = (i: number) => {
    measured = Math.round((measured + 0.1) * 10) / 10;
    listener?.({
      m: -14,
      s: -14,
      i,
      lra: 2,
      tpMax: -2,
      tpBlock: -3,
      peakDb: [-3, -3],
      rmsDb: [-12, -12],
      events: { truePeak: 0, limiter: 0, clip: 0 },
      preLimiter: true,
      measuredSeconds: measured,
    });
  };
  return { runtime, meter, emit };
}

/**
 * useReplContext's wiring around evaluateNewTrack: the scheduler behaves like core's Cyclist (stop() calls
 * onToggle(false) synchronously; evaluate() on a stopped scheduler starts it after an await and calls
 * onToggle(true); on a started one it only swaps the pattern), onToggle passes the restarting flag to the
 * meter as `switching`, and the controller swaps patterns without touching the scheduler (as
 * TrackTransitionController does).
 */
function harness(
  runtime: Awaited<ReturnType<typeof installedRuntime>>['runtime'],
  {
    global = DEFAULT_TRANSITION,
    controller = 'ok',
  }: { global?: TransitionSettings; controller?: 'ok' | 'throws' | 'none' } = {},
) {
  const restarting = { current: false };
  const toggles: boolean[] = [];
  const scheduler = { started: false };
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
      await Promise.resolve();
      if (!scheduler.started) {
        await Promise.resolve(); // Cyclist.start awaits beforeStart
        scheduler.started = true;
        onToggle(true);
      }
      return { pattern: true };
    },
  };
  const switchTo = vi.fn<SwitchingController['switchTo']>(async () => {
    await Promise.resolve();
    if (controller === 'throws') throw new Error('audio graph not ready'); // not an evaluate failure
    return undefined;
  });
  const beginManual = vi.fn(async () => {
    await Promise.resolve();
    return {};
  });
  const ctrl: SwitchingController = {
    busy: false,
    switchTo,
    beginManual,
  };
  const deps: EvaluateNewTrackDeps = {
    repl,
    globalSettings: () => global,
    controllerBusy: () => false,
    getController: () => (controller === 'none' ? null : ctrl),
    flash: () => {},
    resetBeforeTransition: async () => {},
    cleanupCanvases: async () => {
      await Promise.resolve();
    },
    setRestarting: (value: boolean) => {
      restarting.current = value;
    },
  };
  /** The set's Go as runUpdate makes it (force → keepOldOnFailure). */
  const go = (
    options: { transition?: { type: 'crossfade' | 'cut' | 'off'; length: 4 } | null; manual?: boolean } = {},
  ) =>
    evaluateNewTrack(deps, 'next item', {
      restart: true,
      keepOldOnFailure: true,
      transition: options.transition ?? null,
      manual: options.manual ?? false,
    });
  return { repl, go, toggles, switchTo, beginManual };
}

/** Play, measure a little, and forget the Play's own reset. */
async function playing(controller: 'ok' | 'throws' | 'none' = 'ok', global?: TransitionSettings) {
  const s = await installedRuntime();
  const h = harness(s.runtime, { controller, global });
  await h.repl.evaluate();
  s.emit(-15);
  s.meter.reset.mockClear();
  return { ...s, ...h };
}

describe('§2.3 a set Go never resets Integrated', () => {
  it('Go with the item’s Crossfade: the controller mixes, the scheduler is not toggled, I keeps accumulating', async () => {
    const s = await playing();
    expect(await s.go({ transition: { type: 'crossfade', length: 4 } })).toBe('ok');
    expect(s.switchTo).toHaveBeenCalledTimes(1);
    expect(s.toggles).toEqual([true]);
    expect(s.meter.reset).not.toHaveBeenCalled();
    s.emit(-14.6);
    expect(s.runtime.view.get().snapshot?.i).toBe(-14.6);
    expect(s.runtime.history.get()).toHaveLength(2); // before and after the Go: one history
  });

  it('Go on Off while playing runs as a Cut through the controller (spec 022): no toggle, no reset', async () => {
    const s = await playing();
    expect(await s.go()).toBe('ok');
    expect(s.switchTo).toHaveBeenCalledTimes(1);
    expect(s.switchTo.mock.calls[0][1]).toMatchObject({ type: 'cut' });
    expect(s.toggles).toEqual([true]);
    expect(s.meter.reset).not.toHaveBeenCalled();
  });

  it('the crossfader’s manual Go (spec 031): beginManual, no toggle, no reset', async () => {
    const s = await playing();
    expect(await s.go({ manual: true })).toBe('ok');
    expect(s.beginManual).toHaveBeenCalledTimes(1);
    expect(s.toggles).toEqual([true]);
    expect(s.meter.reset).not.toHaveBeenCalled();
  });

  it('a Go whose transition throws falls back to the instant switch: stop + start, still no reset', async () => {
    const s = await playing('throws', { ...DEFAULT_TRANSITION, type: 'crossfade' });
    expect(await s.go()).toBe('ok');
    expect(s.toggles).toEqual([true, false, true]); // it really stopped and started again
    expect(s.meter.reset).not.toHaveBeenCalled();
    s.emit(-14.9);
    expect(s.runtime.view.get().snapshot?.i).toBe(-14.9);
  });

  it('a Go with no controller yet takes the instant path: stop + start, still no reset', async () => {
    const s = await playing('none');
    expect(await s.go({ transition: { type: 'crossfade', length: 4 } })).toBe('ok');
    expect(s.toggles).toEqual([true, false, true]);
    expect(s.meter.reset).not.toHaveBeenCalled();
  });

  it('negative: a Go while the speakers are stopped is a Play after Stop, so it resets', async () => {
    const s = await playing();
    s.repl.stop();
    expect(s.meter.reset).not.toHaveBeenCalled(); // Stop alone never resets
    expect(await s.go({ transition: { type: 'crossfade', length: 4 } })).toBe('ok');
    expect(s.switchTo).not.toHaveBeenCalled(); // nothing playing: the instant path, no restart
    expect(s.toggles).toEqual([true, false, true]);
    expect(s.meter.reset).toHaveBeenCalledTimes(1);
    expect(s.runtime.view.get().snapshot).toBeNull();
  });
});
