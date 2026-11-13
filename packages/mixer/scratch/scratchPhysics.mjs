/**
 * scratchPhysics.mjs - the turntable's motor and brake (spec 023, tech §1–2).
 *
 * Pure: no Web Audio, no DOM, no browser globals. The scratch worklet (scratchDsp.mjs) runs
 * these curves per sample, and the on-screen platter runs the same ones per frame, so the
 * picture and the sound slow down and spin up together.
 *
 * Rates are in × normal speed (1 = the record turning at 33⅓ rpm, 0 = stopped). Lag is how far
 * the record is behind the live input, in seconds.
 *
 * @module @strudel/mixer/scratch/scratchPhysics
 * @license AGPL-3.0-or-later
 */

/** Grabbing a turning record stops it over this many seconds. */
export const SCRATCH_BRAKE_SECONDS = 0.1;
/** Letting go: the motor brings the record from standstill to normal speed over this many seconds. */
export const SCRATCH_SPINUP_SECONDS = 0.4;
/** The shortest and longest the spin-up may be stretched to land on the snapped lag. */
export const SCRATCH_SPINUP_MIN_SECONDS = 0.2;
export const SCRATCH_SPINUP_MAX_SECONDS = 0.8;
/** The record-to-live hand-over crossfade, in seconds. */
export const SCRATCH_HANDOVER_SECONDS = 0.02;
/** Snap to beat: one beat is this many cycles (a quarter cycle). */
export const SCRATCH_SNAP_BEAT_CYCLES = 0.25;
/**
 * A lag shorter than this is not worth a pattern shift: the motor catches up instead (lag 0).
 * It also keeps the hand-over (crossfade plus margin) inside the window where the record and
 * the shifted live input hold the same audio.
 */
export const SCRATCH_MIN_SHIFT_SECONDS = 0.05;
/** Catching up to lag 0 may run the record at most this fast. */
export const SCRATCH_MAX_CATCHUP_RATE = 1.5;
/** Landing on a snapped lag above the spin-up's reach runs the record at most this fast (when it can). */
export const SCRATCH_MAX_SNAP_RATE = 1.1;
/** Falling further behind slows the record to at least this rate. */
export const SCRATCH_MIN_CORRECTION_RATE = 0.5;
/** The shortest correction bump, in seconds. */
export const SCRATCH_MIN_BUMP_SECONDS = 0.05;
/** A correction at the snap limit may last this long before it is allowed to run faster. */
export const SCRATCH_MAX_BUMP_SECONDS = 1.5;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/**
 * Raised cosine from 0 (x ≤ 0) to 1 (x ≥ 1), with zero slope at both ends: the curve every
 * motor change follows, so the pitch glides and never steps.
 * @param {number} x
 * @returns {number}
 */
export function scratchSmoothStep(x) {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

/**
 * The record's rate `t` seconds into the brake, from `fromRate` down to 0.
 * @param {number} t
 * @param {number} fromRate
 * @param {number} [seconds=SCRATCH_BRAKE_SECONDS]
 */
export function scratchBrakeRate(t, fromRate, seconds = SCRATCH_BRAKE_SECONDS) {
  return fromRate * (1 - scratchSmoothStep(t / seconds));
}

/**
 * The record's rate `t` seconds into the spin-up, from `fromRate` to 1.
 * @param {number} t
 * @param {number} fromRate
 * @param {number} [seconds=SCRATCH_SPINUP_SECONDS]
 */
export function scratchSpinUpRate(t, fromRate, seconds = SCRATCH_SPINUP_SECONDS) {
  return fromRate + (1 - fromRate) * scratchSmoothStep(t / seconds);
}

/**
 * Plan the spin-up after a release.
 *
 * The lag at the end of a nominal spin-up is `lag + (1 − fromRate)·0.4/2` (the raised cosine
 * averages ½). With snap on (`beatSeconds > 0`) the target is that rounded to the nearest beat;
 * with snap off it is that. A target under {@link SCRATCH_MIN_SHIFT_SECONDS} becomes 0 (the
 * motor catches up and no pattern shift is needed). The spin-up is stretched within
 * [0.2, 0.8] s to land on the target; what it can't reach is left to a correction bump (see
 * {@link scratchBumpSeconds}).
 *
 * @param {object} args
 * @param {number} args.lagSeconds - Lag at the release.
 * @param {number} args.fromRate - The record's rate at the release.
 * @param {number} [args.beatSeconds=0] - One beat in seconds; 0 = snap off.
 * @param {number} [args.maxLagSeconds=Infinity] - The largest lag the record can hold.
 * @returns {{ targetSeconds: number, upSeconds: number, fromRate: number, nominalSeconds: number }}
 */
export function planScratchSpinUp({ lagSeconds, fromRate, beatSeconds = 0, maxLagSeconds = Infinity }) {
  const lag = Number.isFinite(lagSeconds) && lagSeconds > 0 ? lagSeconds : 0;
  const v0 = Number.isFinite(fromRate) ? clamp(fromRate, -8, 8) : 0;
  const beat = Number.isFinite(beatSeconds) && beatSeconds > 0 ? beatSeconds : 0;
  const nominal = lag + ((1 - v0) * SCRATCH_SPINUP_SECONDS) / 2;
  let target = beat ? Math.round(nominal / beat) * beat : nominal;
  if (target < SCRATCH_MIN_SHIFT_SECONDS) target = 0;
  if (Number.isFinite(maxLagSeconds) && target > maxLagSeconds) {
    target = beat ? Math.floor(maxLagSeconds / beat) * beat : maxLagSeconds;
    if (target < SCRATCH_MIN_SHIFT_SECONDS) target = 0;
  }
  let up = SCRATCH_SPINUP_SECONDS;
  if (Math.abs(1 - v0) > 1e-6) {
    const exact = (2 * (target - lag)) / (1 - v0);
    up = Number.isFinite(exact) ? clamp(exact, SCRATCH_SPINUP_MIN_SECONDS, SCRATCH_SPINUP_MAX_SECONDS) : up;
  }
  return { targetSeconds: target, upSeconds: up, fromRate: v0, nominalSeconds: nominal };
}

/**
 * A correction lasts at least this long, so its depth grows with the error instead of always
 * being the largest allowed (a 50 ms correction is a depth of ~0.14, not an octave's half speed).
 */
export const SCRATCH_GENTLE_CORRECTION_SECONDS = 0.7;
/** An error below this (the spin-up's own rounding) is landed with a short, inaudible bump. */
export const SCRATCH_RESIDUAL_SECONDS = 0.001;

/**
 * How long the correction bump after the spin-up lasts. The bump runs the record at
 * `1 − k·sin²(πt/T)`, which changes the lag by `k·T/2`, so `k = 2·error/T` (see
 * {@link scratchBumpDepth}). It lasts at least {@link SCRATCH_GENTLE_CORRECTION_SECONDS}, so the
 * depth is proportional to the error until it reaches its limit, then it lasts longer:
 * - falling further behind (`errorSeconds > 0`): `k ≤ 0.5` (rate ≥ 0.5);
 * - catching up to a snapped lag: `k ≤ 0.1` (rate ≤ 1.1) for up to 1.5 s, then faster, up to 1.5;
 * - catching up to lag 0 (`toZero`): `k ≤ 0.5` (rate ≤ 1.5).
 * @param {number} errorSeconds - Target lag minus the lag after the spin-up.
 * @param {boolean} [toZero=false]
 * @returns {number} Seconds (≥ 0.05).
 */
export function scratchBumpSeconds(errorSeconds, toZero = false) {
  const e = Math.abs(errorSeconds);
  if (!(e >= SCRATCH_RESIDUAL_SECONDS)) return SCRATCH_MIN_BUMP_SECONDS;
  let limit;
  if (errorSeconds > 0) limit = 1 - SCRATCH_MIN_CORRECTION_RATE;
  else if (toZero) limit = SCRATCH_MAX_CATCHUP_RATE - 1;
  else limit = SCRATCH_MAX_SNAP_RATE - 1;
  let seconds = Math.max(SCRATCH_GENTLE_CORRECTION_SECONDS, (2 * e) / limit);
  if (errorSeconds < 0 && !toZero && seconds > SCRATCH_MAX_BUMP_SECONDS) {
    seconds = Math.max(SCRATCH_MAX_BUMP_SECONDS, (2 * e) / (SCRATCH_MAX_CATCHUP_RATE - 1));
  }
  return seconds;
}

/**
 * The bump's depth `k` (positive = slower) that changes the lag by `errorSeconds` over `seconds`.
 * @param {number} errorSeconds
 * @param {number} seconds
 */
export function scratchBumpDepth(errorSeconds, seconds) {
  return seconds > 0 && Number.isFinite(errorSeconds) ? (2 * errorSeconds) / seconds : 0;
}

/**
 * The whole release, as the worklet will run it: the spin-up (see {@link planScratchSpinUp})
 * and the correction bump that lands the lag on the target. The worklet sends this once per
 * release so the platter on screen follows the same curve.
 * @param {object} args - As {@link planScratchSpinUp}, plus `minLagSeconds` (the lag of "now").
 * @returns {{ targetSeconds: number, upSeconds: number, fromRate: number, nominalSeconds: number,
 *   bumpSeconds: number, bumpDepth: number, settleSeconds: number }}
 */
export function planScratchRelease(args) {
  const spin = planScratchSpinUp(args);
  const lag = Number.isFinite(args.lagSeconds) && args.lagSeconds > 0 ? args.lagSeconds : 0;
  const afterUp = lag + ((1 - spin.fromRate) * spin.upSeconds) / 2;
  const target = Math.max(spin.targetSeconds, Number.isFinite(args.minLagSeconds) ? args.minLagSeconds : 0);
  const error = target - afterUp;
  const bumpSeconds = Math.abs(error) > 1e-9 ? scratchBumpSeconds(error, spin.targetSeconds === 0) : 0;
  const bumpDepth = scratchBumpDepth(error, bumpSeconds);
  return { ...spin, bumpSeconds, bumpDepth, settleSeconds: spin.upSeconds + bumpSeconds };
}

/**
 * The record's rate `t` seconds after a release that follows `plan` ({@link planScratchRelease}).
 * @param {number} t
 * @param {{upSeconds: number, bumpSeconds: number, bumpDepth: number}} plan
 * @param {number} [fromRate=plan.fromRate] - The rate at the release.
 */
export function scratchReleaseRate(t, plan, fromRate = plan.fromRate) {
  if (t < plan.upSeconds) return scratchSpinUpRate(t, fromRate, plan.upSeconds);
  const tb = t - plan.upSeconds;
  if (plan.bumpSeconds > 0 && tb < plan.bumpSeconds) {
    const s = Math.sin((Math.PI * tb) / plan.bumpSeconds);
    return 1 - plan.bumpDepth * s * s;
  }
  return 1;
}

/**
 * The beat in seconds for snap to beat: a quarter cycle at `cps`. 0 when the tempo is unknown.
 * @param {number} cps
 */
export function scratchBeatSeconds(cps) {
  return Number.isFinite(cps) && cps > 0 ? SCRATCH_SNAP_BEAT_CYCLES / cps : 0;
}
