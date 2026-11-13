/**
 * @spec: 020-eq-strong-control (tech §2.1, §4)
 * The EQ channel strip: low/high cut (4th-order Butterworth), output level, limiter, dry/wet true
 * bypass. Every setting is stored always and applied only while the EQ is on; every change glides;
 * destroy() disconnects every node; nothing is downmixed. Runs on the shared Web Audio mock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AudioEqualizer,
  CLIP_CEILING,
  CLIP_INPUT_RANGE,
  CLIP_KNEE,
  CROSSFADE_TIME_CONSTANT,
  CUT_TIME_CONSTANT,
  LIMITER,
  LIMITER_MAKEUP_DB,
  LOW_CUT_OFF_FREQUENCY,
  LOW_CUT_OPEN_TIME_CONSTANT,
  OUTPUT_RISE_TIME_CONSTANT,
  SMOOTHING_TIME_CONSTANT,
} from '../AudioEqualizer';
import { EQUALIZER_PRESETS } from '../presets';
import { BUTTERWORTH_Q_DB } from '../response';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext, stubWebAudio, unstubWebAudio } from '../../mixer/test/webAudioMock.mjs';

const NYQUIST = 24000; // the mock context runs at 48 kHz
const dbToGain = (db: number) => Math.pow(10, db / 20);

let ac: any;
let eq: AudioEqualizer;

const nodes = (kind: string) => ac.createdNodes.filter((n: any) => n.kind === kind);
const filtersOfType = (type: string) => nodes('BiquadFilter').filter((f: any) => f.type === type);
const lowCut = () => filtersOfType('highpass');
const highCut = () => filtersOfType('lowpass');
const limiter = () => nodes('DynamicsCompressor')[0];
/** The dry path: input → Delay → dryGain → output. */
const dryDelay = () => (eq.getInput() as any).connections.find((n: any) => n.kind === 'Delay');
const dryGain = () => dryDelay().connections[0];
/** wetGain is the clipper's only target. */
const wetGain = () => nodes('WaveShaper')[0].connections[0];
/** outputGain feeds the limiter. */
const outputGain = () => nodes('Gain').find((g: any) => g.connections.includes(limiter()));
const jumps = (param: any) => param.calls.filter(([m]: [string]) => m === 'setValueAtTime' || m === 'value=');
const glides = (param: any) => param.calls.filter(([m]: [string]) => m === 'setTargetAtTime');
const clearCalls = () =>
  ac.createdNodes.forEach((n: any) =>
    ['gain', 'frequency', 'Q', 'delayTime'].forEach((p) => n[p]?.calls && (n[p].calls.length = 0)),
  );
const cutFrequencies = (stages: any[]) => stages.map((f: any) => f.frequency.value);

beforeEach(() => {
  stubWebAudio();
  ac = new MockAudioContext();
  eq = new AudioEqualizer(ac as unknown as AudioContext);
});
afterEach(() => unstubWebAudio());

describe('EQ channel strip (spec 020)', () => {
  describe('the graph', () => {
    it('the dry path is the input delayed by the limiter look-ahead, so the crossfade does not comb', () => {
      expect(dryDelay().delayTime.value).toBe(LIMITER.lookahead);
      expect(dryDelay().connections).toEqual([dryGain()]);
      expect(dryGain().connections).toEqual([eq.getOutput()]);
      expect(wetGain().connections).toEqual([eq.getOutput()]);
    });

    it('each cut is two Butterworth stages (Q in dB, as Web Audio reads it for lowpass/highpass)', () => {
      expect(lowCut().map((f: any) => f.Q.value)).toEqual(BUTTERWORTH_Q_DB);
      expect(highCut().map((f: any) => f.Q.value)).toEqual(BUTTERWORTH_Q_DB);
      expect(BUTTERWORTH_Q_DB[0]).toBeCloseTo(20 * Math.log10(0.5412), 2);
      expect(BUTTERWORTH_Q_DB[1]).toBeCloseTo(20 * Math.log10(1.3066), 2);
    });

    // Regression (measured in Chromium while building spec 020): resting the highpass at 0 Hz threw a
    // 9–16 dB transient whenever the low cut was turned on or off (poles on z = 1 during the glide).
    it('both cuts start at their resting position: highpass at 10 Hz (not 0), lowpass at Nyquist', () => {
      expect(LOW_CUT_OFF_FREQUENCY).toBe(10);
      expect(cutFrequencies(lowCut())).toEqual([10, 10]);
      expect(cutFrequencies(highCut())).toEqual([NYQUIST, NYQUIST]);
    });

    it('the limiter is set as a limiter, its makeup gain is cancelled, and a clipper caps the peaks', () => {
      const l = limiter();
      expect([l.threshold.value, l.knee.value, l.ratio.value, l.attack.value, l.release.value]).toEqual([
        LIMITER.threshold,
        LIMITER.knee,
        LIMITER.ratio,
        LIMITER.attack,
        LIMITER.release,
      ]);
      // The stage's output gain cancels the makeup gain and scales into the clipper's ±2 input.
      const trim = l.connections[0];
      expect(trim.gain.value).toBeCloseTo(dbToGain(-LIMITER_MAKEUP_DB) / CLIP_INPUT_RANGE, 6);
      expect(LIMITER_MAKEUP_DB).toBeCloseTo(0.171, 3); // 0.6 · 0.3 · (1 − 1/20); formula measured in Chromium

      // The curve takes the scaled input (x / 2) and gives the real level back.
      const curve: Float32Array = trim.connections[0].curve;
      const at = (x: number) => curve[Math.round(((x / CLIP_INPUT_RANGE + 1) / 2) * (curve.length - 1))];
      expect(at(0.5)).toBeCloseTo(0.5, 3); // transparent below the knee
      expect(at(-0.8)).toBeCloseTo(-0.8, 3);
      expect(Math.max(...Array.from(curve, Math.abs))).toBeLessThanOrEqual(Math.fround(CLIP_CEILING));
      expect(CLIP_CEILING).toBeLessThan(1); // output peaks stay under 0 dBFS
      expect(at(2)).toBeGreaterThan(0.99); // +6 dBFS overshoot is rounded off just under 0 dBFS
    });

    // Owner decision (spec 020 review): loud flat material must pass unchanged with the EQ on.
    // With threshold −1 dB and the clipper knee at −1 dBFS, peaks between −1 and 0 dBFS were touched.
    it('a peak at −0.5 dBFS passes both the limiter and the clipper untouched', () => {
      const peak = dbToGain(-0.5);
      expect(LIMITER.threshold).toBeGreaterThan(-0.5);
      expect(CLIP_KNEE).toBeGreaterThan(peak);
      const curve: Float32Array = limiter().connections[0].connections[0].curve;
      const step = (2 * CLIP_INPUT_RANGE) / (curve.length - 1);
      // every curve point up to the −0.5 dBFS peak (and a bit beyond) is the identity
      for (let x = -peak; x <= peak + 0.01; x += step) {
        const i = Math.round(((x / CLIP_INPUT_RANGE + 1) / 2) * (curve.length - 1));
        expect(Math.abs(curve[i] - x)).toBeLessThan(1e-3);
      }
    });

    it('no node is downmixed: nothing but the compressor (which cannot) leaves the default channel mode', () => {
      const changed = ac.createdNodes.filter(
        (n: any) => n.channelCountMode !== undefined && n.kind !== 'DynamicsCompressor',
      );
      expect(changed).toEqual([]);
      expect(nodes('DynamicsCompressor')).toHaveLength(1);
    });

    it('on a 6-channel output each stereo pair gets its own limiter, so no channel is dropped', () => {
      const ac6 = new MockAudioContext();
      ac6.destination.channelCount = 6;
      new AudioEqualizer(ac6 as unknown as AudioContext);
      const of6 = (kind: string) => ac6.createdNodes.filter((n: any) => n.kind === kind);

      expect(of6('DynamicsCompressor')).toHaveLength(3);
      const [splitter] = of6('ChannelSplitter').filter((s: any) => s.numberOfOutputs === 6);
      const [merger] = of6('ChannelMerger').filter((m: any) => m.numberOfInputs === 6);
      expect(splitter.routes.map((r: any) => r.output).sort()).toEqual([0, 1, 2, 3, 4, 5]);
      const intoMerger = of6('ChannelSplitter').flatMap((s: any) =>
        s.routes.filter((r: any) => r.target === merger).map((r: any) => r.input),
      );
      expect(intoMerger.sort()).toEqual([0, 1, 2, 3, 4, 5]);
    });
  });

  describe('on/off is a wet/dry crossfade (true bypass)', () => {
    it('on: wet 1, dry 0; off: wet 0, dry 1', () => {
      expect([wetGain().gain.value, dryGain().gain.value]).toEqual([1, 0]);

      eq.setEnabled(false);
      expect([wetGain().gain.value, dryGain().gain.value]).toEqual([0, 1]);

      eq.setEnabled(true);
      expect([wetGain().gain.value, dryGain().gain.value]).toEqual([1, 0]);
    });

    it('the crossfade glides both gains with the same time constant (wet + dry stays 1), never jumps', () => {
      clearCalls();
      eq.setEnabled(false);
      eq.setEnabled(true);

      for (const param of [wetGain().gain, dryGain().gain]) {
        expect(jumps(param)).toEqual([]);
        expect(glides(param).map(([, , , tc]: number[]) => tc)).toEqual([
          CROSSFADE_TIME_CONSTANT,
          CROSSFADE_TIME_CONSTANT,
        ]);
      }
      expect(glides(wetGain().gain).map(([, v]: number[]) => v)).toEqual([0, 1]);
      expect(glides(dryGain().gain).map(([, v]: number[]) => v)).toEqual([1, 0]);
    });

    it('off also rests the wet chain at flat: cuts at pass-through, output at 0 dB', () => {
      eq.applyPreset('driftPhonk');
      eq.setEnabled(false);

      expect(cutFrequencies(lowCut())).toEqual([LOW_CUT_OFF_FREQUENCY, LOW_CUT_OFF_FREQUENCY]);
      expect(cutFrequencies(highCut())).toEqual([NYQUIST, NYQUIST]);
      expect(outputGain().gain.value).toBe(1);
    });

    it('the limiter is not reported while the EQ is off', () => {
      limiter().reduction = -6;
      expect(eq.getLimiterReduction()).toBe(-6);

      eq.setEnabled(false);
      expect(eq.getLimiterReduction()).toBe(0);
    });
  });

  describe('low cut and high cut', () => {
    it('a low cut at 200 Hz moves both highpass stages to 200 Hz, gliding', () => {
      clearCalls();
      eq.setLowCut({ enabled: true, frequency: 200 });

      expect(cutFrequencies(lowCut())).toEqual([200, 200]);
      for (const f of lowCut()) {
        expect(jumps(f.frequency)).toEqual([]);
        expect(glides(f.frequency)).toEqual([['setTargetAtTime', 200, 0, CUT_TIME_CONSTANT]]);
      }
      expect(eq.getState().lowCut).toEqual({ enabled: true, frequency: 200 });
    });

    // Regression (measured in Chromium while building spec 020): opening the highpass quickly (25 Hz
    // → off) released a sub-bass bump of +4.4 dB over both steady states.
    it('the low cut glides slower when it opens (frequency down) than when it closes (up)', () => {
      eq.setLowCut({ enabled: true, frequency: 200 });
      clearCalls();
      eq.setLowCut({ frequency: 50 });
      eq.setLowCut({ enabled: false });
      eq.setLowCut({ enabled: true, frequency: 300 });

      const timeConstants = glides(lowCut()[0].frequency).map(([, v, , tc]: number[]) => [v, tc]);
      expect(timeConstants).toEqual([
        [50, LOW_CUT_OPEN_TIME_CONSTANT],
        [LOW_CUT_OFF_FREQUENCY, LOW_CUT_OPEN_TIME_CONSTANT],
        [300, CUT_TIME_CONSTANT],
      ]);
      expect(LOW_CUT_OPEN_TIME_CONSTANT).toBeGreaterThan(CUT_TIME_CONSTANT);
    });

    it('a high cut at 2 kHz moves both lowpass stages to 2 kHz, gliding', () => {
      clearCalls();
      eq.setHighCut({ enabled: true, frequency: 2000 });

      expect(cutFrequencies(highCut())).toEqual([2000, 2000]);
      highCut().forEach((f: any) => expect(jumps(f.frequency)).toEqual([]));
    });

    it('turning a cut off returns it to its resting position and keeps its frequency for next time', () => {
      eq.setLowCut({ enabled: true, frequency: 150 });
      eq.setHighCut({ enabled: true, frequency: 5000 });
      eq.setLowCut({ enabled: false });
      eq.setHighCut({ enabled: false });

      expect(cutFrequencies(lowCut())).toEqual([LOW_CUT_OFF_FREQUENCY, LOW_CUT_OFF_FREQUENCY]);
      expect(cutFrequencies(highCut())).toEqual([NYQUIST, NYQUIST]);
      expect(eq.getState().lowCut).toEqual({ enabled: false, frequency: 150 });

      eq.setLowCut({ enabled: true });
      expect(cutFrequencies(lowCut())).toEqual([150, 150]);
    });

    it('changing the frequency of a cut that is off is stored but not heard', () => {
      eq.setHighCut({ frequency: 3000 });

      expect(cutFrequencies(highCut())).toEqual([NYQUIST, NYQUIST]);
      expect(eq.getState().highCut).toEqual({ enabled: false, frequency: 3000 });
    });

    it.each([
      ['low', 5, 20],
      ['low', 5000, 1000],
      ['high', 500, 1000],
      ['high', 30000, 20000],
    ])('the %s cut clamps %d Hz to %d Hz', (which, given, expected) => {
      const set = which === 'low' ? eq.setLowCut.bind(eq) : eq.setHighCut.bind(eq);
      set({ enabled: true, frequency: given });

      expect(eq.getState()[which === 'low' ? 'lowCut' : 'highCut']!.frequency).toBe(expected);
      expect(cutFrequencies(which === 'low' ? lowCut() : highCut())).toEqual([expected, expected]);
    });

    it('in-range frequencies are kept exactly', () => {
      eq.setLowCut({ enabled: true, frequency: 1000 });
      eq.setHighCut({ enabled: true, frequency: 1000 });
      expect(eq.getState().lowCut!.frequency).toBe(1000);
      expect(eq.getState().highCut!.frequency).toBe(1000);
    });

    it('a non-finite frequency or non-boolean on/off is ignored with a warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      eq.setLowCut({ enabled: true, frequency: 120 });

      eq.setLowCut({ frequency: Number.NaN });
      eq.setLowCut({ enabled: 'yes' as unknown as boolean });

      expect(eq.getState().lowCut).toEqual({ enabled: true, frequency: 120 });
      expect(cutFrequencies(lowCut())).toEqual([120, 120]);
      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });
  });

  describe('output level', () => {
    it('−6 dB glides the output gain to half amplitude', () => {
      clearCalls();
      eq.setOutputGain(-6);

      expect(outputGain().gain.value).toBeCloseTo(dbToGain(-6), 6);
      expect(jumps(outputGain().gain)).toEqual([]);
      expect(glides(outputGain().gain)).toHaveLength(1);
      expect(eq.getState().outputGain).toBe(-6);
    });

    // Regression (measured in Chromium while building spec 020): a fast output rise during a preset
    // switch that also lowers a big sub boost swelled the bass (+2.6 dB in a 20 ms window).
    it('the output level glides slower going up than going down', () => {
      clearCalls();
      eq.setOutputGain(-9);
      eq.setOutputGain(0);

      expect(glides(outputGain().gain).map(([, , , tc]: number[]) => tc)).toEqual([
        SMOOTHING_TIME_CONSTANT,
        OUTPUT_RISE_TIME_CONSTANT,
      ]);
    });

    it.each([
      [-30, -24],
      [10, 6],
      [-24, -24],
      [6, 6],
      [-7.5, -7.5],
    ])('%d dB is stored as %d dB', (given, expected) => {
      eq.setOutputGain(given);
      expect(eq.getState().outputGain).toBe(expected);
      expect(outputGain().gain.value).toBeCloseTo(dbToGain(expected), 6);
    });

    it('a non-finite level is ignored with a warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      eq.setOutputGain(-3);
      eq.setOutputGain(Number.POSITIVE_INFINITY);

      expect(eq.getState().outputGain).toBe(-3);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('output gain'), Number.POSITIVE_INFINITY);
      warn.mockRestore();
    });
  });

  describe('store always, apply only while on', () => {
    it('cuts and output changed while off are silent, then heard once the EQ is switched on', () => {
      eq.setEnabled(false);
      eq.setLowCut({ enabled: true, frequency: 200 });
      eq.setHighCut({ enabled: true, frequency: 2000 });
      eq.setOutputGain(-6);
      eq.setBand(0, { gain: 20 });

      expect(cutFrequencies(lowCut())).toEqual([LOW_CUT_OFF_FREQUENCY, LOW_CUT_OFF_FREQUENCY]);
      expect(cutFrequencies(highCut())).toEqual([NYQUIST, NYQUIST]);
      expect(outputGain().gain.value).toBe(1);
      expect((eq as any).bands[0].filter.gain.value).toBe(0);
      expect([wetGain().gain.value, dryGain().gain.value]).toEqual([0, 1]);

      eq.setEnabled(true);
      expect(cutFrequencies(lowCut())).toEqual([200, 200]);
      expect(cutFrequencies(highCut())).toEqual([2000, 2000]);
      expect(outputGain().gain.value).toBeCloseTo(dbToGain(-6), 6);
      expect((eq as any).bands[0].filter.gain.value).toBe(20);
    });

    it('a genre preset picked while off is remembered and heard only once switched on', () => {
      eq.setEnabled(false);
      eq.applyPreset('phonk');

      expect(cutFrequencies(highCut())).toEqual([NYQUIST, NYQUIST]);
      expect(eq.getState().highCut).toEqual({ enabled: true, frequency: EQUALIZER_PRESETS.phonk.highCut });

      eq.setEnabled(true);
      expect(cutFrequencies(highCut())).toEqual([13000, 13000]);
    });
  });

  describe('presets set bands, cuts and output level', () => {
    it('a genre preset applies its cuts and output level', () => {
      eq.applyPreset('driftPhonk');
      const p = EQUALIZER_PRESETS.driftPhonk;

      expect(eq.getState()).toMatchObject({
        lowCut: { enabled: true, frequency: p.lowCut },
        highCut: { enabled: true, frequency: p.highCut },
        outputGain: p.outputGain,
      });
      expect(eq.getState().bands.map((b) => b.gain)).toEqual(p.gains);
      expect(outputGain().gain.value).toBeCloseTo(dbToGain(p.outputGain!), 6);
    });

    it('a profile preset turns both cuts off and sets the output to 0 dB', () => {
      eq.applyPreset('driftPhonk');
      eq.applyPreset('pop');

      expect(eq.getState()).toMatchObject({
        lowCut: { enabled: false },
        highCut: { enabled: false },
        outputGain: 0,
      });
      expect(cutFrequencies(lowCut())).toEqual([LOW_CUT_OFF_FREQUENCY, LOW_CUT_OFF_FREQUENCY]);
      expect(cutFrequencies(highCut())).toEqual([NYQUIST, NYQUIST]);
      expect(outputGain().gain.value).toBe(1);
    });

    it('switching presets glides every parameter it moves', () => {
      eq.applyPreset('pop');
      clearCalls();
      eq.applyPreset('automotivo');

      ac.createdNodes.forEach((n: any) =>
        ['gain', 'frequency', 'Q'].forEach((p) => n[p]?.calls && expect(jumps(n[p])).toEqual([])),
      );
    });

    it('reset() is flat: bands 0 dB, cuts off, output 0 dB', () => {
      eq.applyPreset('montagem');
      eq.reset();

      const state = eq.getState();
      expect(state.bands.every((b) => b.gain === 0)).toBe(true);
      expect(state).toMatchObject({ lowCut: { enabled: false }, highCut: { enabled: false }, outputGain: 0 });
    });
  });

  describe('getState / setState / getFrequencyResponse', () => {
    it('setState restores the cuts and output level', () => {
      const other = new AudioEqualizer(new MockAudioContext() as unknown as AudioContext);
      other.applyPreset('techno');

      eq.setState(other.getState());

      expect(eq.getState()).toEqual(other.getState());
      expect(cutFrequencies(lowCut())).toEqual([30, 30]);
    });

    it('a state from before spec 020 (no cuts, no output) leaves those as they are', () => {
      eq.setOutputGain(-3);
      const { lowCut: _l, highCut: _h, outputGain: _o, ...old } = eq.getState();

      eq.setState(old);

      expect(eq.getState().outputGain).toBe(-3);
    });

    it('the frequency response includes the output level', () => {
      eq.setOutputGain(-6);
      const db = eq.getFrequencyResponse(new Float32Array([100, 1000]));
      expect(db[0]).toBeCloseTo(-6, 1);
    });
  });

  // Review finding (spec 020): the layout was fixed at build time from destination.channelCount, so a
  // later reset to more channels (a sink whose maxChannelCount is known late) downmixed channels 3+.
  describe('setChannelCount() follows the output channels', () => {
    const limiterCount = () => (eq as any).limiters.length;

    it('2 → 6 while playing: a 3-pair stage is built and crossfaded in, the old one removed once silent', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const old = (eq as any).limiterStage;
      eq.setChannelCount(6);
      const stage = (eq as any).limiterStage;

      expect(eq.getChannelCount()).toBe(6);
      expect(stage.limiters).toHaveLength(3);
      expect(stage.output.connections[0] === old.output.connections[0]).toBe(true); // both into the clipper
      expect(glides(old.output.gain).map(([, v]: number[]) => v)).toEqual([0]);
      expect(glides(stage.output.gain).map(([, v]: number[]) => v)).toEqual([
        dbToGain(-LIMITER_MAKEUP_DB) / CLIP_INPUT_RANGE,
      ]);
      expect(jumps(stage.output.gain).filter(([, v]: number[]) => v !== 0)).toEqual([]); // starts silent, then glides

      vi.runOnlyPendingTimers();
      vi.useRealTimers();
      expect(limiterCount()).toBe(3);
      old.nodes.forEach((n: any) => expect(n.connections.length).toBe(0));
      expect((eq as any).outputGainNode.connections.length).toBe(1);
      expect((eq as any).outputGainNode.connections[0] === stage.entry).toBe(true);
      const [splitter] = stage.nodes.filter((n: any) => n.kind === 'ChannelSplitter' && n.numberOfOutputs === 6);
      expect(splitter.routes.map((r: any) => r.output).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('the same count changes nothing; a non-finite count is ignored', () => {
      const stage = (eq as any).limiterStage;
      eq.setChannelCount(2);
      eq.setChannelCount(Number.NaN);
      expect((eq as any).limiterStage).toBe(stage);
    });

    it('with the context not running the stage is swapped at once', () => {
      ac.state = 'suspended';
      eq.setChannelCount(4);
      expect(limiterCount()).toBe(2);
      expect(eq.getChannelCount()).toBe(4);
    });

    it('destroy() after a resize still disconnects every node', () => {
      ac.state = 'suspended';
      eq.setChannelCount(6);
      eq.destroy();
      expect(ac.createdNodes.filter((n: any) => n.disconnected === 0 || n.connections.length > 0).length).toBe(0);
    });
  });

  describe('destroy()', () => {
    it('disconnects every node the EQ created', () => {
      eq.applyPreset('phonk');
      eq.destroy();

      expect(ac.createdNodes.length).toBeGreaterThan(20);
      const left = ac.createdNodes.filter((n: any) => n.disconnected === 0 || n.connections.length > 0);
      expect(left).toEqual([]);
    });

    it('disconnects every node on a multichannel output too', () => {
      const ac6 = new MockAudioContext();
      ac6.destination.channelCount = 6;
      new AudioEqualizer(ac6 as unknown as AudioContext).destroy();

      expect(ac6.createdNodes.filter((n: any) => n.disconnected === 0 || n.connections.length > 0)).toEqual([]);
    });
  });
});
