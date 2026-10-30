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
export const TRANSITION_SNAPS = Object.freeze([0, 1, 4, 8]);
export const DEFAULT_TRANSITION_SETTINGS = Object.freeze({
  type: 'dip',
  length: 4,
  snap: 0,
  glide: false,
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
 * @param {Object} [settings]
 * @returns {{type: string, length: number, snap: number, glide: boolean, matchLoudness: boolean}}
 */
export function normalizeTransitionSettings(settings = {}) {
  const s = settings ?? {};
  const length = Number(s.length);
  const snap = Number(s.snap);
  return {
    type: TRANSITION_TYPES.includes(s.type) ? s.type : DEFAULT_TRANSITION_SETTINGS.type,
    length: Number.isFinite(length) && length > 0 ? nearestLength(length) : DEFAULT_TRANSITION_SETTINGS.length,
    snap: TRANSITION_SNAPS.includes(snap) ? snap : 0,
    glide: Boolean(s.glide),
    matchLoudness: Boolean(s.matchLoudness),
  };
}

/**
 * The transition start T for a switch armed at cycle `now`: the next boundary of
 * max(snap, the type's minimum) cycles strictly after `now + SAFETY_MARGIN`; without a
 * boundary, `now + SAFETY_MARGIN` rounded up to the beat grid.
 */
export function transitionStart(now, { type, snap = 0 }) {
  const base = now + SAFETY_MARGIN;
  const size = Math.max(snap || 0, TYPE_MIN_SNAP[type] || 0);
  if (size > 0) {
    return (Math.floor(base / size) + 1) * size;
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
        return pattern;
      }
      return this._arm(sw, pattern);
    }
    if (this.active) {
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
    const T = transitionStart(now, { type, snap });
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
   * @param {Object} [settings] overrides `getSettings()`: { type, length, snap, glide, matchLoudness }
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
    try {
      await this._ensureAudioContextRunning();
      const settings = normalizeTransitionSettings(settingsArg ?? this.getSettings?.());
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
      }
      this._safely('cleanupCanvases', () => this.cleanupCanvases?.());
      if (prepare) {
        try {
          await prepare();
        } catch (error) {
          console.warn('[TrackTransitionController] prepare() failed:', error);
        }
      }
      this.armed = sw;
      try {
        await this.repl.evaluate(code);
      } finally {
        if (this.armed === sw) {
          this.armed = null;
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
    const scheduler = this.scheduler;
    if (!scheduler) {
      return { recorded: undefined, restore() {} };
    }
    const own = Object.prototype.hasOwnProperty.call(scheduler, 'setCps');
    const original = scheduler.setCps;
    const capture = {
      recorded: undefined,
      restore() {
        if (own) {
          scheduler.setCps = original;
        } else {
          delete scheduler.setCps;
        }
      },
    };
    scheduler.setCps = (cps) => {
      capture.recorded = cps ?? DEFAULT_CPS;
    };
    return capture;
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
      seconds = a.L / Math.max(a.oldCps, a.newCps);
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
    const up = silent + a.L / a.newCps;
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
    this.scheduler?.setCps(cps);
  }

  /** The tempo plan (tech §2.2 step 6) at cycle `now`. */
  _applyTempo(a, now) {
    if (a.buildType === 'dip') {
      // The old tempo holds until the output is silent; the new one is set at that moment.
      if (now >= a.T + a.L) {
        this._setCps(a, a.newCps);
      }
      return;
    }
    if (a.settings.glide && isOverlapping(a.buildType)) {
      this._setCps(a, glideCps(now, { T: a.T, L: a.L, oldCps: a.oldCps, newCps: a.newCps }));
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
    if (this.metering) {
      this._sampleLoudness();
      this._checkMeasure(now);
    }
    if (this.active || this.metering) {
      this._startTicking();
    }
  }

  _finish(a) {
    this.active = null;
    this._setCps(a, a.newCps);
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
    this.origin = 0;
    this.trimState = null;
    if (this.armed) {
      this.armed.immediate = true;
    }
    const a = this.active;
    if (a) {
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
    const a = this.active;
    this.active = null;
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
