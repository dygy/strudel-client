/**
 * TrackTransitionController - switches the main repl from one track to another with a
 * transition type (spec 017, tech §2.2). Replaces SmoothTransitionManager.
 *
 * Every transition happens inside the one running scheduler: the old track is never stopped.
 * The new code is evaluated as usual; the repl's `editPattern` hook (which this controller
 * provides) swaps the evaluated pattern for one combined pattern (see buildTransition) whose
 * new half starts at the transition start T. A track whose code fails never reaches the hook,
 * so the old one simply keeps playing.
 *
 * Wiring (website): pass `controller.editPattern` as the repl's `editPattern` option, call
 * `controller.switchTo(code, settings)` for a track switch, `controller.stopped()` when the
 * scheduler stops, and `controller.destroy()` on teardown. Nothing here imports the website.
 *
 * Window events (`detail` always has `timestamp`):
 * - `track-transition-waiting` { type, T, now }: the switch is armed and waits for T;
 * - `track-transition-start`   { type, T, end };
 * - `track-transition-end`     { type, T, end, cancelled? };
 * - `track-transition-error`   { error, evaluateFailed }: `evaluateFailed` means the new code
 *   is broken and the old track keeps playing.
 *
 * @class TrackTransitionController
 * @license AGPL-3.0-or-later
 */

import { buildTransition, isOverlapping, transitionTiming, TRANSITION_TYPES } from './transitions/buildTransition.mjs';
import { applyTrim, computeTrim, LoudnessMeter } from './transitions/loudness.mjs';
import { getActiveSoundIds, releaseSounds } from 'superdough';

/** A transition starts at least this many cycles after "now" (the scheduler queries ahead). */
export const SAFETY_MARGIN = 0.25;
/** Without a snap, the transition start is rounded up to this grid (a beat in 4/4), so both tracks share beats. */
export const BEAT_GRID = 1 / 4;
/** Off (a dequeued switch can begin as Off) starts on this finer grid: "at once", but a clean fraction. */
const OFF_GRID = 1 / 16;
/** Tempo glide: setCps steps per cycle. */
export const GLIDE_STEPS_PER_CYCLE = 16;
/** A volume restore never jumps: it ramps over this many seconds. */
export const RESTORE_RAMP = 0.08;
/** The tempo a track runs at when its code sets none (matches the restart path's reset). */
export const DEFAULT_CPS = 0.5;
/** Match loudness: the old track is measured over this many seconds before T... */
export const OLD_LOUDNESS_SECONDS = 2;
/** ...and the new one over this many cycles after the transition ends. */
export const NEW_LOUDNESS_CYCLES = 1;
/** Allowed lengths and snaps (the UI offers these). */
export const TRANSITION_LENGTHS = Object.freeze([1, 2, 4, 8, 16]);
export const TRANSITION_SNAPS = Object.freeze([0, 1, 4, 8, 16]);
/**
 * Tempo choices (spec 027):
 * - `jump`: the new tempo from T (both tracks);
 * - `glide`: old → new over the overlap (overlapping types only; Dip and Cut play it as `jump`);
 * - `match`: both tracks at the old tempo, then old → new over `length` cycles once the old one is gone;
 * - `keep`: both tracks at the old tempo, and the new track stays there (the set keeps its tempo).
 */
export const TRANSITION_TEMPOS = Object.freeze(['jump', 'glide', 'match', 'keep']);
export const DEFAULT_TRANSITION_SETTINGS = Object.freeze({
  type: 'dip',
  length: 4,
  snap: 0,
  tempo: 'jump',
  matchLoudness: false,
});

/** Cut, Off and Echo-out end the old track's held voices with a ramp this long (seconds) at T. */
export const SHORT_RELEASE = 0.03;

/** The main engine's voices in superdough (fork additions, spec 017). */
const SUPERDOUGH_VOICES = Object.freeze({
  getActiveSoundIds: () => getActiveSoundIds(),
  releaseSounds,
});

/** Types that always wait for at least the next cycle boundary. */
const TYPE_MIN_SNAP = { cut: 1, echoOut: 1 };
/** `all()` / `each()` transform the stacked layers, so the layers no longer add up to the pattern. */
const GLOBAL_TRANSFORM = /\b(all|each)\s*\(/;

/** The offered length closest to `cycles` (ties go to the shorter one). */
function nearestLength(cycles) {
  return TRANSITION_LENGTHS.reduce((best, l) => (Math.abs(l - cycles) < Math.abs(best - cycles) ? l : best));
}

/**
 * Validate a settings object; anything missing or out of range takes its default.
 * `tempo` is one of TRANSITION_TEMPOS; without a valid one, the legacy `glide: true` (spec 017)
 * gives `'glide'` and anything else `'jump'`. The result has no `glide` field.
 * @param {Object} [settings]
 * @returns {{type: string, length: number, snap: number, tempo: string, matchLoudness: boolean}}
 */
export function normalizeTransitionSettings(settings = {}) {
  const s = settings ?? {};
  const length = Number(s.length);
  const snap = Number(s.snap);
  return {
    type: TRANSITION_TYPES.includes(s.type) ? s.type : DEFAULT_TRANSITION_SETTINGS.type,
    length: Number.isFinite(length) && length > 0 ? nearestLength(length) : DEFAULT_TRANSITION_SETTINGS.length,
    snap: TRANSITION_SNAPS.includes(snap) ? snap : 0,
    tempo: TRANSITION_TEMPOS.includes(s.tempo) ? s.tempo : s.glide === true ? 'glide' : 'jump',
    matchLoudness: Boolean(s.matchLoudness),
  };
}

/**
 * The transition start T for a switch armed at cycle `now`: the next boundary of
 * max(snap, the type's minimum) cycles strictly after `now + SAFETY_MARGIN`, counted from
 * `origin` (the playing track's cycle 0 on the scheduler grid, spec 027); without a boundary,
 * `now + SAFETY_MARGIN` rounded up to the (global) beat grid. With origin 0 this is spec 017's T.
 * @param {number} now the scheduler cycle
 * @param {{type: string, snap?: number}} settings
 * @param {number} [origin=0] where the playing track's phrases start
 * @returns {number}
 */
export function transitionStart(now, { type, snap = 0 }, origin = 0) {
  const base = now + SAFETY_MARGIN;
  const size = Math.max(snap || 0, TYPE_MIN_SNAP[type] || 0);
  if (size > 0) {
    const from = Number.isFinite(origin) ? origin : 0;
    return from + (Math.floor((base - from) / size + 1e-9) + 1) * size;
  }
  const grid = type === 'off' ? OFF_GRID : BEAT_GRID;
  return Math.ceil(base / grid - 1e-9) * grid;
}

/**
 * The tempo at cycle `now` during a glide over [T, T+L]: linear from oldCps to newCps in
 * GLIDE_STEPS_PER_CYCLE steps per cycle, exactly newCps from T+L on.
 */
export function glideCps(now, { T, L, oldCps, newCps }) {
  if (now < T) {
    return oldCps;
  }
  const p = L > 0 ? Math.min(1, (now - T) / L) : 1;
  if (p >= 1) {
    return newCps;
  }
  const steps = Math.max(1, Math.round(GLIDE_STEPS_PER_CYCLE * L));
  const q = Math.floor(p * steps) / steps;
  return oldCps + (newCps - oldCps) * q;
}

export class TrackTransitionController {
  /**
   * @param {Object} options
   * @param {Object} options.repl the main repl (`@strudel/core` repl(): evaluate, setPattern, scheduler, state)
   * @param {AudioContext} [options.audioContext] the main engine's context (not the preview's)
   * @param {GainNode} [options.destinationGain] master output gain (Dip ramps it; loudness taps it)
   * @param {Function} [options.getSettings] returns the current transition settings; read when a switch begins
   * @param {Function} [options.cleanupCanvases] clears the old track's visuals; called before the new code evaluates
   * @param {EventTarget} [options.eventTarget=window] where `track-transition-*` events go
   * @param {number} [options.targetVolume=1] master level after a Dip or a restore
   * @param {Function} [options.setTimeout] timer functions (default: the global ones, looked up per call)
   * @param {Function} [options.clearTimeout]
   * @param {{getActiveSoundIds: Function, releaseSounds: Function}} [options.voices] the main engine's
   *   sounding voices (default: superdough's, filtered to the main engine's controller)
   * @param {Function} [options.getTrackShift] the speakers' scratch shift (spec 023), read when a
   *   switch begins: the playing track's phrases start at `origin + shift` (spec 027). It returns
   *   cycles, or `{ cycles, pending: { cycles, atCycle } | null }` when part of the shift only
   *   applies from a later cycle (an Update during a spin-up)
   */
  constructor({
    repl,
    audioContext,
    destinationGain,
    getSettings,
    cleanupCanvases,
    eventTarget,
    targetVolume = 1,
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    voices = SUPERDOUGH_VOICES,
    getTrackShift = () => 0,
  } = {}) {
    this.repl = repl;
    this.audioContext = audioContext;
    this.destinationGain = destinationGain;
    this.getSettings = getSettings;
    this.cleanupCanvases = cleanupCanvases;
    this.eventTarget = eventTarget;
    this.targetVolume = targetVolume;
    this._setTimeout = setTimeoutFn;
    this._clearTimeout = clearTimeoutFn;
    this.voices = voices;
    this.getTrackShift = getTrackShift;

    this.origin = 0; // cycle where the playing track's cycle 0 sits on the scheduler grid
    this.trimState = null; // the playing track's loudness trim ({ start, value }), if matched
    this.armed = null; // a switch whose evaluate is running and whose hook call is awaited
    this.active = null; // the transition that is waiting or running
    this.inflight = null; // the switch being processed (armed or active)
    this.queued = null; // the latest switch requested while busy
    this.measure = null; // a new track's loudness being measured after its transition
    this.metering = false; // take loudness readings on every tick
    this.meter = null;
    this.timer = null;
    this.gainAutomated = false; // a Dip has scheduled ramps on destinationGain
    this._capture = null; // the setcps capture of the switch being evaluated
    this.tempoHold = null; // spec 027: the tempo after a Match or Keep transition ({ kind: 'glide' | 'keep', ... })

    this.editPattern = this.editPattern.bind(this);
    this._tick = this._tick.bind(this);
  }

  get scheduler() {
    return this.repl?.scheduler;
  }

  /** True while a switch is evaluating, waiting or running. */
  get busy() {
    return this.inflight !== null;
  }

  /**
   * The repl's `editPattern` hook, called on every `setPattern`.
   * - A switch is armed: build and return the transition pattern.
   * - A transition runs: the incoming track was hot-swapped, rebuild with it.
   * - Idle: shift by the track origin (and apply the loudness trim). With origin 0 and no
   *   trim it returns the very same pattern object, so plain playback is untouched.
   * @param {import('@strudel/core').Pattern} pattern
   * @returns {import('@strudel/core').Pattern}
   */
  editPattern(pattern) {
    const sw = this.armed;
    if (sw) {
      this.armed = null;
      sw.consumed = true;
      if (sw.immediate) {
        this.origin = 0;
        this.trimState = null;
        // Stopped while evaluating: it starts like a fresh track. Its own setcps wins, else the
        // reset tempo, applied before the scheduler restarts.
        sw.capture?.apply(sw.capture.recorded ?? DEFAULT_CPS);
        return pattern;
      }
      return this._arm(sw, pattern);
    }
    if (this.active) {
      // The incoming track was re-evaluated (e.g. Ctrl+Enter) during the transition: its setcps
      // becomes the tempo the transition heads for, instead of being overwritten by the plan.
      if (this.active.requestedCps !== undefined) {
        this._retarget(this.active, this.active.requestedCps);
        this.active.requestedCps = undefined;
      }
      this.active.newPat = pattern;
      this.active.layers = this.active.useLayers ? this.repl?.state?.layers : undefined;
      return this._build(this.active);
    }
    return this._wrapIdle(pattern);
  }

  _wrapIdle(pattern) {
    let result = pattern;
    if (this.origin) {
      result = result.late(this.origin);
    }
    if (this.trimState) {
      result = applyTrim(result, this.trimState);
    }
    return result;
  }

  _arm(sw, newPat) {
    const { type, length, snap } = sw.settings;
    const now = this._now();
    const T = this._phraseStart(now, sw.settings, sw.trackShift);
    const buildType = type === 'off' ? 'cut' : type;
    const L = buildType === 'cut' ? 0 : length;
    const timing = transitionTiming(buildType, T, L);
    const active = {
      ...sw,
      type,
      buildType,
      T,
      L,
      ...timing,
      newPat,
      layers: sw.useLayers ? this.repl?.state?.layers : undefined,
      echoFrom: Math.max(now, T - 1),
      // Every voice sounding now belongs to the old track (the new pattern isn't scheduled yet).
      // Notes queried from here on are cut by the pattern; these were handed out before and
      // keep their full length unless released (spec 2.5: nothing old after the end).
      oldVoiceIds: this._snapshotVoices(),
      phase: 'armed',
      lastCps: sw.oldCps,
    };
    this.active = active;
    this.origin = timing.origin;
    this.trimState = sw.trimState;
    return this._build(active);
  }

  /**
   * T counted from the playing track's cycle 0. A pending part of the scratch shift only moves
   * the track from its `atCycle`: a T before that counts from the settled shift; a T at or after
   * it from the full shift, on its first boundary at or after `atCycle`.
   */
  _phraseStart(now, { type, snap }, shift = { cycles: 0, pending: null }) {
    const settled = this.origin + shift.cycles;
    const T = transitionStart(now, { type, snap }, settled);
    const pending = shift.pending;
    if (!pending || T < pending.atCycle) {
      return T;
    }
    const full = settled + pending.cycles;
    const T2 = transitionStart(now, { type, snap }, full);
    if (T2 >= pending.atCycle) {
      return T2;
    }
    const size = Math.max(snap || 0, TYPE_MIN_SNAP[type] || 0);
    return size > 0 ? full + Math.ceil((pending.atCycle - full) / size - 1e-9) * size : T;
  }

  _build(a) {
    return buildTransition({
      oldPat: a.oldPat,
      newPat: a.newPat,
      layers: a.layers,
      T: a.T,
      length: a.L,
      type: a.buildType,
      cps: a.oldCps,
      echoFrom: a.echoFrom,
    });
  }

  /**
   * Switch to another track's code with the transition settings in force when the switch
   * begins. While another switch is in flight the request is queued; only the latest queued
   * one runs (an earlier queued one resolves `{ superseded: true }`). A request for the code
   * already being switched to is ignored and drops the queue.
   *
   * Resolves when the transition has ended (the old pattern is no longer queried). Rejects,
   * with `error.evaluateFailed = true`, when the new code doesn't evaluate; the old track then
   * keeps playing untouched (tempo, gain, pattern).
   *
   * @param {string} code
   * @param {Object} [settings] overrides `getSettings()`: { type, length, snap, tempo, matchLoudness }
   *   (a legacy `glide: true` without `tempo` means `tempo: 'glide'`)
   * @param {Object} [options]
   * @param {Function} [options.prepare] async reset run just before evaluate (its `setCps` is captured too)
   * @returns {Promise<Object>}
   */
  switchTo(code, settings, { prepare } = {}) {
    if (this.busy) {
      if (code === this.inflight.code) {
        this._dropQueue();
        return Promise.resolve({ ignored: true });
      }
      return this._enqueue(code, settings, prepare);
    }
    return this._run(code, settings, prepare);
  }

  _enqueue(code, settings, prepare) {
    const previous = this.queued;
    return new Promise((resolve, reject) => {
      this.queued = {
        code,
        settings: settings ?? previous?.settings,
        // A queued reset stays wanted when a later request replaces the code.
        prepare: prepare || previous?.prepare,
        resolve,
        reject,
      };
      previous?.resolve({ superseded: true });
    });
  }

  _dropQueue() {
    const q = this.queued;
    this.queued = null;
    q?.resolve({ superseded: true });
  }

  _processQueue() {
    const q = this.queued;
    if (!q || this.busy) {
      return;
    }
    this.queued = null;
    this._run(q.code, q.settings, q.prepare).then(q.resolve, q.reject);
  }

  async _run(code, settingsArg, prepare) {
    const inflight = { code };
    this.inflight = inflight;
    let sw;
    let capture;
    let prevHold = null;
    try {
      await this._ensureAudioContextRunning();
      const settings = normalizeTransitionSettings(settingsArg ?? this.getSettings?.());
      // A slide or held set tempo from the last transition ends here: this switch starts from
      // the tempo it reached (spec 027 §2.2), and only one setCps wrapper is ever installed.
      // If the new code fails, the hold comes back (catch below).
      prevHold = this.tempoHold;
      this._endTempoHold();
      const scheduler = this.scheduler;
      const oldPat = scheduler?.pattern ?? this.repl?.state?.pattern;
      const playing = Boolean(scheduler?.started && oldPat);

      this._cancelMeasure();
      this.meter?.clear();
      sw = {
        code,
        settings,
        immediate: !playing,
        oldPat,
        oldCps: scheduler?.cps ?? DEFAULT_CPS,
        // Read now: once the switch is busy, the scratch offset drops it from the next pattern.
        trackShift: playing ? this._readTrackShift() : { cycles: 0, pending: null },
        useLayers: !GLOBAL_TRANSFORM.test(code),
        trimState: playing && settings.matchLoudness ? { start: null, value: 1 } : null,
        consumed: false,
      };
      sw.done = new Promise((resolve) => (sw.resolve = resolve));
      if (sw.trimState && this.destinationGain && this.audioContext) {
        this.metering = true;
        this._sampleLoudness();
        this._startTicking();
      }

      // Nothing playing: the code starts as usual, its own setcps applies directly.
      if (!sw.immediate) {
        capture = this._captureCps();
        sw.capture = capture;
        this._capture = capture;
      }
      // Armed before prepare: a Stop from here on makes the switch start like a fresh track.
      this.armed = sw;
      try {
        this._safely('cleanupCanvases', () => this.cleanupCanvases?.());
        if (prepare) {
          try {
            await prepare();
          } catch (error) {
            console.warn('[TrackTransitionController] prepare() failed:', error);
          }
        }
        await this.repl.evaluate(code);
      } finally {
        if (this.armed === sw) {
          this.armed = null;
        }
        if (this._capture === capture) {
          this._capture = null;
        }
        capture?.restore();
      }

      if (!sw.consumed) {
        const error = new Error('The new track failed to evaluate');
        error.evaluateFailed = true;
        throw error;
      }
      if (sw.immediate) {
        return { immediate: true };
      }

      const a = this.active;
      a.newCps = capture.recorded ?? DEFAULT_CPS;
      a.glideFrom = a.oldCps;
      a.glideStart = a.T;
      this._holdTempo(a);
      if (a.buildType === 'dip') {
        this._scheduleDip(a);
      }
      this._releaseOldVoices(a);
      const now = this._now();
      if (now < a.T) {
        a.phase = 'waiting';
        this._emit('waiting', { type: a.type, T: a.T, now });
      }
      this._tick();
      return await a.done;
    } catch (error) {
      // Only evaluate (or resuming the context) can fail: nothing after the hook throws, and
      // until the hook runs the old track is untouched (pattern, tempo, gain).
      const evaluateFailed = Boolean(sw && !sw.consumed);
      if (!evaluateFailed) {
        console.error('[TrackTransitionController] Transition failed:', error);
      }
      this.metering = false;
      this._restoreGain();
      if (evaluateFailed) {
        // The old track plays on untouched, so does its tempo hold (spec 027 §2.2). The capture
        // was restored in the finally above: this is again the only wrapper.
        this._resumeTempoHold(prevHold);
      }
      this._emit('error', { error: error.message, evaluateFailed });
      error.evaluateFailed = evaluateFailed;
      throw error;
    } finally {
      if (this.inflight === inflight) {
        this.inflight = null;
      }
      this._processQueue();
    }
  }

  /** While the new code evaluates, its setcps/setcpm (and prepare's tempo reset) are recorded, not applied. */
  _captureCps() {
    const capture = { recorded: undefined, resetting: false };
    const wrap = this._wrapSetCps((cps) => {
      if (capture.resetting) {
        return; // onToggle(false)'s tempo reset right after stopped(): the new track's setcps wins
      }
      capture.recorded = cps ?? DEFAULT_CPS;
    });
    capture.apply = wrap.apply;
    capture.restore = wrap.restore;
    return capture;
  }

  /**
   * Route the scheduler's setCps (what setcps/setcpm call) to `onRequest` instead of the clock.
   * Returns `apply` (the real setCps) and `restore` (puts it back; idempotent).
   */
  _wrapSetCps(onRequest) {
    const scheduler = this.scheduler;
    if (!scheduler) {
      return { apply() {}, restore() {} };
    }
    const own = Object.prototype.hasOwnProperty.call(scheduler, 'setCps');
    const original = scheduler.setCps;
    const wrapper = (cps) => onRequest(cps);
    scheduler.setCps = wrapper;
    return {
      apply: (cps) => original.call(scheduler, cps),
      restore() {
        if (scheduler.setCps !== wrapper) {
          return;
        }
        if (own) {
          scheduler.setCps = original;
        } else {
          delete scheduler.setCps;
        }
      },
    };
  }

  /**
   * While a transition waits or runs, the tempo belongs to its plan: a setcps from a re-evaluate
   * of the incoming track is recorded (adopted in editPattern once that evaluate succeeds), not
   * applied, so the old track never jumps tempo before T and the plan never overwrites it.
   */
  _holdTempo(a) {
    const wrap = this._wrapSetCps((cps) => {
      a.requestedCps = cps ?? DEFAULT_CPS;
    });
    a.applyCps = wrap.apply;
    a.releaseTempo = wrap.restore;
  }

  /** Head for a new target tempo; a running glide continues from where it is now. */
  _retarget(a, cps) {
    const now = this._now();
    if (a.phase === 'running' && now > a.glideStart) {
      a.glideFrom = a.lastCps;
      a.glideStart = Math.min(now, a.end);
    }
    a.newCps = cps;
  }

  /**
   * The speakers' scratch shift as `{ cycles, pending }`. A plain number is a settled shift; a
   * throw or a non-finite value counts as 0 (with a warning), a malformed pending part as none.
   */
  _readTrackShift() {
    const none = { cycles: 0, pending: null };
    let shift;
    try {
      shift = this.getTrackShift?.() ?? 0;
    } catch (error) {
      console.warn('[TrackTransitionController] getTrackShift() failed:', error);
      return none;
    }
    const cycles = typeof shift === 'object' && shift !== null ? shift.cycles : shift;
    if (!Number.isFinite(cycles)) {
      console.warn('[TrackTransitionController] getTrackShift() returned a non-finite value:', shift);
      return none;
    }
    const p = typeof shift === 'object' ? shift.pending : null;
    const pending =
      p && Number.isFinite(p.cycles) && Number.isFinite(p.atCycle) && p.cycles !== 0
        ? { cycles: p.cycles, atCycle: p.atCycle }
        : null;
    return { cycles, pending };
  }

  /** The tempo choice in force for this transition (Off has no modifiers: it jumps). */
  _tempoMode(a) {
    return a.type === 'off' ? 'jump' : a.settings.tempo;
  }

  /** Match and Keep play the whole transition at the old tempo. */
  _holdsOldTempo(a) {
    const mode = this._tempoMode(a);
    return mode === 'match' || mode === 'keep';
  }

  /** The tempo the new track plays at during the transition. */
  _incomingCps(a) {
    return this._holdsOldTempo(a) ? a.oldCps : a.newCps;
  }

  _snapshotVoices() {
    try {
      return this.voices?.getActiveSoundIds?.() ?? [];
    } catch (error) {
      console.warn('[TrackTransitionController] could not list active voices:', error);
      return [];
    }
  }

  /** AudioContext time at which cycle T sounds (the old tempo holds until T). */
  _ctxTimeOfT(a) {
    const latency = this.scheduler?.latency ?? 0;
    return this.audioContext.currentTime + Math.max(0, a.T - this._now()) / a.oldCps + latency;
  }

  /**
   * Fade the old track's voices that were already sounding at the switch so they are silent by
   * the old track's end: T+L for the overlapping types (at the faster of both tempos, so the
   * glide can't make it late), the end of the fade-down for Dip, a short ramp at T for Cut, Off
   * and Echo-out (only the voices: the echo bus tails ring on).
   */
  _releaseOldVoices(a) {
    const ids = a.oldVoiceIds;
    if (!ids?.length || !this.audioContext || !this.voices?.releaseSounds) {
      return;
    }
    const start = this._ctxTimeOfT(a);
    let seconds;
    if (a.buildType === 'dip') {
      seconds = a.L / a.oldCps;
    } else if (isOverlapping(a.buildType)) {
      seconds = a.L / Math.max(a.oldCps, this._incomingCps(a));
    } else {
      seconds = SHORT_RELEASE;
    }
    try {
      this.voices.releaseSounds(ids, start + seconds, start);
    } catch (error) {
      console.warn('[TrackTransitionController] releasing the old voices failed:', error);
    }
  }

  /** Dip: hold, ramp to silence over [T, T+L] at the old tempo, back up over [T+L, T+2L] at the new one. */
  _scheduleDip(a) {
    const gain = this.destinationGain?.gain;
    if (!gain || !this.audioContext) {
      console.warn('[TrackTransitionController] No destinationGain: Dip plays without its fade');
      return;
    }
    const ctxNow = this.audioContext.currentTime;
    const down = this._ctxTimeOfT(a);
    const silent = down + a.L / a.oldCps;
    const up = silent + a.L / this._incomingCps(a);
    try {
      const current = gain.value;
      gain.cancelScheduledValues(ctxNow);
      gain.setValueAtTime(current, ctxNow); // anchor at the current level: never a jump
      gain.linearRampToValueAtTime(current, down); // hold until T
      gain.linearRampToValueAtTime(0, silent);
      gain.linearRampToValueAtTime(this.targetVolume, up);
      this.gainAutomated = true;
    } catch (error) {
      console.warn('[TrackTransitionController] Dip ramps failed; restoring the level:', error);
      this._restoreGain();
    }
  }

  /** Bring the master level back to target with a short ramp from wherever it is. */
  _restoreGain() {
    const gain = this.destinationGain?.gain;
    if (!gain || !this.audioContext) {
      return;
    }
    if (!this.gainAutomated && gain.value === this.targetVolume) {
      return;
    }
    const now = this.audioContext.currentTime;
    const current = gain.value; // read before cancelling: the level the ramp starts from
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(current, now);
    gain.linearRampToValueAtTime(this.targetVolume, now + RESTORE_RAMP);
    this.gainAutomated = false;
  }

  _setCps(a, cps) {
    if (a.lastCps === cps) {
      return;
    }
    a.lastCps = cps;
    if (a.applyCps) {
      a.applyCps(cps);
    } else {
      this.scheduler?.setCps(cps);
    }
  }

  /** The tempo plan (spec 017 tech §2.2 step 6, spec 027 tech §2.1 step 5) at cycle `now`. */
  _applyTempo(a, now) {
    const mode = this._tempoMode(a);
    if (mode === 'match' || mode === 'keep') {
      // Both tracks at the old tempo throughout (a no-op: it is already the clock's tempo).
      this._setCps(a, a.oldCps);
      return;
    }
    if (a.buildType === 'dip') {
      // The old tempo holds until the output is silent; the new one is set at that moment.
      if (now >= a.T + a.L) {
        this._setCps(a, a.newCps);
      }
      return;
    }
    if (mode === 'glide' && isOverlapping(a.buildType)) {
      const from = a.glideStart ?? a.T;
      this._setCps(a, glideCps(now, { T: from, L: a.end - from, oldCps: a.glideFrom ?? a.oldCps, newCps: a.newCps }));
      return;
    }
    if (now >= a.T) {
      this._setCps(a, a.newCps);
    }
  }

  _tick() {
    if (this.timer !== null) {
      this._clearTimer();
    }
    const now = this._now();
    const a = this.active;
    if (a && a.newCps !== undefined) {
      if (a.phase !== 'running' && now >= a.T) {
        a.phase = 'running';
        if (a.trimState && this.meter) {
          const from = a.T - OLD_LOUDNESS_SECONDS * a.oldCps;
          a.oldRms = this.meter.rmsOver(from, a.T);
        }
        this._emit('start', { type: a.type, T: a.T, end: a.end });
      }
      if (a.phase === 'running') {
        this._applyTempo(a, now);
        if (now >= a.end) {
          this._finish(a);
        }
      }
    }
    this._tickTempoHold(now);
    if (this.metering) {
      this._sampleLoudness();
      this._checkMeasure(now);
    }
    if (this.active || this.metering || this.tempoHold?.kind === 'glide') {
      this._startTicking();
    }
  }

  _finish(a) {
    this.active = null;
    const mode = this._tempoMode(a);
    if (mode !== 'match' && mode !== 'keep') {
      this._setCps(a, a.newCps);
    }
    // The transition's wrapper goes before the hold installs its own: never two at once.
    a.releaseTempo?.();
    if (mode === 'match') {
      this._startTempoHold({ kind: 'glide', from: a.lastCps, to: a.newCps, start: a.end, L: a.settings.length });
    } else if (mode === 'keep') {
      this._startTempoHold({ kind: 'keep', cps: a.lastCps, ownCps: a.newCps });
    }
    if (this.gainAutomated && a.buildType === 'dip') {
      this.gainAutomated = false; // the ramps have run their course
    }
    // Drop the old pattern: from here the scheduler queries only the new track (origin-shifted).
    try {
      Promise.resolve(this.repl.setPattern(a.newPat, false)).catch((error) =>
        console.warn('[TrackTransitionController] setPattern at the end failed:', error),
      );
    } catch (error) {
      console.warn('[TrackTransitionController] setPattern at the end failed:', error);
    }
    if (a.trimState && this.metering) {
      this.measure = { trimState: a.trimState, oldRms: a.oldRms, from: a.end, to: a.end + NEW_LOUDNESS_CYCLES };
    } else {
      this.metering = false;
    }
    this._emit('end', { type: a.type, T: a.T, end: a.end });
    a.resolve({ type: a.type, T: a.T, end: a.end });
  }

  /**
   * Spec 027: hold the tempo after a Match (`glide`: from → to over [start, start+L]) or Keep
   * (`keep`: stay at `cps`; the track's own tempo is `ownCps`) transition. While it lasts, the
   * scheduler's setCps comes here: a setcps that changes the tempo ends it and applies at once.
   */
  _startTempoHold(hold) {
    this._endTempoHold();
    const wrap = this._wrapSetCps((cps) => this._onTempoHoldRequest(hold, cps));
    hold.apply = wrap.apply;
    hold.restore = wrap.restore;
    hold.lastCps = hold.kind === 'glide' ? hold.from : hold.cps;
    this.tempoHold = hold;
    if (hold.kind === 'glide') {
      this._startTicking();
    }
  }

  /** A setcps/setcpm (a hot swap of the playing track, or anything else) while a hold lasts. */
  _onTempoHoldRequest(hold, cps) {
    const value = cps ?? DEFAULT_CPS;
    if (this.tempoHold !== hold) {
      hold.apply(value); // a stale wrapper (another one was installed over it): pass through
      return;
    }
    if (hold.kind === 'keep' && value === hold.ownCps) {
      return; // the track's code still sets its own tempo: the set tempo stays
    }
    this._endTempoHold();
    hold.apply(value);
  }

  _tickTempoHold(now) {
    const hold = this.tempoHold;
    if (hold?.kind !== 'glide') {
      return;
    }
    const done = now >= hold.start + hold.L;
    const cps = done ? hold.to : glideCps(now, { T: hold.start, L: hold.L, oldCps: hold.from, newCps: hold.to });
    if (cps !== hold.lastCps) {
      hold.lastCps = cps;
      hold.apply(cps);
    }
    if (done) {
      this._endTempoHold();
    }
  }

  /**
   * A switch failed to evaluate: put back the hold it ended. Keep holds the same tempo again; a
   * slide continues from the tempo the clock is at now over what remains of it (no jump), or
   * lands on its target when nothing remains. Not after a Stop or destroy, or over another hold.
   */
  _resumeTempoHold(prev) {
    if (!prev || this.tempoHold || !this.scheduler?.started) {
      return;
    }
    if (prev.kind === 'keep') {
      this._startTempoHold({ kind: 'keep', cps: prev.cps, ownCps: prev.ownCps });
      return;
    }
    const now = this._now();
    const end = prev.start + prev.L;
    const from = this.scheduler.cps ?? prev.lastCps;
    if (now >= end) {
      if (from !== prev.to) {
        this.scheduler.setCps(prev.to);
      }
      return;
    }
    const start = Math.max(now, prev.start);
    this._startTempoHold({ kind: 'glide', from, to: prev.to, start, L: end - start });
  }

  /** Restore the scheduler's own setCps and forget the hold (idempotent). */
  _endTempoHold() {
    const hold = this.tempoHold;
    if (!hold) {
      return;
    }
    this.tempoHold = null;
    hold.restore();
  }

  _sampleLoudness() {
    if (!this.destinationGain || !this.audioContext) {
      return;
    }
    if (!this.meter) {
      this.meter = new LoudnessMeter(this.audioContext, this.destinationGain);
    }
    // The output lags the pattern by the scheduler latency: stamp readings with the cycle they sound at.
    const cps = this.scheduler?.cps ?? DEFAULT_CPS;
    const at = this._now() - (this.scheduler?.latency ?? 0) * cps;
    try {
      this.meter.sample(at);
    } catch (error) {
      console.warn('[TrackTransitionController] loudness reading failed:', error);
      this.metering = false;
    }
  }

  _checkMeasure(now) {
    const m = this.measure;
    if (!m) {
      return;
    }
    const cps = this.scheduler?.cps ?? DEFAULT_CPS;
    if (now - (this.scheduler?.latency ?? 0) * cps < m.to) {
      return;
    }
    const newRms = this.meter?.rmsOver(m.from, m.to);
    m.trimState.value = computeTrim(m.oldRms, newRms);
    m.trimState.start = transitionStart(now, { type: 'crossfade', snap: 0 });
    this.measure = null;
    this.metering = false;
  }

  _cancelMeasure() {
    // The trim state object stays attached to the (now old) pattern unchanged: no level jump.
    this.measure = null;
    this.metering = false;
  }

  _startTicking() {
    if (this.timer !== null) {
      return;
    }
    const cps = this.scheduler?.cps || DEFAULT_CPS;
    const delay = Math.min(50, Math.max(10, 1000 / (GLIDE_STEPS_PER_CYCLE * cps)));
    const set = this._setTimeout ?? globalThis.setTimeout;
    this.timer = set(this._tick, delay);
  }

  _clearTimer() {
    if (this.timer !== null) {
      (this._clearTimeout ?? globalThis.clearTimeout)(this.timer);
      this.timer = null;
    }
  }

  _now() {
    const scheduler = this.scheduler;
    if (!scheduler?.now) {
      return 0;
    }
    const now = scheduler.now();
    return Number.isFinite(now) ? now : 0;
  }

  /**
   * The scheduler stopped (the repl's onToggle(false)): the next start is at cycle 0, so the
   * origin and trim reset. A running transition is cancelled (its promise resolves with
   * `cancelled: true`), a pending Dip ramp is undone with a short ramp, and a switch still
   * evaluating will start like a fresh track.
   */
  stopped() {
    this._endTempoHold(); // Play starts the track at its own tempo
    this.origin = 0;
    this.trimState = null;
    if (this.armed) {
      this.armed.immediate = true;
    }
    const capture = this._capture;
    if (capture) {
      // onToggle(false) resets the tempo synchronously after this call; don't let that reset
      // replace a setcps the new code already made.
      capture.resetting = true;
      Promise.resolve().then(() => (capture.resetting = false));
    }
    const a = this.active;
    if (a) {
      a.releaseTempo?.();
      this.active = null;
      this._emit('end', { type: a.type, T: a.T, end: a.end, cancelled: true });
      a.resolve({ type: a.type, T: a.T, end: a.end, cancelled: true });
    }
    this._cancelMeasure();
    this._restoreGain();
    this._dropQueue();
  }

  /**
   * Point the controller at the main engine's current output. superdough's
   * `resetGlobalEffects()` (run by the website's instant-switch reset) replaces
   * `destinationGain`, so Dip ramps and the loudness tap must follow it. Call it before a
   * switch. Nothing happens while a switch is in flight (its ramps live on the old node) or when
   * the output is unchanged; otherwise the loudness tap on the old node is disconnected.
   * @param {Object} output
   * @param {AudioContext} [output.audioContext]
   * @param {GainNode} [output.destinationGain]
   * @returns {boolean} whether the output was replaced
   */
  setOutput({ audioContext, destinationGain } = {}) {
    const ctx = audioContext ?? this.audioContext;
    const gain = destinationGain ?? this.destinationGain;
    if (this.busy || (ctx === this.audioContext && gain === this.destinationGain)) {
      return false;
    }
    this._cancelMeasure();
    this.meter?.destroy();
    this.meter = null;
    this.gainAutomated = false;
    this.audioContext = ctx;
    this.destinationGain = gain;
    return true;
  }

  /** What the controller is doing, for the UI. */
  getState() {
    const a = this.active;
    return {
      phase: a ? a.phase : this.armed ? 'evaluating' : 'idle',
      type: a?.type,
      T: a?.T,
      end: a?.end,
      origin: this.origin,
      queued: this.queued !== null,
      tempoHold: this.tempoHold?.kind ?? null,
    };
  }

  async _ensureAudioContextRunning() {
    const ctx = this.audioContext;
    if (ctx?.state !== 'suspended') {
      return;
    }
    let timeout;
    try {
      await Promise.race([
        ctx.resume(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('AudioContext resume timeout')), 5000);
        }),
      ]);
    } catch (error) {
      throw new Error('Failed to resume AudioContext: ' + error.message);
    } finally {
      clearTimeout(timeout);
    }
  }

  _safely(label, fn) {
    try {
      fn();
    } catch (error) {
      console.warn(`[TrackTransitionController] ${label} failed:`, error);
    }
  }

  _emit(name, detail) {
    const target = this.eventTarget ?? (typeof window !== 'undefined' ? window : undefined);
    if (!target?.dispatchEvent || typeof CustomEvent === 'undefined') {
      return;
    }
    target.dispatchEvent(new CustomEvent(`track-transition-${name}`, { detail: { ...detail, timestamp: Date.now() } }));
  }

  /** Stop timers, disconnect the loudness tap, cancel anything pending. */
  destroy() {
    this._clearTimer();
    this._endTempoHold();
    const a = this.active;
    this.active = null;
    a?.releaseTempo?.();
    a?.resolve({ cancelled: true });
    this.armed = null;
    this._dropQueue();
    this._cancelMeasure();
    this.meter?.destroy();
    this.meter = null;
    this.repl = null;
    this.audioContext = null;
    this.destinationGain = null;
  }
}
