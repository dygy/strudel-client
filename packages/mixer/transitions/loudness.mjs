/**
 * Match loudness for track transitions (spec 017 §2.3, tech §2.8).
 *
 * - `LoudnessMeter`: a read-only AnalyserNode tap on the master output (`destinationGain`),
 *   created lazily on the first reading and disconnected on `destroy`. Readings are stamped
 *   with a cycle position, so windows can be asked for in cycles.
 * - `computeTrim`: the gain that brings the new track to the old one's level, clamped ±9 dB.
 * - `trimFactorAt` / `applyTrim`: the trim as a `velocity` multiplier on the new track, phased
 *   in over one cycle in 4 steps (no Web Audio node, so no click and nothing to disconnect).
 *
 * @module @strudel/mixer/transitions/loudness
 * @license AGPL-3.0-or-later
 */

import { mapControls, onsetOf, scaleVelocity } from './envelopes.mjs';

/** The trim never moves the level by more than this. */
export const MAX_TRIM_DB = 9;
/** RMS below this is treated as silence: no trim is computed from it. */
export const SILENCE_RMS = 1e-4;
/** The trim is phased in over this many cycles... */
export const TRIM_FADE_CYCLES = 1;
/** ...in this many equal steps (in dB). */
export const TRIM_STEPS = 4;

export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (gain) => 20 * Math.log10(gain);

/**
 * The gain that brings `newRms` to `oldRms`, clamped to ±`maxDb`. 1 (no change) when either
 * level is missing or silent: a silent stretch says nothing about how loud a track is.
 */
export function computeTrim(oldRms, newRms, maxDb = MAX_TRIM_DB) {
  if (!(oldRms > SILENCE_RMS) || !(newRms > SILENCE_RMS)) {
    return 1;
  }
  const limit = dbToGain(maxDb);
  return Math.min(limit, Math.max(1 / limit, oldRms / newRms));
}

/** Root mean square of a block of samples. */
export function rms(samples) {
  if (!samples?.length) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * The combined RMS of the readings stamped in [from, to), or undefined if there are none.
 * @param {Array<{at: number, rms: number}>} readings
 */
export function rmsOver(readings, from, to) {
  const inside = readings.filter(({ at }) => at >= from && at < to);
  if (!inside.length) {
    return undefined;
  }
  return Math.sqrt(inside.reduce((sum, { rms: r }) => sum + r * r, 0) / inside.length);
}

/**
 * The trim multiplier for an event at cycle `onset`, given a trim state `{ start, value }`:
 * 1 before `start`, then `value` in `TRIM_STEPS` equal dB steps over `TRIM_FADE_CYCLES`
 * (the first step lands at `start`), `value` from then on.
 */
export function trimFactorAt(state, onset) {
  if (!state || state.start == null || state.value === 1 || onset < state.start) {
    return 1;
  }
  const step = Math.floor(((onset - state.start) / TRIM_FADE_CYCLES) * TRIM_STEPS) + 1;
  if (step >= TRIM_STEPS) {
    return state.value;
  }
  return Math.pow(state.value, step / TRIM_STEPS);
}

/**
 * The pattern with its `velocity` multiplied by the trim. The trim state is read at query
 * time, so a trim measured later takes effect without replacing the scheduler's pattern.
 * @param {import('@strudel/core').Pattern} pat
 * @param {{ start: number|null, value: number }} state
 */
export function applyTrim(pat, state) {
  return pat.withHap((hap) => {
    const factor = trimFactorAt(state, onsetOf(hap));
    return factor === 1 ? hap : mapControls(hap, (v) => scaleVelocity(v, factor));
  });
}

/**
 * Taps an AnalyserNode off `source` (fan-out, the signal path is untouched) on the first
 * reading and keeps cycle-stamped RMS readings for a while.
 */
export class LoudnessMeter {
  /**
   * @param {AudioContext} audioContext
   * @param {AudioNode} source the master output node (destinationGain)
   * @param {Object} [options]
   * @param {number} [options.fftSize=2048] samples per reading
   * @param {number} [options.keep=64] cycles of readings to keep
   */
  constructor(audioContext, source, { fftSize = 2048, keep = 64 } = {}) {
    this.audioContext = audioContext;
    this.source = source;
    this.fftSize = fftSize;
    this.keep = keep;
    this.analyser = null;
    this.buffer = null;
    this.readings = [];
  }

  /** Create and connect the analyser if it isn't yet. */
  ensureAnalyser() {
    if (!this.analyser) {
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.buffer = new Float32Array(this.analyser.fftSize);
      this.source.connect(this.analyser);
    }
    return this.analyser;
  }

  /**
   * Take one reading of the current output and stamp it with cycle position `at`.
   * @returns {number} the reading's RMS
   */
  sample(at) {
    const analyser = this.ensureAnalyser();
    analyser.getFloatTimeDomainData(this.buffer);
    const value = rms(this.buffer);
    this.readings.push({ at, rms: value });
    const cutoff = at - this.keep;
    while (this.readings.length && this.readings[0].at < cutoff) {
      this.readings.shift();
    }
    return value;
  }

  /** Combined RMS of the readings in [from, to) cycles, or undefined. */
  rmsOver(from, to) {
    return rmsOver(this.readings, from, to);
  }

  /** Forget all readings (a new switch measures afresh). */
  clear() {
    this.readings = [];
  }

  /** Disconnect the analyser from the output. Only the tap is removed, never the output's other connections. */
  destroy() {
    if (this.analyser) {
      try {
        this.source.disconnect(this.analyser);
      } catch (error) {
        console.warn('[LoudnessMeter] disconnect failed:', error);
      }
      this.analyser = null;
      this.buffer = null;
    }
    this.readings = [];
  }
}
