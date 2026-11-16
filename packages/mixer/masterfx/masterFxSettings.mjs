/**
 * masterFxSettings.mjs - the Master FX settings: choices, ranges, defaults and a sanitiser
 * (spec 032 functional §2.2–2.4). Pure.
 *
 * The filter position is not a setting: every page load starts centred (off).
 *
 * @license AGPL-3.0-or-later
 */

/** Delay times, as fractions of a cycle. */
export const MASTER_FX_DELAY_FRACTIONS = Object.freeze([1 / 8, 3 / 16, 1 / 4, 3 / 8]);
/** Beat-repeat slice lengths, in cycles (the Repeat length button steps through them in this order). */
export const MASTER_FX_REPEAT_LENGTHS = Object.freeze([1 / 2, 1 / 4, 1 / 8, 1 / 16]);

/** Numeric ranges (inclusive). Resonance, feedback and levels are 0..1 (the UI shows %). */
export const MASTER_FX_RANGES = Object.freeze({
  filter: Object.freeze({ min: -100, max: 100, deadZone: 3 }),
  resonance: Object.freeze({ min: 0, max: 1 }),
  delayFeedback: Object.freeze({ min: 0, max: 0.9 }),
  delayLevel: Object.freeze({ min: 0, max: 1 }),
  reverbDecay: Object.freeze({ min: 1, max: 8 }),
  reverbLevel: Object.freeze({ min: 0, max: 1 }),
});

/**
 * @typedef {object} MasterFxSettings
 * @property {number} resonance - 0..1.
 * @property {{fraction: number, feedback: number, level: number}} delay
 * @property {{decay: number, level: number}} reverb - decay in seconds.
 * @property {number} repeatLength - Cycles, one of {@link MASTER_FX_REPEAT_LENGTHS}.
 */

/** @type {Readonly<MasterFxSettings>} */
export const MASTER_FX_DEFAULTS = Object.freeze({
  resonance: 0.3,
  delay: Object.freeze({ fraction: 3 / 16, feedback: 0.55, level: 0.7 }),
  reverb: Object.freeze({ decay: 3, level: 0.7 }),
  repeatLength: 1 / 4,
});

/** localStorage key the app keeps the settings under. */
export const MASTER_FX_STORAGE_KEY = 'strudel-master-fx';

const num = (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
/** `v` if it is a finite number within the range, else `fallback`. */
function inRange(v, { min, max }, fallback) {
  const n = num(v);
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
/** The choice `v` is (within float rounding), else `fallback`. */
function oneOf(v, choices, fallback) {
  const n = num(v);
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  const hit = choices.find((c) => Math.abs(c - n) < 1e-9);
  return hit ?? fallback;
}

/**
 * Clean settings from anything (a stored blob, an import): every field out of range, of the wrong
 * type or missing falls back to its default; the others are kept.
 * @param {any} raw
 * @returns {MasterFxSettings}
 */
export function sanitizeMasterFxSettings(raw) {
  const d = MASTER_FX_DEFAULTS;
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const delay = r.delay && typeof r.delay === 'object' ? r.delay : {};
  const reverb = r.reverb && typeof r.reverb === 'object' ? r.reverb : {};
  return {
    resonance: inRange(r.resonance, MASTER_FX_RANGES.resonance, d.resonance),
    delay: {
      fraction: oneOf(delay.fraction, MASTER_FX_DELAY_FRACTIONS, d.delay.fraction),
      feedback: inRange(delay.feedback, MASTER_FX_RANGES.delayFeedback, d.delay.feedback),
      level: inRange(delay.level, MASTER_FX_RANGES.delayLevel, d.delay.level),
    },
    reverb: {
      decay: inRange(reverb.decay, MASTER_FX_RANGES.reverbDecay, d.reverb.decay),
      level: inRange(reverb.level, MASTER_FX_RANGES.reverbLevel, d.reverb.level),
    },
    repeatLength: oneOf(r.repeatLength, MASTER_FX_REPEAT_LENGTHS, d.repeatLength),
  };
}

/**
 * The repeat length after `current` (1/2 → 1/4 → 1/8 → 1/16 → 1/2); an unknown one gives the first.
 * @param {number} current
 * @returns {number}
 */
export function nextRepeatLength(current) {
  const i = MASTER_FX_REPEAT_LENGTHS.findIndex((c) => Math.abs(c - current) < 1e-9);
  return MASTER_FX_REPEAT_LENGTHS[(i + 1) % MASTER_FX_REPEAT_LENGTHS.length];
}
