/**
 * Envelope shapes for track transitions (spec 017, tech §2.3).
 *
 * Pure functions of a progress value `p` in [0, 1] across the transition window [T, T+L],
 * plus helpers that combine an envelope with a hap's own control values. No Web Audio here:
 * every envelope is applied per event, through the controls superdough reads
 * (`velocity`, `cutoff`, `hcutoff`, `orbit`, `delay`, `delayfeedback`, `delaysync`, `clip`).
 *
 * @module @strudel/mixer/transitions/envelopes
 * @license AGPL-3.0-or-later
 */

import { Fraction, Hap, TimeSpan } from '@strudel/core';

/** Filter sweep: the old track's high-pass opens from this frequency (Hz)... */
export const SWEEP_HP_FROM = 20;
/** ...to this one, exponentially. */
export const SWEEP_HP_TO = 2000;
/** Filter sweep: the new track's low-pass opens from this frequency (Hz)... */
export const SWEEP_LP_FROM = 300;
/** ...to this one, exponentially (effectively fully open). */
export const SWEEP_LP_TO = 20000;
/** Bass swap: the high-pass that removes a track's low end (Hz). */
export const BASS_SWAP_HZ = 250;
/** Echo-out: the orbit the old track's last notes are sent to. High so it rarely collides with a user orbit. */
export const ECHO_ORBIT = 15;
/** Echo-out: delay send level of the old track's last notes. */
export const ECHO_SEND = 0.7;
/** Echo-out: delay time in cycles when the hap sets no `delaytime` (a beat in 4/4). */
export const ECHO_SYNC = 1 / 4;
/** Echo-out: feedback cap, so a long transition never builds a near-endless loop. */
export const ECHO_MAX_FEEDBACK = 0.85;
/** Echo-out: the tail decays by this many dB over the transition length. */
export const ECHO_DECAY_DB = 60;

/** Clamp `x` into [lo, hi]. */
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Progress of cycle position `t` through the window [T, T+L], clamped to [0, 1].
 * A window of length 0 is a step at T.
 */
export function progress(t, T, L) {
  if (!(L > 0)) {
    return t < T ? 0 : 1;
  }
  return clamp((t - T) / L, 0, 1);
}

/** Equal-power fade-out gain: 1 at p = 0, 0 at p = 1, cos² + sin² = 1 with `equalPowerIn`. */
export const equalPowerOut = (p) => Math.cos((Math.PI / 2) * clamp(p, 0, 1));

/** Equal-power fade-in gain: 0 at p = 0, 1 at p = 1. */
export const equalPowerIn = (p) => Math.sin((Math.PI / 2) * clamp(p, 0, 1));

/** Exponential sweep between two frequencies (Hz): `from` at p = 0, `to` at p = 1. */
export const expSweep = (from, to, p) => from * Math.pow(to / from, clamp(p, 0, 1));

/** The old track's high-pass during a filter sweep: 20 Hz → 2 kHz. */
export const sweepHighpass = (p) => expSweep(SWEEP_HP_FROM, SWEEP_HP_TO, p);

/** The new track's low-pass during a filter sweep: 300 Hz → 20 kHz. */
export const sweepLowpass = (p) => expSweep(SWEEP_LP_FROM, SWEEP_LP_TO, p);

/** A high-pass envelope never lowers the user's own high-pass: the higher cutoff wins. */
export const combineHighpass = (user, env) => (typeof user === 'number' ? Math.max(user, env) : env);

/** A low-pass envelope never opens the user's own low-pass: the lower cutoff wins. */
export const combineLowpass = (user, env) => (typeof user === 'number' ? Math.min(user, env) : env);

/**
 * Echo-out feedback so the tail decays about `ECHO_DECAY_DB` over `lengthCycles`, capped.
 * @param {number} lengthCycles transition length in cycles
 * @param {number} repeatCycles delay time in cycles (one repeat)
 */
export function echoFeedback(lengthCycles, repeatCycles) {
  const repeats = lengthCycles / repeatCycles;
  if (!(repeats > 0) || !Number.isFinite(repeats)) {
    return ECHO_MAX_FEEDBACK;
  }
  return Math.min(ECHO_MAX_FEEDBACK, Math.pow(10, -ECHO_DECAY_DB / 20 / repeats));
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Apply `func(value)` to a hap whose value is a control object; other values pass unchanged
 * (they reach no audio output that reads controls).
 */
export function mapControls(hap, func) {
  if (!isObject(hap.value)) {
    return hap;
  }
  return hap.withValue((value) => func(value));
}

/** Multiply a hap's `velocity` (superdough: gain *= velocity) without touching gain or postgain. */
export const scaleVelocity = (value, factor) =>
  factor === 1 ? value : { ...value, velocity: (typeof value.velocity === 'number' ? value.velocity : 1) * factor };

/**
 * The cycle position an envelope is sampled at for one event: the middle of the part of the
 * event that lies before `windowEnd` (its onset if it starts at or after `windowEnd`).
 *
 * Sampling at the onset alone (tech §2.3) leaves a long new note that starts exactly at T
 * silent for its whole length (sin 0 = 0); the middle of its audible span is its average level.
 * For short notes the two are practically the same.
 */
export function samplePoint(hap, windowEnd) {
  const whole = hap.whole ?? hap.part;
  const onset = whole.begin.valueOf();
  const end = Math.min(onset + hap.duration.valueOf(), windowEnd);
  return end > onset ? (onset + end) / 2 : onset;
}

/** The onset of a hap in cycles (whole begin; part begin for continuous haps). */
export const onsetOf = (hap) => (hap.whole ?? hap.part).begin.valueOf();

/**
 * End a hap at cycle `end`: its spans are cut at `end`, and its control `clip` is lowered so
 * the duration the scheduler hands to the output (whole length or `duration`, times `clip`)
 * ends at `end` too. `clip` is set even where it was unset, so samples (which otherwise play
 * their full length) are cut as well (tech §3 risk: samples ignore event duration).
 * Haps that already end by `end` are returned unchanged.
 *
 * @param {Hap} hap
 * @param {number} end cycle
 * @returns {Hap}
 */
export function truncateHap(hap, end) {
  if (!hap.whole) {
    if (hap.part.end.valueOf() <= end) {
      return hap;
    }
    return new Hap(undefined, new TimeSpan(hap.part.begin, Fraction(end)), hap.value, hap.context);
  }
  const onset = hap.whole.begin.valueOf();
  const allowed = end - onset;
  const wholeEnd = hap.whole.end.valueOf();
  if (wholeEnd <= end && hap.duration.valueOf() <= allowed) {
    return hap;
  }
  const endF = Fraction(end);
  const whole = wholeEnd > end ? new TimeSpan(hap.whole.begin, endF) : hap.whole;
  const part = hap.part.end.valueOf() > end ? new TimeSpan(hap.part.begin, endF) : hap.part;
  let value = hap.value;
  if (isObject(value)) {
    const base = typeof value.duration === 'number' ? value.duration : whole.end.valueOf() - onset;
    const fit = base > 0 ? allowed / base : 1;
    const clip = Math.min(typeof value.clip === 'number' ? value.clip : 1, fit);
    value = { ...value, clip };
  }
  return new Hap(whole, part, value, hap.context);
}
