/**
 * buildTransition: one pattern that plays a track transition (spec 017, tech §2.3).
 *
 * Pure: no Web Audio, no scheduler, no clock. Given the pattern that is playing (`oldPat`,
 * already on the scheduler's cycle grid) and the newly evaluated pattern (`newPat`, whose
 * cycle 0 is its own beginning), it returns a single pattern in which
 * - the old track plays until the transition's old-track end, then stops (events starting at
 *   or after it are dropped, events still sounding are cut at it), shaped by the type's envelope;
 * - the new track is shifted so its cycle 0 lands on the transition origin (`T`; Dip: `T + L`),
 *   shaped by the type's envelope over [T, T+L].
 *
 * Both halves live on one cycle grid, so they stay in time with each other by construction.
 *
 * @module @strudel/mixer/transitions/buildTransition
 * @license AGPL-3.0-or-later
 */

import { Pattern, stack } from '@strudel/core';
import {
  BASS_SWAP_HZ,
  ECHO_ORBIT,
  ECHO_SEND,
  ECHO_SYNC,
  combineHighpass,
  combineLowpass,
  echoFeedback,
  equalPowerIn,
  equalPowerOut,
  mapControls,
  onsetOf,
  progress,
  samplePoint,
  scaleVelocity,
  sweepHighpass,
  sweepLowpass,
  truncateHap,
} from './envelopes.mjs';

/**
 * Spec 031: the control a progress-driven (manual or handed-over) transition stamps on every event:
 * 'old' or 'new'. superdough records it per voice (fork addition `getActiveSoundIds(owner, side)`),
 * so the controller releases exactly one track's voices; no sound reads it.
 */
export const MIX_SIDE_CONTROL = '_mixSide';

/** Every transition type, in the order the UI lists them. */
export const TRANSITION_TYPES = Object.freeze([
  'off',
  'dip',
  'cut',
  'crossfade',
  'filterSweep',
  'bassSwap',
  'echoOut',
  'layeredIntro',
]);

/** Types where both tracks are heard at once; only these glide the tempo. */
export const OVERLAPPING_TYPES = Object.freeze(['crossfade', 'filterSweep', 'bassSwap', 'layeredIntro']);

/** True for the overlapping types (crossfade, filter sweep, bass swap, layered intro). */
export const isOverlapping = (type) => OVERLAPPING_TYPES.includes(type);

/**
 * The cycle positions of one transition.
 * - `origin`: where the new track's cycle 0 lands;
 * - `oldEnd`: nothing of the old track sounds from here on (Echo-out: its echo is the tail);
 * - `end`: the transition is over, the old pattern can be dropped.
 *
 * @param {string} type
 * @param {number} T transition start (cycles)
 * @param {number} L transition length (cycles)
 * @returns {{ origin: number, oldEnd: number, end: number }}
 */
export function transitionTiming(type, T, L) {
  switch (type) {
    case 'cut':
    case 'off':
      return { origin: T, oldEnd: T, end: T };
    case 'dip':
      return { origin: T + L, oldEnd: T + L, end: T + 2 * L };
    case 'echoOut':
      return { origin: T, oldEnd: T, end: T + L };
    default:
      return { origin: T, oldEnd: T + L, end: T + L };
  }
}

/**
 * Remove source locations from every event, so the editor highlights only the new track's code
 * while the old one is still playing (tech §3).
 * @param {Pattern} pat
 * @returns {Pattern}
 */
export const stripLocations = (pat) => pat.withContext((context) => ({ ...context, locations: [] }));

/**
 * The old pattern ending at `oldEnd`: later onsets dropped, sounding events cut at it.
 * Queries that start at or after `oldEnd` never reach the old pattern, so a finished
 * transition costs nothing even while the combined pattern is still referenced.
 */
export function endAt(pat, oldEnd) {
  return new Pattern((state) => {
    if (state.span.begin.valueOf() >= oldEnd) {
      return [];
    }
    return pat
      .query(state)
      .filter((hap) => onsetOf(hap) < oldEnd && hap.part.begin.valueOf() < oldEnd)
      .map((hap) => truncateHap(hap, oldEnd));
  });
}

/** Events of a shifted pattern before its origin belong to its negative cycles: drop them. */
export const fromOrigin = (pat, origin) => pat.filterHaps((hap) => onsetOf(hap) >= origin);

/** Old-track envelope per type, for one hap. */
function shapeOld(type, hap, { T, L, oldEnd, echoFrom, cps, progressAt }) {
  const at = samplePoint(hap, oldEnd);
  const p = progressAt ? progressAt(at) : progress(at, T, L);
  if (progressAt && type === 'echoOut') {
    // Spec 031 manual mix: once the fader has moved, the old track (playing on past T) fades with the
    // progress and its notes go to the echo.
    if (p <= 0 || onsetOf(hap) < echoFrom) {
      return hap;
    }
    return mapControls(hap, (v) => ({ ...echoControls(v, L, cps), ...scaleVelocity(v, equalPowerOut(p)) }));
  }
  if (p <= 0 && type !== 'echoOut') {
    return hap; // before the window the old track plays exactly as it was
  }
  switch (type) {
    case 'crossfade':
    case 'layeredIntro':
      return mapControls(hap, (v) => scaleVelocity(v, equalPowerOut(p)));
    case 'filterSweep':
      return mapControls(hap, (v) => ({
        ...scaleVelocity(v, equalPowerOut(p)),
        hcutoff: combineHighpass(v.hcutoff, sweepHighpass(p)),
      }));
    case 'bassSwap':
      if (p < 0.5) {
        return hap;
      }
      return mapControls(hap, (v) => ({
        ...scaleVelocity(v, equalPowerOut(2 * p - 1)),
        hcutoff: combineHighpass(v.hcutoff, BASS_SWAP_HZ),
      }));
    case 'echoOut': {
      const onset = onsetOf(hap);
      if (onset < echoFrom || onset >= T) {
        return hap;
      }
      return mapControls(hap, (v) => echoControls(v, L, cps));
    }
    default:
      return hap;
  }
}

/** Echo-out: a hap's controls sent to the echo orbit, with feedback decaying over L cycles. */
function echoControls(v, L, cps) {
  const hasTime = typeof v.delaytime === 'number';
  const sync = typeof v.delaysync === 'number' ? v.delaysync : ECHO_SYNC;
  const repeatCycles = hasTime ? v.delaytime * cps : sync;
  return {
    ...v,
    orbit: ECHO_ORBIT,
    delay: ECHO_SEND,
    delayfeedback: echoFeedback(L, repeatCycles),
    ...(hasTime ? {} : { delaysync: sync }),
  };
}

/** New-track envelope per type, for one hap inside [T, T+L] (with `progressAt`: until `newEnd`). */
function shapeNew(type, hap, { T, L, progressAt, newEnd }) {
  const windowEnd = progressAt ? newEnd : T + L;
  if (onsetOf(hap) >= windowEnd) {
    return hap;
  }
  const at = samplePoint(hap, windowEnd);
  const p = progressAt ? progressAt(at) : progress(at, T, L);
  switch (type) {
    case 'crossfade':
      return mapControls(hap, (v) => scaleVelocity(v, equalPowerIn(p)));
    // layeredIntro: each layer enters at its own level at its entry point (layeredNew drops it before).
    case 'filterSweep':
      return mapControls(hap, (v) => ({
        ...scaleVelocity(v, equalPowerIn(p)),
        cutoff: combineLowpass(v.cutoff, sweepLowpass(p)),
      }));
    case 'bassSwap':
      if (p >= 0.5) {
        return hap;
      }
      // Without its low end for the first half. It also comes in gradually over that half
      // (deviation from tech §2.3, which starts it at full level: spec 2.5 forbids volume jumps).
      return mapControls(hap, (v) => ({
        ...scaleVelocity(v, equalPowerIn(2 * p)),
        hcutoff: combineHighpass(v.hcutoff, BASS_SWAP_HZ),
      }));
    default:
      return hap;
  }
}

/**
 * Layered intro: layer k of n (in `$:` order) is silent until T + L·k/n; with `progressAt`
 * (spec 031), until the progress at its onset reaches k/n.
 * Returns undefined when the layers can't stand in for the new pattern (fewer than 2).
 */
function layeredNew(layers, T, L, progressAt) {
  if (!Array.isArray(layers) || layers.length < 2) {
    return undefined;
  }
  const n = layers.length;
  return stack(
    ...layers.map(({ pattern }, k) => {
      if (progressAt) {
        return pattern.late(T).filterHaps((hap) => onsetOf(hap) >= T && progressAt(onsetOf(hap)) >= k / n);
      }
      const entry = T + (L * k) / n;
      return pattern.late(T).filterHaps((hap) => onsetOf(hap) >= entry);
    }),
  );
}

/**
 * Build the combined pattern that plays one transition.
 *
 * @param {Object} options
 * @param {Pattern} options.oldPat the pattern playing now, on the scheduler's cycle grid
 * @param {Pattern} options.newPat the new track as evaluated (its cycle 0 is its beginning)
 * @param {Array<{id: string, pattern: Pattern}>} [options.layers] the new track's `$:` layers
 *   (repl `state.layers`); pass nothing when `all()`/`each()` transform them (the layers then
 *   don't add up to `newPat`), and Layered intro falls back to Crossfade
 * @param {number} options.T transition start in cycles
 * @param {number} options.length transition length L in cycles (ignored by Cut)
 * @param {string} options.type one of TRANSITION_TYPES except 'off'
 * @param {number} [options.cps=0.5] the old track's tempo (Echo-out converts `delaytime` with it)
 * @param {number} [options.echoFrom=T-1] Echo-out: old onsets from here to T are sent to the echo
 * @param {Function} [options.progressAt] spec 031 manual mix: `(cycle) => p` in [0, 1], used by every
 *   envelope instead of the progress through [T, T+L]. The new track still starts at T; the old one
 *   plays on (shaped by `p`) until `oldEnd`. Cut and Dip have no in-between, so they play as Crossfade;
 *   Echo-out fades the old track with `p` and sends its notes to the echo, while the
 *   new track comes in as in a Crossfade (both only while `p > 0`). Every event carries
 *   `_mixSide: 'old'|'new'` ({@link MIX_SIDE_CONTROL}). Without it, everything is as before.
 * @param {number} [options.oldEnd=Infinity] with `progressAt` only: the old track ends here (the
 *   controller sets it when a manual mix is handed to the timed path)
 * @returns {Pattern}
 */
export function buildTransition({ oldPat, newPat, layers, T, length, type, cps = 0.5, echoFrom, progressAt, oldEnd }) {
  if (!TRANSITION_TYPES.includes(type) || type === 'off') {
    throw new Error(`buildTransition: unsupported transition type "${type}"`);
  }
  if (typeof progressAt === 'function') {
    return buildProgressTransition({ oldPat, newPat, layers, T, length, type, cps, echoFrom, progressAt, oldEnd });
  }
  const L = type === 'cut' ? 0 : length;
  const { origin, oldEnd: end } = transitionTiming(type, T, L);
  const ctx = { T, L, oldEnd: end, echoFrom: echoFrom ?? T - 1, cps };

  const oldPart = endAt(stripLocations(oldPat), end).withHap((hap) => shapeOld(type, hap, ctx));

  let newShifted = type === 'layeredIntro' ? layeredNew(layers, T, L) : undefined;
  const shapeType = type === 'layeredIntro' && newShifted === undefined ? 'crossfade' : type;
  newShifted = fromOrigin(newShifted ?? newPat.late(origin), origin);
  const newPart = newShifted.withHap((hap) => shapeNew(shapeType, hap, ctx));

  return stack(oldPart, newPart);
}

/**
 * Spec 031: a transition whose envelopes follow `progressAt` (the crossfader) instead of the clock.
 * The new track's cycle 0 is at T; both tracks overlap from T until `oldEnd` (default: no end).
 */
function buildProgressTransition({ oldPat, newPat, layers, T, length, type, cps, echoFrom, progressAt, oldEnd }) {
  const kind = type === 'cut' || type === 'dip' ? 'crossfade' : type;
  const L = length;
  const end = Number.isFinite(oldEnd) ? oldEnd : Infinity;
  const ctx = { T, L, oldEnd: end, newEnd: end, echoFrom: echoFrom ?? T - 1, cps, progressAt };

  const oldSource = stripLocations(oldPat);
  const oldPart = (Number.isFinite(end) ? endAt(oldSource, end) : oldSource).withHap((hap) =>
    stampSide(shapeOld(kind, hap, ctx), 'old'),
  );

  let newShifted = kind === 'layeredIntro' ? layeredNew(layers, T, L, progressAt) : undefined;
  const shapeType = (kind === 'layeredIntro' && newShifted === undefined) || kind === 'echoOut' ? 'crossfade' : kind;
  newShifted = fromOrigin(newShifted ?? newPat.late(T), T);
  const newPart = newShifted.withHap((hap) => stampSide(shapeNew(shapeType, hap, ctx), 'new'));

  return stack(oldPart, newPart);
}

/** Spec 031: mark which track a hap belongs to (control haps only; others reach no superdough voice). */
const stampSide = (hap, side) => mapControls(hap, (v) => ({ ...v, [MIX_SIDE_CONTROL]: side }));
