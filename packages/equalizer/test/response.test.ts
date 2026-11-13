/**
 * @spec: 020-eq-strong-control (tech §2.2, §4)
 * The pure-math response: Web Audio biquad formulas, the 24 dB/oct Butterworth cuts and the
 * pink-noise loudness used to match the genre presets to Flat.
 */
import { describe, it, expect } from 'vitest';
import {
  BUTTERWORTH_Q_DB,
  biquadMagnitude,
  equalizerResponseDb,
  pinkNoiseLoudnessDb,
  type ResponseSettings,
} from '../response';

const SR = 48000;
const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const dB = (mag: ArrayLike<number>) => Array.from(mag, (m) => 20 * Math.log10(m));
const settings = (gains: number[] = Array(10).fill(0), extra: Partial<ResponseSettings> = {}): ResponseSettings => ({
  bands: FREQUENCIES.map((frequency, i) => ({ frequency, gain: gains[i], Q: 1 })),
  ...extra,
});
/** The 4th-order Butterworth cut as the EQ builds it: two stages. */
const cutDb = (type: 'highpass' | 'lowpass', fc: number, f: number[]) => {
  const [a, b] = BUTTERWORTH_Q_DB.map((q) => biquadMagnitude(type, fc, 0, q, f, SR));
  return dB(a.map((m, i) => m * b[i]));
};

describe('Web Audio biquad response (spec 020)', () => {
  it('a peaking band reaches its gain at its centre frequency', () => {
    expect(dB(biquadMagnitude('peaking', 1000, 24, 1, [1000], SR))[0]).toBeCloseTo(24, 3);
    expect(dB(biquadMagnitude('peaking', 1000, -24, 1, [1000], SR))[0]).toBeCloseTo(-24, 3);
  });

  it('a low shelf reaches its gain at DC, a high shelf near Nyquist', () => {
    expect(dB(biquadMagnitude('lowshelf', 31, 18, 1, [1], SR))[0]).toBeCloseTo(18, 1);
    expect(dB(biquadMagnitude('highshelf', 16000, -6, 1, [23900], SR))[0]).toBeCloseTo(-6, 0);
  });

  it('a highpass at 0 Hz and a lowpass at Nyquist pass everything (the cuts’ off position)', () => {
    const f = [20, 1000, 20000];
    expect(dB(biquadMagnitude('highpass', 0, 0, BUTTERWORTH_Q_DB[0], f, SR))).toEqual([0, 0, 0]);
    expect(dB(biquadMagnitude('lowpass', SR / 2, 0, BUTTERWORTH_Q_DB[1], f, SR))).toEqual([0, 0, 0]);
  });

  it('the low cut is a 24 dB/oct Butterworth: −3 dB at the corner, ≈ −24 dB an octave below, no peak', () => {
    const [atCorner, octaveBelow, twoOctavesAbove] = cutDb('highpass', 200, [200, 100, 800]);
    expect(atCorner).toBeCloseTo(-3.01, 1);
    expect(octaveBelow).toBeLessThan(-23.5);
    expect(Math.abs(twoOctavesAbove)).toBeLessThan(0.02);
    const passband = cutDb('highpass', 200, [250, 300, 400, 600, 1000, 5000]);
    expect(Math.max(...passband)).toBeLessThanOrEqual(0.001);
  });

  it('the high cut at 2 kHz drops 4 kHz by more than 20 dB and leaves 500 Hz alone', () => {
    const [atCorner, octaveAbove, below] = cutDb('lowpass', 2000, [2000, 4000, 500]);
    expect(atCorner).toBeCloseTo(-3.01, 1);
    expect(octaveAbove).toBeLessThan(-20);
    expect(Math.abs(below)).toBeLessThan(0.01);
  });
});

describe('equalizerResponseDb and pinkNoiseLoudnessDb (spec 020)', () => {
  it('flat is 0 dB everywhere and 0 dB loud', () => {
    const db = equalizerResponseDb(settings(), [20, 100, 1000, 10000, 20000]);
    db.forEach((d) => expect(Math.abs(d)).toBeLessThan(1e-9));
    expect(pinkNoiseLoudnessDb(settings())).toBeCloseTo(0, 9);
  });

  it('the output level shifts the whole curve and the loudness by the same dB', () => {
    const db = equalizerResponseDb(settings(undefined, { outputGain: -6 }), [100, 5000]);
    db.forEach((d) => expect(d).toBeCloseTo(-6, 9));
    expect(pinkNoiseLoudnessDb(settings(undefined, { outputGain: 4 }))).toBeCloseTo(4, 9);
  });

  it('a cut is only included while it is on', () => {
    const on = settings(undefined, { lowCut: { enabled: true, frequency: 200 } });
    const off = settings(undefined, { lowCut: { enabled: false, frequency: 200 } });
    expect(equalizerResponseDb(on, [100])[0]).toBeLessThan(-20);
    expect(equalizerResponseDb(off, [100])[0]).toBeCloseTo(0, 9);
  });

  it('boosting adds loudness and cutting removes it', () => {
    expect(pinkNoiseLoudnessDb(settings([12, 12, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeGreaterThan(3);
    expect(pinkNoiseLoudnessDb(settings(undefined, { highCut: { enabled: true, frequency: 1000 } }))).toBeLessThan(-2);
    expect(pinkNoiseLoudnessDb(settings(undefined, { lowCut: { enabled: true, frequency: 1000 } }))).toBeLessThan(-3);
  });
});
