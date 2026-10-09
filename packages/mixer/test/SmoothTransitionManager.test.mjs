/**
 * Tests for SmoothTransitionManager (spec 015 §2.1 plus the executeTransition regression).
 *
 * Bug (2026-10-09): with smooth transitions enabled, Update called
 * repl.stop() before evaluate(). Cyclist.stop() resets the clock and
 * lastEnd, so every Update restarted the pattern from cycle 0 (and onToggle
 * reset cps to 0.5) instead of hot-swapping at the current position.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmoothTransitionManager } from '../SmoothTransitionManager.mjs';
import { MockAudioContext, stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';

// A fake repl with the one property that matters: stop() loses the position.
function createFakeRepl() {
  const repl = {
    cycle: 7.25, // mid-performance
    started: true,
    calls: [],
    stop: vi.fn(() => {
      repl.calls.push('stop');
      repl.cycle = 0;
      repl.started = false;
    }),
    // Async like the real repl.evaluate: the pattern is only swapped on a later tick.
    evaluate: vi.fn(async (code) => {
      repl.calls.push(`evaluate:${code}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      repl.calls.push('setPattern');
      if (!repl.started) {
        repl.started = true; // autostart from wherever the clock is — 0 after stop()
      }
    }),
  };
  return repl;
}

function createManager(repl, { evaluateThrows = false } = {}) {
  const gain = {
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  const audioContext = { currentTime: 0, state: 'running', resume: vi.fn() };
  if (evaluateThrows) {
    repl.evaluate.mockImplementation(() => {
      throw new Error('syntax error');
    });
  }
  const manager = new SmoothTransitionManager(audioContext, repl, {
    destinationGain: { gain },
    cleanupCanvases: vi.fn(() => repl.calls.push('cleanup')),
    enabled: true,
    duration: 0.5,
  });
  // The fades are real Web Audio ramps plus a wall-clock wait; their timing is not under test.
  vi.spyOn(manager, 'fadeDown').mockImplementation(async () => repl.calls.push('fadeDown'));
  vi.spyOn(manager, 'fadeUp').mockImplementation(async () => repl.calls.push('fadeUp'));
  return { manager, gain };
}

describe('SmoothTransitionManager.executeTransition', () => {
  let repl;

  beforeEach(() => {
    repl = createFakeRepl();
  });

  it('hot-swaps the code without stopping, so playback keeps its cycle position', async () => {
    const { manager } = createManager(repl);

    await manager.executeTransition('s("bd sd")');

    expect(repl.stop).not.toHaveBeenCalled();
    expect(repl.evaluate).toHaveBeenCalledTimes(1);
    expect(repl.evaluate).toHaveBeenCalledWith('s("bd sd")');
    expect(repl.cycle).toBe(7.25);
    expect(repl.started).toBe(true);
  });

  it('fades down, cleans up, then fades up only after the new pattern is in place', async () => {
    const { manager } = createManager(repl);

    await manager.executeTransition('s("hh*4")');

    // fadeUp before setPattern would ramp the OLD pattern back up, then cut to the new one.
    expect(repl.calls).toEqual(['fadeDown', 'cleanup', 'evaluate:s("hh*4")', 'setPattern', 'fadeUp']);
  });

  it('restores volume and rethrows if evaluate rejects (defensive: repl.evaluate normally reports pattern errors itself)', async () => {
    const { manager, gain } = createManager(repl, { evaluateThrows: true });

    await expect(manager.executeTransition('broken(')).rejects.toThrow('syntax error');

    expect(repl.stop).not.toHaveBeenCalled();
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(1, 0);
    expect(manager.getSettings().isTransitioning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Spec 015 §2.1 — settings, fades, queue, failure. Real fades on the recording
// AudioParam mock; wall-clock waits driven by fake timers.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'strudel-smooth-transitions';

/** Instant changes to `target`: setValueAtTime(target) or a direct `.value = target` write. */
const jumpsTo = (gain, target) =>
  gain.calls.filter(([m, v]) => (m === 'setValueAtTime' || m === 'value=') && v === target);

/** A manager over a MockAudioContext whose destination gain records every automation call. */
function createRealFadeManager(options = {}, repl = { evaluate: vi.fn(async () => {}) }) {
  const ctx = new MockAudioContext();
  const destinationGain = ctx.createGain();
  const manager = new SmoothTransitionManager(ctx, repl, { destinationGain, ...options });
  return { manager, ctx, gain: destinationGain.gain, repl };
}

/** Simulate a page reload: a fresh instance reading the same localStorage, no constructor overrides. */
function reload() {
  return createRealFadeManager().manager;
}

describe('SmoothTransitionManager settings (spec 015 §2.1)', () => {
  beforeEach(() => stubWebAudio());
  afterEach(() => unstubWebAudio());

  it('a fade length of 30 s is shown as 10 s after a reload', () => {
    createRealFadeManager().manager.updateSettings({ duration: 30 });

    expect(reload().getSettings().duration).toBe(10);
  });

  it('a fade length inside 0.5–10 s is kept as set, not clamped', () => {
    createRealFadeManager().manager.updateSettings({ duration: 3 });

    expect(reload().getSettings().duration).toBe(3);
  });

  it('a fade length of 0.1 s is used as 0.5 s', () => {
    const { manager } = createRealFadeManager();
    manager.updateSettings({ duration: 0.1 });

    expect(manager.getSettings().duration).toBe(0.5);
    expect(reload().getSettings().duration).toBe(0.5);
  });

  it('smooth transitions turned on are still on after a reload, with the same fade length', () => {
    createRealFadeManager().manager.updateSettings({ enabled: true, duration: 4 });

    expect(reload().getSettings()).toMatchObject({ enabled: true, duration: 4 });
  });

  it('with nothing saved, a reload starts switched off with a 2 s fade', () => {
    expect(reload().getSettings()).toMatchObject({ enabled: false, duration: 2 });
  });

  it('unreadable saved settings start switched off with a 2 s fade and no error', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');

    let manager;
    expect(() => {
      manager = reload();
    }).not.toThrow();
    expect(manager.getSettings()).toMatchObject({ enabled: false, duration: 2 });
  });

  it('a saved fade length that is not a number falls back to 2 s without throwing', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: true, duration: 'abc' }));

    expect(reload().getSettings()).toMatchObject({ enabled: true, duration: 2 });
  });
});

describe('SmoothTransitionManager fades glide, never jump (spec 015 §2.1)', () => {
  beforeEach(() => {
    stubWebAudio();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    unstubWebAudio();
  });

  it('fade-out ramps the volume to 0 over the chosen fade length', async () => {
    const { manager, ctx, gain } = createRealFadeManager();
    ctx.currentTime = 5;

    const done = manager.fadeDown(2);

    expect(gain.calls).toEqual([
      ['cancelScheduledValues', 5],
      ['setValueAtTime', 1, 5], // anchor at the CURRENT level, not the target
      ['linearRampToValueAtTime', 0, 7],
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(done).resolves.toBeUndefined();
  });

  it('fade-out never sets silence in one step, and does not finish before the fade length', async () => {
    const { manager, ctx, gain } = createRealFadeManager();
    ctx.currentTime = 5;
    let finished = false;

    manager.fadeDown(2).then(() => (finished = true));

    expect(jumpsTo(gain, 0)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toBe(true);
  });

  it('fade-in ramps the volume from 0 back to full over the chosen fade length', async () => {
    const { manager, ctx, gain } = createRealFadeManager();
    ctx.currentTime = 9;

    const done = manager.fadeUp(3, 1);

    expect(gain.calls).toEqual([
      ['cancelScheduledValues', 9],
      ['setValueAtTime', 0, 9],
      ['linearRampToValueAtTime', 1, 12],
    ]);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(done).resolves.toBeUndefined();
  });

  it('fade-in never sets full volume in one step, and does not finish before the fade length', async () => {
    const { manager, ctx, gain } = createRealFadeManager();
    ctx.currentTime = 9;
    let finished = false;

    manager.fadeUp(3, 1).then(() => (finished = true));

    expect(jumpsTo(gain, 1)).toEqual([]);
    await vi.advanceTimersByTimeAsync(2999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toBe(true);
  });

  it('a full transition uses the configured fade length for both ramps', async () => {
    const { manager, gain } = createRealFadeManager({ enabled: true, duration: 3 });

    const done = manager.executeTransition('s("bd")');
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    const ramps = gain.calls.filter(([m]) => m === 'linearRampToValueAtTime');
    expect(ramps).toEqual([
      ['linearRampToValueAtTime', 0, 3],
      ['linearRampToValueAtTime', 1, 3],
    ]);
  });
});

describe('SmoothTransitionManager queue and failure (spec 015 §2.1)', () => {
  beforeEach(() => {
    stubWebAudio();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    unstubWebAudio();
  });

  it('two more switches during a fade: only the last one plays after the fade', async () => {
    const { manager, repl } = createRealFadeManager({ enabled: true, duration: 1 });

    const first = manager.executeTransition('A');
    await vi.advanceTimersByTimeAsync(500); // mid fade-out
    await manager.executeTransition('B');
    await manager.executeTransition('C');
    await vi.advanceTimersByTimeAsync(10_000);
    await first;

    expect(repl.evaluate.mock.calls.map(([code]) => code)).toEqual(['A', 'C']);
  });

  it('two more switches during a fade: the middle one never plays, and nothing plays before the fade ends', async () => {
    const { manager, repl } = createRealFadeManager({ enabled: true, duration: 1 });

    const first = manager.executeTransition('A');
    await vi.advanceTimersByTimeAsync(500);
    await manager.executeTransition('B');
    await manager.executeTransition('C');

    expect(repl.evaluate).not.toHaveBeenCalled(); // waits for the running fade-out
    await vi.advanceTimersByTimeAsync(10_000);
    await first;
    expect(repl.evaluate).not.toHaveBeenCalledWith('B');
  });

  it('a new track failing after fade-out restores full volume immediately', async () => {
    const repl = {
      evaluate: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const { manager, ctx, gain } = createRealFadeManager({ enabled: true, duration: 2 }, repl);

    const settled = manager.executeTransition('broken(').catch((e) => e);
    await vi.advanceTimersByTimeAsync(2000); // fade-out done
    ctx.currentTime = 2;
    await vi.advanceTimersByTimeAsync(100);
    const err = await settled;

    expect(err).toBeInstanceOf(Error);
    expect(gain.calls.slice(-2)).toEqual([
      ['cancelScheduledValues', 2],
      ['setValueAtTime', 1, 2],
    ]);
    expect(gain.value).toBe(1);
  });

  it('a new track failing after fade-out does not leave volume at silence or fade it back slowly', async () => {
    const repl = {
      evaluate: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const { manager, gain } = createRealFadeManager({ enabled: true, duration: 2 }, repl);

    const settled = manager.executeTransition('broken(').catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;

    const ramps = gain.calls.filter(([m]) => m === 'linearRampToValueAtTime');
    expect(ramps).toEqual([['linearRampToValueAtTime', 0, 2]]); // only the fade-out; no fade-up ramp
    expect(gain.value).not.toBe(0);
    expect(manager.getSettings().isTransitioning).toBe(false);
  });
});
