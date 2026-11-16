/**
 * @spec: 032-master-fx (tech §2.1 "Supradough across a reset", functional §2.1)
 * The `.supradough()` worklet is created once per page and played into superdough's merger through
 * `connectToDestination`. resetGlobalEffects() rebuilds the merger and destinationGain; before
 * spec 032 the worklet stayed on the old merger (silent, and outside any insert). Now it is kept:
 * after the reset it reaches the new destinationGain through the master insert.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockAudioContext, stubWebAudio, stubWebAudioNodeConstructors, unstubWebAudio } from './webAudioMock.mjs';

/** Every node reachable from `node` through `connections`. */
function reachable(node, seen = new Set()) {
  for (const next of node?.connections ?? []) {
    if (!seen.has(next)) {
      seen.add(next);
      reachable(next, seen);
    }
  }
  return seen;
}

describe('supradough reaches the master insert after resetGlobalEffects()', () => {
  let ac;

  beforeEach(() => {
    stubWebAudio();
    stubWebAudioNodeConstructors();
    ac = new MockAudioContext();
  });
  afterEach(() => {
    vi.doUnmock('../../superdough/audioContext.mjs');
    unstubWebAudio();
  });

  /** Fresh modules: the controller and the dough worklet are module state (isolate: false). */
  async function load() {
    vi.resetModules();
    vi.doMock('../../superdough/audioContext.mjs', () => ({
      getAudioContext: () => ac,
      setDefaultAudioContext: () => ac,
      getAudioContextCurrentTime: () => ac.currentTime,
    }));
    const superdough = await import('../../superdough/superdough.mjs');
    await import('../../webaudio/supradough.mjs');
    const core = await import('@strudel/core');
    return { ...superdough, core };
  }

  it('the dough worklet → merger → fx input → … → fx output → the new destinationGain', async () => {
    const { getSuperdoughAudioController, resetGlobalEffects, core } = await load();
    const controller = getSuperdoughAudioController();
    const fxIn = ac.createGain();
    const fxOut = ac.createGain();
    fxIn.connect(fxOut); // the stage's own wiring
    controller.setMasterInsert(fxIn, { output: fxOut });

    // One supradough trigger creates the worklet.
    const hap = core.pure({ s: 'x' }).supradough().queryArc(0, 1)[0];
    hap.context.onTrigger(hap, 0, 1, 0);
    const worklet = ac.workletNodes.find((n) => n.name === 'dough-processor');
    expect(worklet).toBeDefined();
    expect(reachable(worklet).has(fxIn)).toBe(true);
    expect(reachable(worklet).has(controller.output.destinationGain)).toBe(true);

    const oldGain = controller.output.destinationGain;
    resetGlobalEffects();
    const newGain = controller.output.destinationGain;
    expect(newGain).not.toBe(oldGain);
    const after = reachable(worklet);
    expect(after.has(controller.output.channelMerger)).toBe(true);
    expect(after.has(fxIn)).toBe(true);
    expect(after.has(newGain)).toBe(true);
    expect(after.has(oldGain)).toBe(false);
  });
});
