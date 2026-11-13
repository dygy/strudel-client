/**
 * Pure-math EQ response (spec 020): the magnitude of the exact Web Audio BiquadFilterNode
 * coefficients (Web Audio API §BiquadFilterNode, Audio EQ Cookbook), so the panel's chart and the
 * preset loudness check need no AudioContext and match what the browser applies.
 *
 * Note: for `lowpass`/`highpass` Web Audio reads `Q` in dB (alpha = sin(w0) / (2·10^(Q/20))), for
 * `peaking` it is the plain Q, and shelves ignore Q (slope S = 1).
 */

export type ResponseFilterType = 'lowpass' | 'highpass' | 'peaking' | 'lowshelf' | 'highshelf';

/** The two stages of a 4th-order Butterworth (24 dB/oct, no peak) in linear Q: 0.5412 and 1.3066. */
export const BUTTERWORTH_Q = [1 / (2 * Math.cos(Math.PI / 8)), 1 / (2 * Math.cos((3 * Math.PI) / 8))];
/** The same stages as Web Audio lowpass/highpass `Q` values (dB). */
export const BUTTERWORTH_Q_DB = BUTTERWORTH_Q.map((q) => 20 * Math.log10(q));

/** One cut, as stored: on/off and its frequency in Hz. */
export interface CutSettings {
  enabled: boolean;
  frequency: number;
}

/** The part of the EQ settings the response depends on. */
export interface ResponseSettings {
  bands: { frequency: number; gain: number; Q: number }[];
  lowCut?: CutSettings | null;
  highCut?: CutSettings | null;
  outputGain?: number;
}

/** The band filter type by position: a low shelf first, a high shelf last, peaking in between. */
export function bandType(index: number, count: number): ResponseFilterType {
  if (index === 0) return 'lowshelf';
  if (index === count - 1) return 'highshelf';
  return 'peaking';
}

type Coefficients = [number, number, number, number, number, number]; // b0 b1 b2 a0 a1 a2

function coefficients(type: ResponseFilterType, f0: number, gainDb: number, Q: number, sampleRate: number) {
  const nyquist = sampleRate / 2;
  // Web Audio's edge cases: a lowpass at/above Nyquist and a highpass at/below 0 Hz pass everything.
  if (type === 'lowpass' && f0 >= nyquist) return [1, 0, 0, 1, 0, 0] as Coefficients;
  if (type === 'highpass' && f0 <= 0) return [1, 0, 0, 1, 0, 0] as Coefficients;
  const w0 = (2 * Math.PI * Math.min(Math.max(f0, 0), nyquist)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  switch (type) {
    case 'lowpass': {
      const alpha = sin / (2 * Math.pow(10, Q / 20));
      return [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha] as Coefficients;
    }
    case 'highpass': {
      const alpha = sin / (2 * Math.pow(10, Q / 20));
      return [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha] as Coefficients;
    }
    case 'peaking': {
      const alpha = sin / (2 * Q);
      return [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A] as Coefficients;
    }
    case 'lowshelf': {
      const k = 2 * Math.sqrt(A) * (sin / 2) * Math.SQRT2;
      return [
        A * (A + 1 - (A - 1) * cos + k),
        2 * A * (A - 1 - (A + 1) * cos),
        A * (A + 1 - (A - 1) * cos - k),
        A + 1 + (A - 1) * cos + k,
        -2 * (A - 1 + (A + 1) * cos),
        A + 1 + (A - 1) * cos - k,
      ] as Coefficients;
    }
    case 'highshelf': {
      const k = 2 * Math.sqrt(A) * (sin / 2) * Math.SQRT2;
      return [
        A * (A + 1 + (A - 1) * cos + k),
        -2 * A * (A - 1 + (A + 1) * cos),
        A * (A + 1 + (A - 1) * cos - k),
        A + 1 - (A - 1) * cos + k,
        2 * (A - 1 - (A + 1) * cos),
        A + 1 - (A - 1) * cos - k,
      ] as Coefficients;
    }
  }
}

/**
 * Linear magnitude of one Web Audio biquad at each frequency.
 * @param type - Filter type
 * @param f0 - Filter frequency (Hz)
 * @param gainDb - Gain (dB; peaking and shelves only)
 * @param Q - Q (dB for lowpass/highpass, linear for peaking, unused by shelves)
 * @param frequencies - Frequencies to evaluate (Hz)
 * @param sampleRate - Context sample rate (Hz)
 */
export function biquadMagnitude(
  type: ResponseFilterType,
  f0: number,
  gainDb: number,
  Q: number,
  frequencies: ArrayLike<number>,
  sampleRate: number,
): Float64Array {
  const [b0, b1, b2, a0, a1, a2] = coefficients(type, f0, gainDb, Q, sampleRate);
  const out = new Float64Array(frequencies.length);
  for (let i = 0; i < frequencies.length; i++) {
    const w = (2 * Math.PI * frequencies[i]) / sampleRate;
    const c1 = Math.cos(w);
    const s1 = Math.sin(w);
    const c2 = Math.cos(2 * w);
    const s2 = Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2;
    const ni = -(b1 * s1 + b2 * s2);
    const dr = a0 + a1 * c1 + a2 * c2;
    const di = -(a1 * s1 + a2 * s2);
    out[i] = Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return out;
}

/**
 * The EQ's response in dB at each frequency: the 10 bands, the low and high cut (two Butterworth
 * stages each, when on) and the output level. The limiter is not included (it only acts on loud peaks),
 * nor is the low cut's resting position while off (10 Hz: within 0.02 dB of flat from 20 Hz up).
 * @param settings - Bands, cuts and output level (missing cuts are off, missing output is 0 dB)
 * @param frequencies - Frequencies to evaluate (Hz)
 * @param sampleRate - Sample rate the EQ runs at (Hz), 48000 by default
 */
export function equalizerResponseDb(
  settings: ResponseSettings,
  frequencies: ArrayLike<number>,
  sampleRate = 48000,
): Float64Array {
  const total = new Float64Array(frequencies.length).fill(1);
  const multiply = (mag: Float64Array) => mag.forEach((m, i) => (total[i] *= m));
  settings.bands.forEach((band, index) => {
    multiply(
      biquadMagnitude(
        bandType(index, settings.bands.length),
        band.frequency,
        band.gain,
        band.Q,
        frequencies,
        sampleRate,
      ),
    );
  });
  for (const [cut, type] of [
    [settings.lowCut, 'highpass'],
    [settings.highCut, 'lowpass'],
  ] as const) {
    if (cut?.enabled) {
      BUTTERWORTH_Q_DB.forEach((q) => multiply(biquadMagnitude(type, cut.frequency, 0, q, frequencies, sampleRate)));
    }
  }
  const outputDb = settings.outputGain ?? 0;
  return total.map((m) => 20 * Math.log10(Math.max(m, 1e-12)) + outputDb);
}

/**
 * Pink-noise loudness of the EQ relative to a flat EQ, in dB: pink noise has equal energy per
 * octave, so its power through the EQ is the mean of |H|² over log-spaced frequencies from
 * 20 Hz to 20 kHz. Flat (all bands 0 dB, cuts off, output 0 dB) is 0 dB.
 * @param settings - Bands, cuts and output level
 * @param sampleRate - Sample rate the EQ runs at (Hz), 48000 by default
 */
export function pinkNoiseLoudnessDb(settings: ResponseSettings, sampleRate = 48000): number {
  const points = 600;
  const frequencies = new Float64Array(points);
  for (let i = 0; i < points; i++) frequencies[i] = 20 * Math.pow(1000, i / (points - 1));
  const db = equalizerResponseDb(settings, frequencies, sampleRate);
  let energy = 0;
  db.forEach((d) => (energy += Math.pow(10, d / 10)));
  return 10 * Math.log10(energy / points);
}
