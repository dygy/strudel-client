/**
 * @spec: 032-master-fx (functional §2.1 where the effects act, §2.6 several holds at once; task 5.1)
 * The real MasterFx in the real superdough master insert slot, on the Web Audio mock, checked as a graph:
 *
 * - §2.1 recordings: the delay and reverb returns reach the speakers' destinationGain, the node the
 *   recorder, the EQ, the analyser and the meter tap (spec 026/030), so a throw is in the recording.
 * - §2.1 headphones: a PreviewEngine (its own controller, here even on the same context) is not routed
 *   through the stage; a delay throw while cueing reaches nothing of the headphones' chain.
 * - §2.6: with Delay and Beat-repeat held together the rolled slice goes into the delay (the worklet
 *   is before the split), and the echoes are not rolled again (the delay is after the worklet).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SuperdoughAudioController } from 'superdough';
import { MasterFx } from '../masterfx/MasterFx.mjs';
import { PreviewEngine } from '../PreviewEngine.mjs';
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

describe('Master FX routing (spec 032 §2.1, §2.6)', () => {
  let ac;
  let fx;
  let main;
  let preview;

  beforeEach(async () => {
    stubWebAudio();
    stubWebAudioNodeConstructors();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    ac = new MockAudioContext();
    ac.currentTime = 1;
    main = new SuperdoughAudioController(ac);
    fx = new MasterFx(ac, { random: () => 0.5, channelCount: ac.destination.channelCount });
    await fx.ready;
    main.setMasterInsert(fx.input, { output: fx.output, onChannelCount: (n) => fx.setChannelCount(n) });
  });
  afterEach(() => {
    preview?.destroy();
    preview = null;
    main.setMasterInsert(null);
    fx?.destroy();
    fx = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
    unstubWebAudio();
  });

  describe('§2.1 recordings include the FX', () => {
    it('the delay and reverb returns reach the speakers’ destinationGain (the recorder’s tap)', () => {
      const tap = main.output.destinationGain;
      expect(fx.delay).not.toBeNull();
      expect(reachable(fx.delay).has(tap)).toBe(true);
      expect(reachable(fx.reverb.convolver).has(tap)).toBe(true);
      expect(reachable(fx.delaySend).has(tap)).toBe(true);
      expect(reachable(fx.reverbSend).has(tap)).toBe(true);
    });

    it('negative: with the slot emptied the returns reach nothing of the speakers’ output', () => {
      main.setMasterInsert(null);
      const tap = main.output.destinationGain;
      expect(reachable(fx.delaySend).has(tap)).toBe(false);
      expect(reachable(fx.reverbSend).has(tap)).toBe(false);
      expect(reachable(main.output.channelMerger).has(fx.input)).toBe(false);
    });
  });

  describe('§2.1 the headphones are not affected', () => {
    async function startPreview() {
      preview = new PreviewEngine(ac, {
        SuperdoughAudioController,
        superdough: vi.fn(),
        repl: () => ({ evaluate: vi.fn(), stop: vi.fn(), scheduler: {} }),
        getTime: () => ac.currentTime,
      });
      await preview.initialize();
      return preview;
    }

    it('the speakers go through the stage (positive control)', () => {
      expect(reachable(main.output.channelMerger).has(fx.input)).toBe(true);
    });

    it('the headphones’ chain does not pass through the stage, and a delay throw while cueing reaches none of it', async () => {
      const p = await startPreview();
      const previewOut = p.controller.output;
      expect(previewOut.destinationGain).not.toBe(main.output.destinationGain);
      const fromPreview = reachable(previewOut.channelMerger);
      expect(fromPreview.has(fx.input)).toBe(false);
      expect(fromPreview.has(fx.output)).toBe(false);
      expect(fromPreview.has(p.mediaStreamDest)).toBe(true);

      fx.throwDelay(true);
      fx.throwReverb(true);
      const fromFx = reachable(fx.input);
      for (const node of [previewOut.destinationGain, p.volumeNode, p.mediaStreamDest]) {
        expect(fromFx.has(node)).toBe(false);
      }
    });

    it('a speakers reset keeps the stage on the speakers only', async () => {
      const p = await startPreview();
      main.reset();
      expect(reachable(main.output.channelMerger).has(fx.input)).toBe(true);
      expect(reachable(p.controller.output.channelMerger).has(fx.input)).toBe(false);
    });
  });

  describe('§2.6 Delay and Beat-repeat held together', () => {
    it('the rolled slice goes into the delay: the worklet feeds the delay send', () => {
      const worklet = ac.workletNodes.find((n) => n.name === 'beat-repeat-processor');
      expect(worklet).toBeDefined();
      expect(fx.roll({ startTime: 1, length: 0.5 })).toBe(true);
      fx.throwDelay(true);
      expect(reachable(worklet).has(fx.delaySend)).toBe(true);
      expect(reachable(worklet).has(fx.output)).toBe(true);
    });

    it('negative: the echoes are not rolled again (nothing after the split leads back into the worklet)', () => {
      const worklet = ac.workletNodes.find((n) => n.name === 'beat-repeat-processor');
      expect(reachable(fx.delaySend).has(worklet)).toBe(false);
      expect(reachable(fx.reverbSend).has(worklet)).toBe(false);
    });
  });
});
