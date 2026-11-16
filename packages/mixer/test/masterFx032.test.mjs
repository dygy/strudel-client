/**
 * @spec: 032-master-fx (functional §2.1–2.4, tech §2.2, §3 "Audio graph", tech §4)
 * The MasterFx stage on the Web Audio mock: graph at rest (exact pass-through edges, zero wet and
 * sends), the filter's dry/wet crossfade and glides, the throws' 10 ms send ramps, the tempo-synced
 * delay, the reverb's debounced crossfaded convolver swap, stopTails, the beat-repeat worklet
 * (pass-through until loaded, crossfaded in, roll messages, channel-count rebuild), destroy()
 * disconnecting everything, no node growth over repeated updates, and the real superdough master
 * insert slot.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SuperdoughAudioController } from 'superdough';
import {
  MasterFx,
  makeReverbImpulse,
  MASTER_FX_SEND_RAMP_SECONDS,
  MASTER_FX_STOP_RESTORE_MS,
  MASTER_FX_REVERB_DEBOUNCE_MS,
} from '../masterfx/MasterFx.mjs';
import { MockAudioContext, stubWebAudio, stubWebAudioNodeConstructors, unstubWebAudio } from './webAudioMock.mjs';

/** Every AudioParam of a mock node. */
const paramsOf = (node) => Object.values(node).filter((v) => v && Array.isArray(v.calls));
/** The last call of a given method on a param. */
const last = (param, method) => [...param.calls].reverse().find((c) => c[0] === method);

describe('MasterFx', () => {
  let ac;
  let fx;

  beforeEach(() => {
    stubWebAudio();
    stubWebAudioNodeConstructors();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    ac = new MockAudioContext();
    ac.currentTime = 1;
  });
  afterEach(() => {
    fx?.destroy();
    fx = null;
    vi.useRealTimers();
    unstubWebAudio();
  });

  const create = (options = {}) => (fx = new MasterFx(ac, { random: () => 0.5, ...options }));

  describe('at rest', () => {
    it('input → bypass → filter → dry → split → output; wet and both sends are exactly 0', () => {
      create({ workletReady: false });
      expect(fx.input.connections).toEqual([fx.bypass]);
      expect(fx.bypass.connections).toEqual([fx.filterIn]);
      expect(fx.filterIn.connections).toEqual([fx.dry, fx.lowpass]);
      expect(fx.dry.connections).toEqual([fx.split]);
      expect(fx.split.connections).toEqual([fx.output, fx.delaySend, fx.reverbSend]);
      expect(fx.dry.gain.value).toBe(1);
      expect(fx.wet.gain.value).toBe(0);
      expect(fx.delaySend.gain.value).toBe(0);
      expect(fx.reverbSend.gain.value).toBe(0);
      expect(fx.output.gain.value).toBe(1);
    });

    it('no param anywhere is ever written with a jump (.value =)', () => {
      create({ workletReady: false });
      fx.setFilter(-60);
      fx.setResonance(0.9);
      fx.setFilter(40);
      fx.setFilter(0);
      fx.throwDelay(true);
      fx.throwReverb(true);
      fx.setDelay({ fraction: 1 / 4, feedback: 0.3, level: 0.5 });
      fx.setReverb({ decay: 6, level: 0.2 });
      fx.setCps(0.7);
      fx.stopTails();
      vi.runAllTimers();
      for (const node of ac.createdNodes) {
        for (const param of paramsOf(node)) expect(param.calls.filter((c) => c[0] === 'value=')).toEqual([]);
      }
    });
  });

  describe('filter (functional §2.2)', () => {
    beforeEach(() => create({ workletReady: false }));

    it('inside the dead zone nothing moves (negative): ±2 and 0 leave dry 1, wet 0, no automation', () => {
      const before = fx.wet.gain.calls.length;
      fx.setFilter(2);
      fx.setFilter(-2);
      fx.setFilter(0);
      expect(fx.wet.gain.calls.length).toBe(before);
      expect(fx.dry.gain.calls.length).toBe(0);
    });

    it('leaving the dead zone: cutoffs set open, a 10 ms linear dry→wet crossfade, then a τ 15 ms glide', () => {
      fx.setFilter(-50);
      expect(last(fx.wet.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 1, 1.01]);
      expect(last(fx.dry.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 0, 1.01]);
      const lp = fx.lowpass.frequency.calls;
      const open = lp.findIndex((c) => c[0] === 'setValueAtTime' && c[1] === 20000 && c[2] === 1);
      const glide = lp.findIndex((c) => c[0] === 'setTargetAtTime');
      expect(open).toBeGreaterThanOrEqual(0);
      expect(glide).toBeGreaterThan(open);
      expect(lp[glide][1]).toBeCloseTo(20000 * Math.pow(150 / 20000, 47 / 97), 6);
      expect(lp[glide].slice(2)).toEqual([1.01, 0.015]);
      expect(last(fx.lowpass.Q, 'setTargetAtTime')[1]).toBeCloseTo(0.707 + 0.3 * 7.3, 9);
    });

    it('crossing the centre stays wet: the low-pass opens while the high-pass closes, no new crossfade', () => {
      fx.setFilter(-50);
      ac.currentTime = 2;
      const wetCalls = fx.wet.gain.calls.length;
      fx.setFilter(50);
      expect(fx.wet.gain.calls.length).toBe(wetCalls);
      expect(last(fx.lowpass.frequency, 'setTargetAtTime')).toEqual(['setTargetAtTime', 20000, 2, 0.015]);
      expect(last(fx.highpass.frequency, 'setTargetAtTime')[1]).toBeCloseTo(20 * Math.pow(300, 47 / 97), 6);
      expect(last(fx.lowpass.Q, 'setTargetAtTime')[1]).toBe(0.707);
    });

    it('back to the centre: a 10 ms crossfade to dry', () => {
      fx.setFilter(30);
      ac.currentTime = 3;
      fx.setFilter(1);
      expect(last(fx.wet.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 0, 3.01]);
      expect(last(fx.dry.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 1, 3.01]);
    });

    it('re-entering while the wet path still fades out glides from where it is (no jump to open)', () => {
      fx.setFilter(-90);
      ac.currentTime = 2;
      fx.setFilter(0); // wet silent from 2.01
      ac.currentTime = 2.005;
      const before = fx.lowpass.frequency.calls.length;
      fx.setFilter(-90);
      const added = fx.lowpass.frequency.calls.slice(before);
      expect(added.some((c) => c[0] === 'setValueAtTime' && c[1] === 20000)).toBe(false);
    });

    it('resonance glides Q while the filter is on, and is only stored while off (negative)', () => {
      fx.setResonance(1);
      expect(fx.lowpass.Q.calls.filter((c) => c[0] === 'setTargetAtTime')).toEqual([]);
      fx.setFilter(-40);
      expect(last(fx.lowpass.Q, 'setTargetAtTime')[1]).toBeCloseTo(8.007, 9);
      fx.setResonance(0);
      expect(last(fx.lowpass.Q, 'setTargetAtTime')[1]).toBeCloseTo(0.707, 9);
      fx.setResonance(NaN); // ignored
      expect(fx.resonance).toBe(0);
    });
  });

  describe('delay throw (functional §2.3)', () => {
    beforeEach(() => create({ workletReady: false }));

    it('the send opens and closes by 10 ms linear ramps; the dry path is untouched', () => {
      fx.throwDelay(true);
      expect(last(fx.delaySend.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 1, 1.01]);
      ac.currentTime = 1.5;
      fx.throwDelay(false);
      expect(last(fx.delaySend.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 0, 1.51]);
      expect(MASTER_FX_SEND_RAMP_SECONDS).toBeLessThanOrEqual(0.01);
      expect(fx.dry.gain.calls).toEqual([]);
      expect(fx.output.gain.calls).toEqual([]);
      expect(fx.split.connections).toContain(fx.output);
    });

    it('cps 0.5 and 3/16: 0.375 s, feedback 0.55, level 0.7; a loop delay → feedback → delay', () => {
      expect(fx.delay.delayTime.value).toBe(0.375);
      expect(fx.feedback.gain.value).toBe(0.55);
      expect(fx.delayLevel.gain.value).toBe(0.7);
      expect(fx.delaySend.connections).toEqual([fx.delay]);
      expect(fx.delay.connections).toEqual([fx.feedback, fx.delayLevel]);
      expect(fx.feedback.connections).toEqual([fx.delay]);
      expect(fx.delayLevel.connections).toEqual([fx.output]);
      expect(fx.delay.maxDelayTime).toBe(4);
    });

    it('follows the tempo and the fraction by a τ 50 ms glide, clamped to 4 s', () => {
      fx.setCps(1);
      expect(last(fx.delay.delayTime, 'setTargetAtTime')).toEqual(['setTargetAtTime', 0.1875, 1, 0.05]);
      fx.setDelay({ fraction: 3 / 8 });
      expect(last(fx.delay.delayTime, 'setTargetAtTime')[1]).toBe(0.375);
      fx.setCps(0.05);
      expect(last(fx.delay.delayTime, 'setTargetAtTime')[1]).toBe(4);
    });

    it('invalid settings are ignored (negative): feedback 0.95, a 0.2 fraction, cps 0 or NaN', () => {
      const calls = fx.delay.delayTime.calls.length;
      fx.setDelay({ fraction: 0.2, feedback: 0.95, level: 2 });
      fx.setCps(0);
      fx.setCps(NaN);
      expect(fx.delaySettings).toEqual({ fraction: 3 / 16, feedback: 0.55, level: 0.7 });
      expect(fx.delay.delayTime.calls.length).toBe(calls);
    });

    it('feedback and level changes ramp (20 ms linear)', () => {
      fx.setDelay({ feedback: 0.3, level: 0.5 });
      expect(last(fx.feedback.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 0.3, 1.02]);
      expect(last(fx.delayLevel.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 0.5, 1.02]);
    });
  });

  describe('reverb throw (functional §2.3)', () => {
    it('the impulse response: stereo, decay long, noise × exp(−6.9 t / decay)', () => {
      const ir = makeReverbImpulse(ac, 2, () => 1);
      expect(ir.numberOfChannels).toBe(2);
      expect(ir.length).toBe(96000);
      const d = ir.getChannelData(1);
      expect(d[0]).toBe(1);
      expect(d[48000]).toBeCloseTo(Math.exp(-3.45), 5);
      expect(20 * Math.log10(d[95999])).toBeCloseTo(-60, 0);
    });

    it('send → convolver (normalize, the decay’s IR) → gain → level → output; the send ramps 10 ms', () => {
      create({ workletReady: false });
      const conv = fx.reverb.convolver;
      expect(conv.normalize).toBe(true);
      expect(conv.buffer.length).toBe(3 * 48000);
      expect(fx.reverbSend.connections).toEqual([conv]);
      expect(conv.connections).toEqual([fx.reverb.gain]);
      expect(fx.reverb.gain.connections).toEqual([fx.reverbLevel]);
      expect(fx.reverbLevel.connections).toEqual([fx.output]);
      fx.throwReverb(true);
      expect(last(fx.reverbSend.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 1, 1.01]);
      fx.throwReverb(false);
      expect(last(fx.reverbSend.gain, 'linearRampToValueAtTime')[1]).toBe(0);
      expect(fx.dry.gain.calls).toEqual([]);
    });

    it('a decay change rebuilds once after 150 ms of rest and crossfades the convolvers over 50 ms; the old one is disconnected', () => {
      create({ workletReady: false });
      const old = fx.reverb;
      fx.setReverb({ decay: 4 });
      vi.advanceTimersByTime(100);
      fx.setReverb({ decay: 6 });
      vi.advanceTimersByTime(MASTER_FX_REVERB_DEBOUNCE_MS - 1);
      expect(fx.reverb).toBe(old);
      vi.advanceTimersByTime(1);
      const next = fx.reverb;
      expect(next).not.toBe(old);
      expect(ac.createdNodes.filter((n) => n.kind === 'Convolver')).toHaveLength(2); // one rebuild only
      expect(next.convolver.buffer.length).toBe(6 * 48000);
      expect(last(next.gain.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 1, 1.05]);
      expect(last(old.gain.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 0, 1.05]);
      expect(old.convolver.connections).toEqual([old.gain]); // still fading
      vi.advanceTimersByTime(100);
      expect(old.convolver.connections).toEqual([]);
      expect(old.gain.connections).toEqual([]);
      expect(fx.nodes.has(old.convolver)).toBe(false);
    });

    it('invalid reverb settings are ignored (negative)', () => {
      create({ workletReady: false });
      fx.setReverb({ decay: 0.5, level: -1 });
      fx.setReverb({ decay: 9 });
      vi.runAllTimers();
      expect(fx.reverbSettings).toEqual({ decay: 3, level: 0.7 });
      expect(ac.createdNodes.filter((n) => n.kind === 'Convolver')).toHaveLength(1);
    });
  });

  describe('stopTails (functional §2.3 Stop)', () => {
    it('closes the sends in 10 ms, levels reach 0 by 0.1 s, then empty delay + convolver and the levels come back', () => {
      create({ workletReady: false });
      fx.throwDelay(true);
      fx.throwReverb(true);
      const oldDelay = fx.delay;
      const oldConv = fx.reverb.convolver;
      fx.stopTails();
      expect(last(fx.delaySend.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 0, 1.01]);
      expect(last(fx.reverbSend.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 0, 1.01]);
      expect(last(fx.feedback.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 0, 1.01]);
      expect(last(fx.delayLevel.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 0, 1.1]);
      expect(last(fx.reverbLevel.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 0, 1.1]);
      // A level change meanwhile is kept for the restore, not applied.
      fx.setDelay({ level: 0.4 });
      expect(fx.delayLevel.gain.value).toBe(0);
      ac.currentTime = 1.25;
      vi.advanceTimersByTime(MASTER_FX_STOP_RESTORE_MS);
      expect(fx.delay).not.toBe(oldDelay);
      expect(oldDelay.connections).toEqual([]);
      expect(fx.reverb.convolver).not.toBe(oldConv);
      expect(oldConv.connections).toEqual([]);
      expect(fx.reverb.convolver.buffer).toBe(oldConv.buffer); // no IR regeneration
      expect(fx.feedback.gain.value).toBe(0.55);
      expect(last(fx.delayLevel.gain, 'linearRampToValueAtTime')).toEqual(['linearRampToValueAtTime', 0.4, 1.26]);
      expect(last(fx.reverbLevel.gain, 'linearRampToValueAtTime')[1]).toBe(0.7);
      expect(fx.delaySend.gain.value).toBe(0);
      expect(fx.reverbSend.gain.value).toBe(0);
      expect(fx.delayHeld || fx.reverbHeld).toBe(false);
    });

    it('negative: without stopTails a released throw leaves the delay and its level as they were (tails ring)', () => {
      create({ workletReady: false });
      const delay = fx.delay;
      fx.throwDelay(true);
      fx.throwDelay(false);
      vi.runAllTimers();
      expect(fx.delay).toBe(delay);
      expect(fx.delayLevel.gain.value).toBe(0.7);
      expect(fx.feedback.gain.value).toBe(0.55);
    });
  });

  describe('beat-repeat worklet (functional §2.4)', () => {
    it('pass-through until loaded: rolls are refused; then the worklet is crossfaded in over 3 ms', async () => {
      create();
      expect(fx.roll({ startTime: 1, length: 0.5 })).toBe(false);
      expect(fx.workletLoaded).toBe(false);
      await expect(fx.ready).resolves.toBe(true);
      expect(ac.addedModules[0]).toMatch(/^data:text\/javascript;base64,/);
      const node = ac.workletNodes[0];
      expect(node.name).toBe('beat-repeat-processor');
      expect(node.options).toMatchObject({
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        outputChannelCount: [2],
      });
      expect(fx.input.connections).toEqual([fx.bypass, node]);
      const g = node.connections[0];
      expect(g.connections).toEqual([fx.filterIn]);
      // The crossfade waits 20 ms for the processor to run, then takes 3 ms.
      expect(g.gain.calls.slice(-2)).toEqual([
        ['setValueAtTime', 0, 1.02],
        ['linearRampToValueAtTime', 1, 1.02 + 0.003],
      ]);
      expect(fx.bypass.gain.calls.slice(-2)).toEqual([
        ['setValueAtTime', 1, 1.02],
        ['linearRampToValueAtTime', 0, 1.02 + 0.003],
      ]);
    });

    it('roll / stop / length post frames (context seconds × sample rate)', async () => {
      create();
      await fx.ready;
      const port = ac.workletNodes[0].port;
      expect(fx.roll({ startTime: 1.5, length: 0.5 })).toBe(true);
      expect(fx.setRollLength(0.25)).toBe(true);
      expect(fx.roll(null)).toBe(true);
      expect(port.posted).toEqual([
        { type: 'roll', startFrame: 72000, lengthFrames: 24000 },
        { type: 'length', lengthFrames: 12000 },
        { type: 'stop' },
      ]);
      expect(fx.roll({ startTime: NaN, length: 0.5 })).toBe(false);
      expect(fx.roll({ startTime: 1, length: 0 })).toBe(false);
      expect(fx.setRollLength(-1)).toBe(false);
      expect(port.posted).toHaveLength(3);
    });

    it('a failed load leaves the pass-through (ready false, rolls refused, nothing thrown)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      create({ workletReady: Promise.reject(new Error('no worklet')) });
      await expect(fx.ready).resolves.toBe(false);
      expect(fx.roll({ startTime: 1, length: 0.5 })).toBe(false);
      expect(fx.input.connections).toEqual([fx.bypass]);
      warn.mockRestore();
    });

    it('setChannelCount rebuilds the worklet with the new count (crossfaded, old one retired); the same count does not (negative)', async () => {
      create();
      await fx.ready;
      const old = ac.workletNodes[0];
      fx.setChannelCount(2);
      expect(ac.workletNodes).toHaveLength(1);
      fx.setChannelCount(6);
      expect(ac.workletNodes).toHaveLength(2);
      const next = ac.workletNodes[1];
      expect(next.options.outputChannelCount).toEqual([6]);
      expect(last(old.connections[0].gain, 'linearRampToValueAtTime')[1]).toBe(0);
      vi.runAllTimers();
      expect(old.connections).toEqual([]);
      expect(old.port.closed).toBe(true);
      expect(fx.roll({ startTime: 1, length: 0.5 })).toBe(true);
      expect(next.port.posted).toHaveLength(1);
    });

    it('a channel count set before the load is used by the worklet', async () => {
      create();
      fx.setChannelCount(4);
      await fx.ready;
      expect(ac.workletNodes[0].options.outputChannelCount).toEqual([4]);
    });
  });

  describe('ramps start where a browser param really is', () => {
    /**
     * As in a browser: `param.value` keeps the intrinsic value until the audio thread renders the
     * scheduled change, so reading it right after a setValueAtTime in the same task is stale.
     */
    function browserLikeGains() {
      const createGain = ac.createGain.bind(ac);
      ac.createGain = () => {
        const node = createGain();
        let intrinsic = 1;
        Object.defineProperty(node.gain, 'value', {
          get: () => intrinsic,
          set: (v) => {
            node.gain.calls.push(['value=', v]);
            intrinsic = v;
          },
        });
        return node;
      };
    }
    /** The value a param holds when its last ramp starts (the anchor before linearRampToValueAtTime). */
    const rampFrom = (param) => {
      const calls = param.calls;
      const i = calls.map((c) => c[0]).lastIndexOf('linearRampToValueAtTime');
      return calls[i - 1][1];
    };

    it('the worklet path fades in from 0 and the bypass out from 1 (never both at 1)', async () => {
      browserLikeGains();
      create();
      await fx.ready;
      const g = ac.workletNodes[0].connections[0];
      expect(rampFrom(g.gain)).toBe(0);
      expect(rampFrom(fx.bypass.gain)).toBe(1);
    });

    it('a reverb rebuild fades the new convolver in from 0', () => {
      browserLikeGains();
      create({ workletReady: false });
      fx.setReverb({ decay: 5 });
      vi.advanceTimersByTime(MASTER_FX_REVERB_DEBOUNCE_MS);
      expect(rampFrom(fx.reverb.gain.gain)).toBe(0);
    });

    it('a filter turned in the same task as construction fades wet in from 0', () => {
      browserLikeGains();
      create({ workletReady: false });
      fx.setFilter(-50);
      expect(rampFrom(fx.wet.gain)).toBe(0);
    });
  });

  describe('lifecycle', () => {
    it('destroy() disconnects every node it made, closes the worklet port and cancels timers', async () => {
      create();
      await fx.ready;
      fx.setReverb({ decay: 5 });
      fx.stopTails();
      fx.destroy();
      vi.runAllTimers();
      for (const node of ac.createdNodes) expect(node.connections).toEqual([]);
      expect(ac.workletNodes[0].connections).toEqual([]);
      expect(ac.workletNodes[0].port.closed).toBe(true);
      expect(fx.nodes.size).toBe(0);
      expect(ac.createdNodes.filter((n) => n.kind === 'Convolver')).toHaveLength(1); // the debounced rebuild never ran
      // Everything after destroy is a no-op.
      fx.setFilter(-50);
      fx.throwDelay(true);
      expect(fx.roll({ startTime: 1, length: 0.5 })).toBe(false);
      fx.destroy();
    });

    it('destroyed before the worklet loads: no worklet node is made', async () => {
      create();
      fx.destroy();
      await fx.ready;
      expect(ac.workletNodes).toHaveLength(0);
    });

    it('no node growth: 50 rounds of filter sweeps, throws, settings and rolls make no nodes', async () => {
      create();
      await fx.ready;
      vi.runAllTimers();
      const before = ac.createdNodes.length;
      const owned = fx.nodes.size;
      for (let i = 0; i < 50; i++) {
        fx.setFilter(i % 2 ? -70 : 60);
        fx.setFilter(0);
        fx.throwDelay(true);
        fx.throwDelay(false);
        fx.throwReverb(i % 2 === 0);
        fx.setDelay({ fraction: i % 2 ? 1 / 4 : 3 / 16, feedback: (i % 9) / 10 });
        fx.setCps(0.4 + i / 100);
        fx.roll({ startTime: 1, length: 0.5 });
        fx.roll(null);
      }
      expect(ac.createdNodes.length).toBe(before);
      // Decay changes and stops swap nodes, but retire the old ones.
      fx.setReverb({ decay: 5 });
      vi.runAllTimers();
      fx.stopTails();
      vi.runAllTimers();
      expect(fx.nodes.size).toBe(owned);
    });
  });

  describe('in the real superdough master insert slot', () => {
    it('merger → fx.input … fx.output → destinationGain; reset() calls setChannelCount and rewires', async () => {
      const controller = new SuperdoughAudioController(ac);
      create({ channelCount: ac.destination.channelCount });
      await fx.ready;
      controller.setMasterInsert(fx.input, { output: fx.output, onChannelCount: (n) => fx.setChannelCount(n) });
      expect(controller.output.channelMerger.connections).toEqual([fx.input]);
      expect(fx.output.connections).toEqual([controller.output.destinationGain]);
      ac.destination.maxChannelCount = 6;
      controller.reset();
      expect(fx.output.connections).toEqual([controller.output.destinationGain]);
      expect(controller.output.channelMerger.connections).toEqual([fx.input]);
      expect(ac.workletNodes.at(-1).options.outputChannelCount).toEqual([6]);
      controller.setMasterInsert(null);
      expect(fx.output.connections).toEqual([]);
      expect(controller.output.channelMerger.connections).toEqual([controller.output.destinationGain]);
    });
  });
});
