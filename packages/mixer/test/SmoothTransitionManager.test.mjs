/**
 * Regression tests for SmoothTransitionManager.executeTransition.
 *
 * Bug (2026-10-09): with smooth transitions enabled, Update called
 * repl.stop() before evaluate(). Cyclist.stop() resets the clock and
 * lastEnd, so every Update restarted the pattern from cycle 0 (and onToggle
 * reset cps to 0.5) instead of hot-swapping at the current position.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SmoothTransitionManager } from '../SmoothTransitionManager.mjs';

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
