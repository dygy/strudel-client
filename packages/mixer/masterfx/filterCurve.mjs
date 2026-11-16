/**
 * filterCurve.mjs - the master filter knob's mapping (spec 032 functional §2.2, tech §2.2). Pure.
 *
 * One knob, −100 … +100. Inside the dead zone (|pos| ≤ 3) the filter is off: the stage plays the
 * dry signal only. Left of it is a low-pass whose cutoff falls from 20 kHz to 150 Hz at −100;
 * right of it a high-pass whose cutoff rises from 20 Hz to 6 kHz at +100. Both curves are
 * exponential in the knob travel past the dead zone, so the sweep sounds even and starts open
 * (no jump when leaving the dead zone). The side not in use stays open, with a flat Q.
 *
 * @license AGPL-3.0-or-later
 */

/** The knob's range. */
export const MASTER_FX_FILTER_MIN = -100;
export const MASTER_FX_FILTER_MAX = 100;
/** |pos| at or below this is off (dry only). */
export const MASTER_FX_FILTER_DEAD_ZONE = 3;
/** Low-pass cutoff at the dead zone's edge (open) and at −100. */
export const MASTER_FX_LP_OPEN_HZ = 20000;
export const MASTER_FX_LP_CLOSED_HZ = 150;
/** High-pass cutoff at the dead zone's edge (open) and at +100. */
export const MASTER_FX_HP_OPEN_HZ = 20;
export const MASTER_FX_HP_CLOSED_HZ = 6000;
/** Q at resonance 0 (Butterworth, flat) and the extra Q at resonance 1. */
export const MASTER_FX_Q_FLAT = 0.707;
export const MASTER_FX_Q_RANGE = 7.3;

/**
 * A knob position kept in −100 … +100; anything that is not a finite number is 0 (off).
 * @param {any} pos
 * @returns {number}
 */
export function clampFilterPosition(pos) {
  return typeof pos === 'number' && Number.isFinite(pos)
    ? Math.min(MASTER_FX_FILTER_MAX, Math.max(MASTER_FX_FILTER_MIN, pos))
    : 0;
}

/**
 * The filter settings for a knob position and a resonance.
 * @param {number} pos - −100 … +100 (clamped; junk is 0).
 * @param {number} r01 - Resonance 0 … 1 (clamped; junk is 0).
 * @returns {{wet: number, side: ('off'|'lp'|'hp'), lpHz: number, hpHz: number, q: number, lpQ: number, hpQ: number}}
 *   `wet` 0 (dry only) or 1 (filtered only); `q` is the resonant Q of the side in use, `lpQ`/`hpQ`
 *   what each biquad gets (the open side stays flat).
 */
export function filterParams(pos, r01) {
  const p = clampFilterPosition(pos);
  const r = typeof r01 === 'number' && Number.isFinite(r01) ? Math.min(1, Math.max(0, r01)) : 0;
  const q = MASTER_FX_Q_FLAT + r * MASTER_FX_Q_RANGE;
  const open = { lpHz: MASTER_FX_LP_OPEN_HZ, hpHz: MASTER_FX_HP_OPEN_HZ };
  if (Math.abs(p) <= MASTER_FX_FILTER_DEAD_ZONE) {
    return { wet: 0, side: 'off', ...open, q, lpQ: MASTER_FX_Q_FLAT, hpQ: MASTER_FX_Q_FLAT };
  }
  const t = (Math.abs(p) - MASTER_FX_FILTER_DEAD_ZONE) / (MASTER_FX_FILTER_MAX - MASTER_FX_FILTER_DEAD_ZONE);
  if (p < 0) {
    const lpHz = MASTER_FX_LP_OPEN_HZ * Math.pow(MASTER_FX_LP_CLOSED_HZ / MASTER_FX_LP_OPEN_HZ, t);
    return { wet: 1, side: 'lp', lpHz, hpHz: open.hpHz, q, lpQ: q, hpQ: MASTER_FX_Q_FLAT };
  }
  const hpHz = MASTER_FX_HP_OPEN_HZ * Math.pow(MASTER_FX_HP_CLOSED_HZ / MASTER_FX_HP_OPEN_HZ, t);
  return { wet: 1, side: 'hp', lpHz: open.lpHz, hpHz, q, lpQ: MASTER_FX_Q_FLAT, hpQ: q };
}
