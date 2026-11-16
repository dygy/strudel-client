/**
 * volume - the speakers and headphones volume (spec 031 tech §2.4).
 *
 * Each output has one permanent GainNode at its very end (speakers: after the main EQ, before the
 * destination; headphones: the end of PreviewEngine's chain). It is separate from superdough's
 * destinationGain, which the Dip transition automates, so a Dip never fights the volume and its
 * restore lands on unity × volume. Recorders and the level meter tap upstream of it.
 *
 * The level is 0..1 on a squared taper (`gain = v²`: 1 → exactly 1, 0.7 → −6.2 dB, 0 → silence), and
 * every change is a 20 ms linear ramp anchored at the current gain: never a jump.
 *
 * @license AGPL-3.0-or-later
 */

/** Every volume change ramps over this many seconds. */
export const VOLUME_RAMP_SECONDS = 0.02;
/** localStorage key of the speakers volume (a number 0..1 as a string; default '1'). */
export const SPEAKERS_VOLUME_STORAGE_KEY = 'strudel-volume-speakers';
/** localStorage key of the headphones volume (a number 0..1 as a string; default '1'). */
export const HEADPHONES_VOLUME_STORAGE_KEY = 'strudel-volume-headphones';

/** The last gain each param was sent to by setVolume / createVolumeNode. */
const targets = new WeakMap();

/**
 * A volume level kept in 0..1; anything that is not a finite number is 1 (unity).
 * @param {any} v
 * @returns {number}
 */
export function clampVolume(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

/**
 * The gain of a volume level: the squared taper. `volumeGain(1)` is exactly 1 (today's level),
 * `volumeGain(0)` is 0, `volumeGain(0.7)` ≈ 0.49 (−6.2 dB). The level is clamped first.
 * @param {number} v01
 * @returns {number}
 */
export function volumeGain(v01) {
  const v = clampVolume(v01);
  return v * v;
}

/**
 * Ramp `param` to the gain of `v01` over {@link VOLUME_RAMP_SECONDS}: cancel what is scheduled,
 * anchor at the current value, ramp linearly. Nothing is scheduled when the target is unchanged or
 * `v01` is not a finite number.
 * @param {AudioParam} param - A volume node's `gain`.
 * @param {number} v01 - The level, 0..1 (clamped).
 * @param {BaseAudioContext} ctx - The param's context (for its clock).
 * @returns {boolean} Whether a ramp was scheduled.
 */
export function setVolume(param, v01, ctx) {
  if (!param || !ctx || typeof v01 !== 'number' || !Number.isFinite(v01)) return false;
  const target = volumeGain(v01);
  const last = targets.has(param) ? targets.get(param) : param.value;
  if (last === target) return false;
  const now = ctx.currentTime;
  const current = param.value; // read before cancelling: where the ramp starts
  param.cancelScheduledValues(now);
  param.setValueAtTime(current, now);
  param.linearRampToValueAtTime(target, now + VOLUME_RAMP_SECONDS);
  targets.set(param, target);
  return true;
}

/**
 * Create a volume GainNode at level `v01`. At level 1 its gain is left at the default, exactly 1
 * (bit-for-bit today's output). Another level is set before the node is connected (so inaudibly).
 * The caller connects it and keeps it for good: a volume node is never re-created per change.
 * @param {BaseAudioContext} ctx
 * @param {number} [v01=1]
 * @returns {GainNode}
 */
export function createVolumeNode(ctx, v01 = 1) {
  const node = ctx.createGain();
  const gain = volumeGain(v01);
  if (gain !== 1) node.gain.setValueAtTime(gain, ctx.currentTime);
  targets.set(node.gain, gain);
  return node;
}

/**
 * Read a stored volume level: 1 when missing, unreadable or junk.
 * @param {Storage|null|undefined} storage
 * @param {string} key - {@link SPEAKERS_VOLUME_STORAGE_KEY} or {@link HEADPHONES_VOLUME_STORAGE_KEY}.
 * @returns {number}
 */
export function readVolume(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw == null ? 1 : clampVolume(raw);
  } catch {
    return 1;
  }
}

/**
 * Store a volume level (clamped, as a string). A storage that throws is ignored.
 * @param {Storage|null|undefined} storage
 * @param {string} key
 * @param {number} v01
 * @returns {void}
 */
export function writeVolume(storage, key, v01) {
  try {
    storage?.setItem(key, String(clampVolume(v01)));
  } catch {
    /* storage full or blocked: the level lasts for this page only */
  }
}
