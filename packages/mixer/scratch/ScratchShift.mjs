/**
 * ScratchShift.mjs - the track moves after a scratch (spec 023 tech §2.2–2.3).
 *
 * - {@link PatternOffset}: a deck's scratch offset in cycles, applied in its repl's
 *   `editPattern` as `late(offset)`. On the main deck it wraps spec 017's transition hook, so
 *   the total shift is the transition origin plus the scratch offset.
 * - {@link ScratchHandOver}: when a released record settles `D` seconds behind live, it shifts
 *   that deck's pattern late by `D·cps` cycles (synchronously, in the `lagSettled` handler).
 *   Then, once it knows the context time `S` at which the shifted audio starts:
 *   - it restarts mid-note the shifted timeline's long notes that sound at `S` (the scheduler
 *     only triggers onsets, so a pad or a `loopAt` loop would stay silent until its next one);
 *   - it fades out this deck's voices of the old timeline, ending at `S`;
 *   - it tells the worklet to cross-fade from the record to live at `S` (plus a margin).
 *
 *   With core's Cyclist, `S` is known at once (its last query end). With NeoCyclist (sync mode)
 *   it is taken from the scheduler's first query of the shifted pattern. Either way nothing is
 *   left on a main-thread timer: a stop, Update or track switch can't be overtaken by it.
 *
 * Patterns are deterministic in cycle time, so the record `D` seconds back and the shifted live
 * input hold the same audio and the crossfade is coherent. Known limits: real-time inputs
 * (mouse, MIDI in, `Math.random`) don't repeat; a restarted note is a new voice (its LFOs and
 * effect tails start afresh); notes other than superdough synths and samples (soundfonts, MIDI,
 * OSC) are not restarted.
 *
 * @license AGPL-3.0-or-later
 */

import { stack } from '@strudel/core';
import { endAt, fromOrigin } from '../transitions/buildTransition.mjs';
import {
  getADSRValues,
  getActiveSoundIds,
  getDefaultValue,
  getFrequencyFromValue,
  getLoadedBuffer,
  getSampleInfo,
  getSound,
  registerSound,
  releaseSounds,
  superdough,
} from 'superdough';

/** The old timeline's voices fade over this many seconds, ending where the shifted audio starts. */
export const SCRATCH_STALE_RELEASE_SECONDS = 0.03;
/** The hand-over starts this long after the shifted audio's first sample. */
export const SCRATCH_HANDOVER_MARGIN_SECONDS = 0.005;
/** A note restarted mid-way fades in over this long (no click). */
export const SCRATCH_RESTART_FADE_SECONDS = 0.01;
/**
 * The envelope superdough's synths use when a note sets none of attack/decay/sustain/release
 * (mirrors `superdough/synth.mjs`, the `defaultValues` of every synth's `getADSRValues` call).
 */
export const SUPERDOUGH_SYNTH_ADSR_DEFAULTS = Object.freeze([0.001, 0.05, 0.6, 0.01]);

/**
 * A deck's persistent scratch offset (spec 023 2.3).
 *
 * `editPattern(pattern, inner)` is the repl's hook: it records the raw pattern, runs `inner`
 * (spec 017's transition hook on the main deck) and shifts the result late by the offset. With
 * offset 0 it returns `inner`'s result untouched (the very same object when `inner` passes it
 * through), so plain playback is unchanged.
 *
 * While a track switch is building (`isBusy()`), the offset is dropped: the old track already
 * carries it inside the scheduler's pattern (which the transition reuses), and the new track
 * starts from its own cycle 0. A same-track Update evaluates while idle and keeps the offset.
 * `reset()` (on stop) sets it to 0.
 */
export class PatternOffset {
  /**
   * @param {object} [options]
   * @param {() => any} [options.getRepl] - The deck's repl (`setPattern`, `scheduler`).
   * @param {() => boolean} [options.isBusy] - A track switch is evaluating or running.
   */
  constructor({ getRepl, isBusy } = {}) {
    this.getRepl = getRepl;
    this.isBusy = isBusy;
    /** The offset in cycles. */
    this.cycles = 0;
    /** The last raw (un-edited) pattern the repl set. */
    this.raw = null;
    /** @type {((cycle: number) => void)|null} called once on the scheduler's first query */
    this._probe = null;
    /**
     * A shift that starts at a later cycle (re-review 4: an Update during the spin-up shifts the
     * track from the moment the record reaches its lag): `{ atCycle, cycles }`, or null.
     */
    this.pending = null;
    /** The last fully shifted pattern (pending shift included), for the long-note restart. */
    this.shifted = null;
    this.editPattern = this.editPattern.bind(this);
  }

  /** The whole offset in cycles, a pending one included. */
  get total() {
    return this.cycles + (this.pending?.cycles ?? 0);
  }

  /** @private The scheduler's current cycle, or NaN. */
  _cycleNow() {
    try {
      const now = this.getRepl?.()?.scheduler?.now?.();
      return Number.isFinite(now) ? now : NaN;
    } catch {
      return NaN;
    }
  }

  /** @private */
  _busy() {
    try {
      return Boolean(this.isBusy?.());
    } catch (err) {
      console.warn('[PatternOffset] isBusy failed:', err?.message ?? err);
      return false;
    }
  }

  /**
   * The repl's `editPattern` hook.
   * @param {import('@strudel/core').Pattern} pattern
   * @param {(pattern: any) => any} [inner] - Runs first (the transition hook).
   * @returns {import('@strudel/core').Pattern}
   */
  editPattern(pattern, inner) {
    this.raw = pattern;
    if ((this.cycles !== 0 || this._probe || this.pending) && this._busy()) {
      this.cycles = 0;
      this._probe = null;
      this.pending = null;
    }
    // A pending shift whose start has long passed is just part of the offset now.
    if (this.pending && this._cycleNow() >= this.pending.atCycle + 1) {
      this.cycles += this.pending.cycles;
      this.pending = null;
    }
    const edited = (inner ? inner(pattern) : pattern) ?? pattern;
    const canShift = typeof edited?.late === 'function';
    let result = this.cycles !== 0 && canShift ? edited.late(this.cycles) : edited;
    if (this.pending && canShift) {
      // Until the pending start the track plays on unshifted (notes crossing it are cut there),
      // from it on shifted (only onsets from it: the long notes are restarted by the hand-over).
      const { atCycle, cycles, endCycle = atCycle } = this.pending;
      const later = result.late(cycles);
      this.shifted = later;
      result = stack(endAt(result, Math.min(endCycle, atCycle)), fromOrigin(later, atCycle));
    } else {
      this.shifted = result;
    }
    if (this._probe && typeof result?.withState === 'function') result = this._withProbe(result);
    return result;
  }

  /**
   * @private The pattern, plus a one-shot hook on the scheduler's first query (its state carries
   * the `cyclist` control; the drawer's and our own queries don't).
   */
  _withProbe(pattern) {
    const probed = pattern.withState((state) => {
      const probe = this._probe;
      if (probe && state?.controls?.cyclist) {
        this._probe = null;
        try {
          probe(Number(state.span.begin.valueOf()));
        } catch (err) {
          console.warn('[PatternOffset] arrival hook failed:', err?.message ?? err);
        }
      }
      return state;
    });
    if (pattern._steps !== undefined) probed._steps = pattern._steps;
    return probed;
  }

  /**
   * Move the deck's track later by `cycles` (added to the current offset) and re-set the
   * pattern so the scheduler queries the shifted one from its next tick. Refused (false) while
   * a switch is busy, while the deck is stopped, or without a pattern.
   * @param {number} cycles
   * @param {object} [options]
   * @param {(cycle: number) => void} [options.onFirstQuery] - Called once, with the first cycle
   *   the scheduler queries of the shifted pattern (for schedulers that don't expose it).
   * @param {number} [options.atCycle] - Shift from this cycle on instead of from the next query.
   * @param {number} [options.endCycle] - With `atCycle`: where the unshifted track's notes end
   *   (default `atCycle`); a little earlier lets their release finish while nobody hears live.
   * @returns {boolean}
   */
  shift(cycles, { onFirstQuery, atCycle, endCycle } = {}) {
    if (typeof cycles !== 'number' || !Number.isFinite(cycles) || cycles === 0) return false;
    const repl = this.getRepl?.();
    if (!repl?.setPattern || !repl.scheduler?.started || !this.raw || this._busy()) return false;
    const before = this.cycles;
    const beforePending = this.pending;
    if (this.pending) {
      this.cycles += this.pending.cycles;
      this.pending = null;
    }
    if (Number.isFinite(atCycle)) {
      this.pending = Number.isFinite(endCycle) ? { atCycle, cycles, endCycle } : { atCycle, cycles };
    } else this.cycles += cycles;
    this._probe = typeof onFirstQuery === 'function' ? onFirstQuery : null;
    try {
      // Goes through the repl's own editPattern (this hook), synchronously up to the scheduler.
      Promise.resolve(repl.setPattern(this.raw, false)).catch((err) =>
        console.warn('[PatternOffset] setPattern failed:', err?.message ?? err),
      );
    } catch (err) {
      this.cycles = before;
      this.pending = beforePending;
      this._probe = null;
      console.warn('[PatternOffset] setPattern failed:', err?.message ?? err);
      return false;
    }
    return true;
  }

  /** The deck stopped: the next start is at cycle 0. */
  reset() {
    this.cycles = 0;
    this._probe = null;
    this.pending = null;
  }
}

/**
 * Where audio of a pattern set now starts, for core's Cyclist: the first cycle it will query
 * (its last query end) and that cycle's context time (plus latency). Null for schedulers that
 * don't expose those fields (NeoCyclist, in sync mode).
 * @param {object} scheduler
 * @returns {{cycle: number, time: number}|null}
 */
export function scratchShiftArrival(scheduler) {
  const latency = Number.isFinite(scheduler?.latency) ? scheduler.latency : 0.1;
  const cps = scheduler?.cps;
  const { lastEnd, num_cycles_at_cps_change: cyclesAt, seconds_at_cps_change: secondsAt } = scheduler ?? {};
  if (!Number.isFinite(lastEnd) || !(cps > 0)) return null;
  if (scheduler?.num_ticks_since_cps_change === 0 && typeof scheduler?.clock?.getPhase === 'function') {
    // The tempo just changed: the next tick re-anchors at its own phase.
    return { cycle: lastEnd, time: scheduler.clock.getPhase() + latency };
  }
  if (![cyclesAt, secondsAt].every(Number.isFinite)) return null;
  return { cycle: lastEnd, time: (lastEnd - cyclesAt) / cps + secondsAt + latency };
}

/**
 * The context time (s) at which audio of a pattern set now starts (see
 * {@link scratchShiftArrival}); for other schedulers an upper bound (now + latency + one
 * lookahead). Never earlier than `now`.
 * @param {object} scheduler
 * @param {number} now - The context's currentTime.
 * @returns {number}
 */
export function scratchShiftTime(scheduler, now) {
  const latency = Number.isFinite(scheduler?.latency) ? scheduler.latency : 0.1;
  const arrival = scratchShiftArrival(scheduler);
  const start = arrival && Number.isFinite(arrival.time) ? arrival.time : now + latency + 0.25;
  return Math.max(start, now);
}

/**
 * NeoCyclist (sync mode): the context time of `cycle` when the scheduler queries it. Its query
 * runs right after it took the tick's cycle, so the trigger time is computed as it does it.
 * @param {object} scheduler - `cycle`, `cps`, `latency`.
 * @param {number} cycle
 * @param {number} now - The context's currentTime at the query.
 */
export function scratchQueryTime(scheduler, cycle, now) {
  const latency = Number.isFinite(scheduler?.latency) ? scheduler.latency : 0.1;
  const cps = scheduler?.cps > 0 ? scheduler.cps : 0.5;
  const at = Number.isFinite(scheduler?.cycle) ? scheduler.cycle : cycle;
  return (cycle - at) / cps + now + latency;
}

/** The hidden sound a restarted note plays through (see {@link ensureScratchRestartSound}). */
export const SCRATCH_RESTART_SOUND = '_scratchrestart';
/** Where a restarted note carries its original sound and its envelope (see the wrapper sound). */
export const SCRATCH_RESTART_KEY = '__scratchRestart';

/**
 * The level (0…1) of superdough's linear ADSR `t` seconds into a note, before its release.
 * @param {number[]} adsr - `[attack, decay, sustain]` (release unused)
 * @param {number} t
 */
export function scratchEnvelopeLevel([attack, decay, sustain], t) {
  if (t < attack) return attack > 0 ? t / attack : 1;
  if (t < attack + decay) return 1 + ((sustain - 1) * (t - attack)) / decay;
  return sustain;
}

/**
 * The gain curve of a note restarted `elapsed` seconds into it (spec 023 re-review 1–2), as
 * breakpoints `[seconds after the restart, level]`: a fade-in to where the original envelope is
 * by then, then the original envelope from there on (the rest of its attack, its decay, its
 * sustain). So the restarted voice continues the original's level and never goes above it.
 * Null when the note has died away (decayed to superdough's silent sustain).
 * @param {number[]} adsr - `[attack, decay, sustain, release]` as superdough resolves them
 * @param {number} elapsed
 * @param {number} [fade]
 * @returns {Array<[number, number]>|null}
 */
export function scratchRestartEnvelope(adsr, elapsed, fade = SCRATCH_RESTART_FADE_SECONDS) {
  const [attack, decay, sustain] = adsr;
  if (elapsed >= attack && scratchEnvelopeLevel(adsr, elapsed) <= 0.001 && !(sustain > 0.001)) return null;
  const points = [
    [0, 0],
    [fade, scratchEnvelopeLevel(adsr, elapsed + fade)],
  ];
  if (elapsed + fade < attack) points.push([attack - elapsed, 1]);
  if (elapsed + fade < attack + decay) points.push([attack + decay - elapsed, sustain]);
  return points;
}

/**
 * Put a restart's gain curve on a voice's gain: the curve from `t`, held to `holdEnd`, then the
 * release to 0. Replaces whatever the voice had scheduled from `t` on.
 * @param {AudioParam} gain
 * @param {Array<[number, number]>} points
 * @param {number} t
 * @param {number} holdEnd
 * @param {number} release
 */
export function applyScratchRestartEnvelope(gain, points, t, holdEnd, release) {
  gain.cancelScheduledValues(t);
  gain.setValueAtTime(0, t);
  let last = [0, 0];
  for (const [tau, level] of points.slice(1)) {
    if (t + tau >= holdEnd) {
      const span = tau - last[0];
      const at = holdEnd - t;
      const v = span > 0 ? last[1] + ((level - last[1]) * (at - last[0])) / span : level;
      gain.linearRampToValueAtTime(v, holdEnd);
      last = [at, v];
      break;
    }
    gain.linearRampToValueAtTime(level, t + tau);
    last = [tau, level];
  }
  if (t + last[0] < holdEnd) gain.setValueAtTime(last[1], holdEnd);
  gain.linearRampToValueAtTime(0, holdEnd + Math.max(release, 0.001));
}

/**
 * Register (once, and again after the sound list was cleared) the hidden sound restarted notes
 * play through. It triggers the original sound with a flat envelope and puts the restart's gain
 * curve on the voice it gets back, so effects, orbit, pan and the rest are superdough's own.
 * The name starts with `_`, which the sounds list hides.
 * @param {object} [deps] - superdough's `getSound` / `registerSound`, for tests.
 */
export function ensureScratchRestartSound(deps = {}) {
  const lookup = deps.getSound ?? getSound;
  const register = deps.registerSound ?? registerSound;
  if (lookup(SCRATCH_RESTART_SOUND)) return;
  register(
    SCRATCH_RESTART_SOUND,
    async (t, value, onended, cps) => {
      const plan = value[SCRATCH_RESTART_KEY];
      const original = plan && lookup(plan.s);
      if (!original) return undefined;
      const { [SCRATCH_RESTART_KEY]: _plan, ...rest } = value;
      const flat = { ...rest, s: plan.s, attack: 0.001, decay: 0.001, sustain: 1 };
      if (plan.release === undefined) delete flat.release;
      else flat.release = plan.release;
      const handle = await original.onTrigger(t, flat, onended, cps);
      const gain = handle?.node?.gain;
      if (gain) {
        const hold = Number.isFinite(plan.holdSeconds) ? plan.holdSeconds : value.duration;
        applyScratchRestartEnvelope(gain, plan.points, t, t + hold, plan.releaseSeconds);
      }
      return handle;
    },
    { type: 'scratch-restart', prebake: true },
  );
}

/** Stock oscillators superdough starts at phase 0, so a restart can be started in phase. */
const PHASE_ALIGNABLE = new Set(['sine', 'square', 'sawtooth', 'triangle']);
/** Controls that bend a synth's pitch over time (or add noise): its phase can't be matched. */
const PHASE_SPOILERS = ['vib', 'vibmod', 'penv', 'pattack', 'pdecay', 'prelease', 'fmi', 'fmh', 'noise', 'detune', 'n'];

/**
 * How long after the restart time a stock-waveform synth should start so its oscillator is in
 * phase with the note it continues (which started `elapsed` s ago at phase 0): less than one
 * period. 0 when its pitch moves (vibrato, pitch envelope, FM, detune, partials, noise) or the
 * frequency is unknown, so it just starts at the restart time.
 * @param {object} value
 * @param {string} s
 * @param {number} elapsed
 * @param {(value: object) => number} [frequencyOf]
 */
export function scratchPhaseDelay(value, s, elapsed, frequencyOf = getFrequencyFromValue) {
  if (!PHASE_ALIGNABLE.has(s) || PHASE_SPOILERS.some((k) => value[k] != null && value[k] !== 0)) return 0;
  let f;
  try {
    f = frequencyOf(value);
  } catch {
    return 0;
  }
  if (!(f > 0) || !Number.isFinite(f)) return 0;
  const cycles = f * elapsed;
  const ahead = Math.ceil(cycles) - cycles; // fraction of a period to the next phase-0 crossing
  return ahead >= 1 - 1e-9 ? 0 : ahead / f;
}

/**
 * The value a note restarted `elapsed` seconds into it plays with, or null when it can't be
 * restarted faithfully or has died away (spec 023 review 1, re-review 1–2). It plays through the
 * hidden {@link SCRATCH_RESTART_SOUND}, carrying the original sound and its gain curve
 * ({@link scratchRestartEnvelope}): the original envelope, resolved with superdough's own
 * defaults for that kind of sound, continued from where it is, after a 10 ms fade-in.
 * - Synths: superdough's synth defaults.
 * - Samples: the sampler's defaults; `begin` moves on by the elapsed playback (`loopAt`/`fit`,
 *   unit 'c', by `elapsed·rate`; plain samples by `elapsed·rate / buffer length`, when the
 *   buffer is loaded). It is held as the sampler would (the rest of the slice, unless `clip`,
 *   `loop` or `release` make it the note's length).
 * - Anything else (reversed or looped samples, soundfonts, unknown sounds): not restarted.
 * @param {object} value - The hap's value (object).
 * @param {number} elapsed - Seconds since the note's onset.
 * @param {object} [deps] - superdough lookups, for tests.
 * @returns {object|null}
 */
export function scratchMidNoteValue(value, elapsed, deps = {}) {
  const lookup = deps.getSound ?? getSound;
  const info = deps.getSampleInfo ?? getSampleInfo;
  const loaded = deps.getLoadedBuffer ?? getLoadedBuffer;
  const adsrOf = deps.getADSRValues ?? getADSRValues;
  const base = value.s ?? (deps.getDefaultValue ?? getDefaultValue)('s');
  // superdough prefixes the bank itself; the restart sound has none, so resolve it here.
  const s = value.bank && base ? `${value.bank}_${base}` : base;
  const type = lookup(s)?.data?.type;
  const params = [value.attack, value.decay, value.sustain, value.release];
  const restart = (adsr, extra = {}, holdSeconds, delaySeconds = 0) => {
    const points = scratchRestartEnvelope(adsr, elapsed + delaySeconds);
    if (!points) return null;
    const { bank: _bank, ...rest } = value;
    return {
      ...rest,
      ...extra,
      s: SCRATCH_RESTART_SOUND,
      [SCRATCH_RESTART_KEY]: { s, points, release: value.release, releaseSeconds: adsr[3], holdSeconds, delaySeconds },
    };
  };
  if (type === 'synth') {
    const delay = scratchPhaseDelay(value, s, elapsed, deps.getFrequencyFromValue);
    return restart(adsrOf(params, 'linear', [...SUPERDOUGH_SYNTH_ADSR_DEFAULTS]), {}, undefined, delay);
  }
  if (type === 'sample') {
    const speed = value.speed ?? 1;
    if (!(speed > 0) || value.loop) return null;
    const bank = lookup(s)?.data?.samples;
    let rate;
    let url;
    try {
      ({ playbackRate: rate, url } = info({ ...value, s }, bank));
    } catch {
      return null;
    }
    if (!(rate > 0)) return null;
    const end = value.end ?? 1;
    let advance;
    let sliceSeconds;
    if (value.unit === 'c') {
      advance = elapsed * rate; // rate × buffer length, over the buffer length
    } else {
      const duration = loaded(url)?.duration;
      if (!(duration > 0)) return null;
      advance = (elapsed * rate) / duration;
    }
    const begin = (value.begin ?? 0) + advance;
    if (!(begin < end)) return null;
    if (value.unit === 'c') sliceSeconds = (end - begin) / rate;
    else sliceSeconds = ((end - begin) * loaded(url).duration) / rate;
    // The sampler holds a note for its slice unless clip, loop or release make it the note's length.
    const holdSeconds = value.clip == null && value.release == null ? sliceSeconds : undefined;
    return restart(adsrOf(params), { begin }, holdSeconds);
  }
  return null;
}

/**
 * The shifted timeline's notes that sound at `cycle` but started before it: the scheduler will
 * not trigger them (it only fires onsets from `cycle` on).
 * @param {object} pattern
 * @param {number} cycle
 * @param {number} cps
 * @returns {Array<{hap: object, value: object, elapsed: number, remaining: number}>}
 */
export function scratchSoundingNotes(pattern, cycle, cps) {
  if (!pattern?.queryArc || !(cps > 0)) return [];
  const notes = [];
  for (const hap of pattern.queryArc(cycle, cycle + 1e-6, { _cps: cps })) {
    const whole = hap.whole;
    if (!whole || hap.hasOnset?.()) continue;
    const begin = Number(whole.begin.valueOf());
    const end = Number(whole.end.valueOf());
    if (!(begin < cycle && end > cycle)) continue;
    // Notes with their own trigger (MIDI, OSC, …) are not superdough's to restart.
    if (hap.context?.onTrigger && hap.context?.dominantTrigger) continue;
    hap.ensureObjectValue?.();
    const value = typeof hap.value === 'object' && hap.value !== null ? hap.value : { s: hap.value };
    notes.push({ hap, value, elapsed: (cycle - begin) / cps, remaining: (end - cycle) / cps });
  }
  return notes;
}

/**
 * Applies a settled scratch to one deck (spec 023 tech §2.3).
 *
 * @example
 * const offset = new PatternOffset({ getRepl: () => repl });
 * const handOver = new ScratchHandOver(deck, { getRepl: () => repl, offset });
 */
export class ScratchHandOver {
  /**
   * @param {import('./ScratchDeck.mjs').ScratchDeck} deck
   * @param {object} options
   * @param {() => any} options.getRepl - The deck's repl.
   * @param {PatternOffset} options.offset - The deck's offset (its editPattern is the repl's hook).
   * @param {{getActiveSoundIds: () => any[], releaseSounds: Function}} [options.voices] - This
   *   deck's voices only (default: the main engine's).
   * @param {(value: object, t: number, duration: number, cps: number, cycle: number) => any} [options.trigger]
   *   - Plays a restarted note on this deck (default: superdough on the main engine).
   * @param {(value: object, elapsed: number) => (object|null)} [options.midNoteValue] - For tests.
   * @param {() => boolean} [options.isBlocked] - A track switch runs: no shift.
   * @param {() => (BaseAudioContext|undefined)} [options.getAudioContext] - Default: the deck's.
   */
  constructor(deck, { getRepl, offset, voices, trigger, midNoteValue, isBlocked, getAudioContext, ensureSound } = {}) {
    this.deck = deck;
    this.getRepl = getRepl;
    this.offset = offset;
    this.voices = voices ?? { getActiveSoundIds: () => getActiveSoundIds(), releaseSounds };
    this.trigger = trigger ?? ((value, t, duration, cps, cycle) => superdough(value, t, duration, cps, cycle));
    this.midNoteValue = midNoteValue ?? scratchMidNoteValue;
    this.ensureSound = ensureSound ?? ensureScratchRestartSound;
    this.isBlocked = isBlocked;
    this.getAudioContext = getAudioContext ?? (() => deck?.audioContext);
    deck?.setTempoSource?.(() => this.getRepl?.()?.scheduler?.cps);
    this._unsubscribe = deck?.onLagSettled?.((event) => this.onLagSettled(event)) ?? null;
  }

  /** @private */
  _now() {
    const ac = this.getAudioContext?.();
    return Number.isFinite(ac?.currentTime) ? ac.currentTime : 0;
  }

  /**
   * The record settled `lagSeconds` behind live: shift, then (once the arrival is known)
   * restart long notes, release stale voices and hand over. Without a shift (blocked, stopped,
   * no repl) nothing is called and the deck goes back to live by itself.
   *
   * `settleAt` (context seconds) comes with a release applied early (an Update during its
   * spin-up, re-review 4): the record reaches its lag only then, so the shift starts then too
   * (a pending shift, from that cycle), and the stale voices, the long-note restarts and the
   * hand-over are all timed to it. The two timelines never meet at different positions.
   * @param {{id: number, lagSeconds: number, settleAt?: number}} event
   * @returns {boolean} Whether the shift was applied.
   */
  onLagSettled({ id, lagSeconds, settleAt }) {
    try {
      if (this.isBlocked?.()) return false;
      const repl = this.getRepl?.();
      const scheduler = repl?.scheduler;
      const cps = scheduler?.cps;
      if (!scheduler?.started || !(cps > 0) || !(lagSeconds > 0)) return false;
      // Every voice sounding or scheduled now belongs to the old timeline.
      let ids = [];
      try {
        ids = this.voices?.getActiveSoundIds?.() ?? [];
      } catch (err) {
        console.warn('[ScratchHandOver] listing voices failed:', err?.message ?? err);
      }
      const arrival = scratchShiftArrival(scheduler);
      if (Number.isFinite(settleAt)) return this._shiftAtSettle(id, ids, scheduler, lagSeconds, settleAt, arrival);
      const onFirstQuery = arrival
        ? undefined
        : (cycle) =>
            this._arrive(id, ids, scheduler, cycle, scratchQueryTime(scheduler, cycle, this._now()), lagSeconds);
      if (!this.offset?.shift(lagSeconds * cps, { onFirstQuery })) return false;
      if (arrival) this._arrive(id, ids, scheduler, arrival.cycle, Math.max(arrival.time, this._now()), lagSeconds);
      return true;
    } catch (err) {
      console.warn('[ScratchHandOver] shift failed:', err?.message ?? err);
      return false;
    }
  }

  /** @private The committed release: shift from the moment the record reaches its lag. */
  _shiftAtSettle(id, ids, scheduler, lagSeconds, settleAt, arrival) {
    const cps = scheduler.cps;
    const now = this._now();
    const latency = Number.isFinite(scheduler.latency) ? scheduler.latency : 0.1;
    // The earliest the scheduler can still change: its query end (Cyclist), else a safe bound
    // past NeoCyclist's lookahead.
    let base = arrival;
    if (!base) {
      const cycle = Number(scheduler.now?.());
      if (!Number.isFinite(cycle)) return false;
      base = { cycle: cycle + (latency + 0.35) * cps, time: now + 2 * latency + 0.35 };
    }
    const start = Math.max(settleAt, base.time, now);
    const cycle = base.cycle + (start - base.time) * cps;
    const later = start > base.time + 1e-4;
    // The unshifted track's notes end (with their release) just before the shift, as the stale
    // voices do on the normal path: live isn't heard then, the record is.
    const endCycle = cycle - SCRATCH_STALE_RELEASE_SECONDS * cps;
    if (!this.offset?.shift(lagSeconds * cps, later ? { atCycle: cycle, endCycle } : {})) return false;
    this._arrive(id, ids, scheduler, cycle, start, lagSeconds);
    return true;
  }

  /** @private The shifted audio starts at `cycle`, context time `start`. */
  _arrive(id, ids, scheduler, cycle, start, lagSeconds) {
    const now = this._now();
    // Only while this release is still the deck's to hand over (not stopped, re-grabbed, …).
    if (!this.deck?.canHandOver?.(id)) return;
    let margin = SCRATCH_HANDOVER_MARGIN_SECONDS;
    if (ids.length) {
      // The crossfade starts once the restarted notes have faded in (phase-aligned synths start
      // up to a period late), but never so late that it would read past the shift point.
      const ready = this._restartLongNotes(scheduler, cycle, start);
      const latest = Number.isFinite(lagSeconds) ? Math.max(margin, lagSeconds - 0.025) : margin;
      margin = Math.min(Math.max(margin, ready + 0.001), latest);
      try {
        // The output plays the record now, so the live fade is never heard; it only keeps the
        // old timeline's notes out of the live input once the shifted audio arrives.
        this.voices.releaseSounds(ids, start, Math.max(now, start - SCRATCH_STALE_RELEASE_SECONDS));
      } catch (err) {
        console.warn('[ScratchHandOver] releasing voices failed:', err?.message ?? err);
      }
    }
    this.deck.handOver(id, start + margin, start);
  }

  /**
   * @private Start the shifted timeline's long notes at `start`, mid-note (review 1).
   * @returns {number} Seconds after `start` by which every restarted note has faded in.
   */
  _restartLongNotes(scheduler, cycle, start) {
    let notes = [];
    try {
      notes = scratchSoundingNotes(this.offset?.shifted ?? scheduler.pattern, cycle, scheduler.cps);
      if (notes.length) this.ensureSound?.();
    } catch (err) {
      console.warn('[ScratchHandOver] querying the sounding notes failed:', err?.message ?? err);
      return 0;
    }
    let ready = 0;
    for (const { hap, value, elapsed, remaining } of notes) {
      try {
        const v = this.midNoteValue(value, elapsed);
        if (!v) continue;
        const delay = v[SCRATCH_RESTART_KEY]?.delaySeconds || 0;
        if (delay >= remaining) continue;
        ready = Math.max(ready, delay + SCRATCH_RESTART_FADE_SECONDS);
        Promise.resolve(this.trigger(v, start + delay, remaining - delay, scheduler.cps, cycle)).catch((err) =>
          console.warn('[ScratchHandOver] restarting a note failed:', err?.message ?? err),
        );
      } catch (err) {
        console.warn('[ScratchHandOver] restarting a note failed:', err?.message ?? err, hap?.show?.());
      }
    }
    return ready;
  }

  /** Stop listening to the deck. */
  destroy() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.deck?.setTempoSource?.(null);
  }
}
