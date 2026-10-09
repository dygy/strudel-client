/**
 * AudioEqualizer (spec 015 §2.2): chain wiring, per-band gain, clamps, presets, on/off.
 * Runs on the shared Web Audio mock; no real AudioContext.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioEqualizer } from '../AudioEqualizer';
import { EQUALIZER_PRESETS } from '../presets';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext, stubWebAudio, unstubWebAudio } from '../../mixer/test/webAudioMock.mjs';

const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const BAND_1K = 5;

/** Walk the graph from the input node: input → band0 → … → band9 → output. */
function chainOf(eq: AudioEqualizer): any[] {
  const nodes: any[] = [];
  let node: any = eq.getInput();
  while (node && node !== eq.getOutput()) {
    expect(node.connections).toHaveLength(1);
    node = node.connections[0];
    if (node !== eq.getOutput()) nodes.push(node);
  }
  return nodes;
}

/** What each filter actually applies (the audible gain), in band order. */
const appliedGains = (eq: AudioEqualizer) => chainOf(eq).map((f) => f.gain.value);
const storedGains = (eq: AudioEqualizer) => eq.getState().bands.map((b) => b.gain);

describe('AudioEqualizer (spec 015 §2.2)', () => {
  let eq: AudioEqualizer;

  beforeEach(() => {
    stubWebAudio();
    eq = new AudioEqualizer(new MockAudioContext() as unknown as AudioContext);
  });
  afterEach(() => unstubWebAudio());

  describe('the 10 filters are chained in order', () => {
    it('input → 31 Hz → … → 16 kHz → output, one connection per node', () => {
      const filters = chainOf(eq);

      expect(filters.map((f) => f.frequency.value)).toEqual(FREQUENCIES);
      expect(filters.map((f) => f.type)).toEqual(['lowshelf', ...Array(8).fill('peaking'), 'highshelf']);
      expect(filters.at(-1).connections).toEqual([eq.getOutput()]);
    });

    it('the input is not wired straight to the output, bypassing the bands', () => {
      expect(eq.getInput().connections as unknown as any[]).not.toContain(eq.getOutput());
      expect(chainOf(eq)).toHaveLength(10);
    });
  });

  describe('each band changes only its own range', () => {
    it('raising the 1 kHz band by 6 dB shows +6 dB on that band', () => {
      eq.setBand(BAND_1K, { gain: 6 });

      expect(storedGains(eq)[BAND_1K]).toBe(6);
      expect(appliedGains(eq)[BAND_1K]).toBe(6);
    });

    it('raising the 1 kHz band leaves the other nine bands unchanged', () => {
      eq.applyPreset('rock');
      const before = appliedGains(eq);

      eq.setBand(BAND_1K, { gain: 6 });

      const after = appliedGains(eq);
      const others = (g: number[]) => g.filter((_, i) => i !== BAND_1K);
      expect(others(after)).toEqual(others(before));
      expect(others(storedGains(eq))).toEqual(others(EQUALIZER_PRESETS.rock.gains));
    });

    it('a band index outside 0–9 changes nothing', () => {
      eq.setBand(10, { gain: 6 });
      eq.setBand(-1, { gain: 6 });

      expect(appliedGains(eq)).toEqual(Array(10).fill(0));
    });
  });

  describe('gain is clamped to ±12 dB', () => {
    it('+20 dB stops at +12 dB and −20 dB stops at −12 dB', () => {
      eq.setBand(0, { gain: 20 });
      eq.setBand(9, { gain: -20 });

      expect(storedGains(eq)[0]).toBe(12);
      expect(appliedGains(eq)[0]).toBe(12);
      expect(storedGains(eq)[9]).toBe(-12);
      expect(appliedGains(eq)[9]).toBe(-12);
    });

    it('the exact limits ±12 dB and in-range values are not altered', () => {
      eq.setBand(0, { gain: 12 });
      eq.setBand(1, { gain: -12 });
      eq.setBand(2, { gain: -3.5 });

      expect(storedGains(eq).slice(0, 3)).toEqual([12, -12, -3.5]);
    });
  });

  describe('Q is clamped to 0.5–4', () => {
    it('Q 10 stops at 4 and Q 0.1 stops at 0.5', () => {
      eq.setBand(3, { Q: 10 });
      eq.setBand(4, { Q: 0.1 });

      expect(eq.getState().bands[3].Q).toBe(4);
      expect(chainOf(eq)[3].Q.value).toBe(4);
      expect(eq.getState().bands[4].Q).toBe(0.5);
      expect(chainOf(eq)[4].Q.value).toBe(0.5);
    });

    it('an in-range Q is kept as set, and setting Q does not touch gain', () => {
      eq.setBand(3, { gain: 5 });
      eq.setBand(3, { Q: 2.5 });

      expect(eq.getState().bands[3]).toMatchObject({ Q: 2.5, gain: 5 });
    });
  });

  describe('presets apply all ten bands at once', () => {
    it('a known preset moves all ten bands to its values', () => {
      eq.applyPreset('bassBoost');

      expect(storedGains(eq)).toEqual(EQUALIZER_PRESETS.bassBoost.gains);
      expect(appliedGains(eq)).toEqual(EQUALIZER_PRESETS.bassBoost.gains);
    });

    it('an unknown preset name leaves the bands as they were', () => {
      eq.applyPreset('vocal');
      const before = { stored: storedGains(eq), applied: appliedGains(eq) };

      expect(() => eq.applyPreset('noSuchPreset')).not.toThrow();

      expect(storedGains(eq)).toEqual(before.stored);
      expect(appliedGains(eq)).toEqual(before.applied);
    });
  });

  describe('switching the EQ off passes the sound through unchanged', () => {
    it('off sets every band to 0 dB, and on brings the same shape back', () => {
      eq.applyPreset('rock');

      eq.setEnabled(false);
      expect(appliedGains(eq)).toEqual(Array(10).fill(0));

      eq.setEnabled(true);
      expect(appliedGains(eq)).toEqual(EQUALIZER_PRESETS.rock.gains);
    });

    it('switching off does not forget the shape it will restore', () => {
      eq.applyPreset('rock');

      eq.setEnabled(false);

      expect(eq.getState()).toMatchObject({ isEnabled: false });
      expect(storedGains(eq)).toEqual(EQUALIZER_PRESETS.rock.gains);
    });

    // FINDING (spec 015 §4): setBand applies gain to the filter even while the EQ is off
    // (packages/equalizer/AudioEqualizer.ts:183). EqualizerUI applies saved settings as
    // setEnabled(saved.isEnabled) then setBand(...) per band (EqualizerUI.tsx:36-38), so a
    // reload with the EQ saved as OFF and a shaped curve makes the EQ audible while the UI
    // says off. The same happens when moving a slider or picking a preset while off.
    it.fails('while the EQ is off, applying saved band values (as on reload) keeps the sound flat', () => {
      eq.setEnabled(false);
      EQUALIZER_PRESETS.rock.gains.forEach((gain, i) => eq.setBand(i, { gain }));

      expect(appliedGains(eq)).toEqual(Array(10).fill(0));
    });

    // FINDING (spec 015 §4), second path: setState calls setEnabled(state.isEnabled) and then
    // setBand for each band (packages/equalizer/AudioEqualizer.ts:160-168); setBand writes the
    // filter gain regardless of isEnabled (:183). Restoring an "off" state applies the curve.
    it.fails('restoring a saved state that is off keeps the sound flat', () => {
      const bands = EQUALIZER_PRESETS.rock.gains.map((gain, i) => ({
        frequency: FREQUENCIES[i],
        type: 'peaking' as BiquadFilterType,
        gain,
        Q: 1,
      }));

      eq.setState({ isEnabled: false, bands });

      expect(eq.getState().isEnabled).toBe(false);
      expect(appliedGains(eq)).toEqual(Array(10).fill(0));
    });
  });

  describe('a non-numeric gain', () => {
    // FINDING (spec 015 §4): Math.max(-12, Math.min(12, NaN)) is NaN, so setBand passes NaN to
    // the filter and stores it (packages/equalizer/AudioEqualizer.ts:182-184). A real AudioParam
    // throws on a non-finite value. Reached from damaged saved settings (see persistence.test.ts).
    it.fails('leaves the band at a finite value', () => {
      eq.setBand(BAND_1K, { gain: 'abc' as unknown as number });

      expect(Number.isFinite(appliedGains(eq)[BAND_1K])).toBe(true);
      expect(Number.isFinite(storedGains(eq)[BAND_1K])).toBe(true);
    });
  });
});
