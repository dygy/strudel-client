/**
 * MasterFx.mjs - the Master FX stage: filter, delay and reverb throws, beat-repeat (spec 032 tech §2.2).
 *
 * One object with one input and one output, meant for superdough's master insert slot
 * (`controller.setMasterInsert(fx.input, { output: fx.output, onChannelCount: (n) => fx.setChannelCount(n) })`):
 *
 * ```
 * input → [beat-repeat worklet] → filter (dry/wet crossfade) → split
 * split → output                                        (dry, never turned down)
 * split → delay send → delay ↺ feedback → delay level → output
 * split → reverb send → convolver → reverb level → output
 * ```
 *
 * At rest (filter in its dead zone, nothing thrown, no roll) the output is the input exactly: the
 * worklet copies sample for sample, the wet and send gains are exactly 0.
 *
 * Every change ramps: sends 10 ms linear, the filter's dry/wet 10 ms linear, cutoff and Q glides
 * (τ 15 ms), delay time glides (τ 50 ms), levels 20 ms linear, reverb decay changes by a 50 ms
 * convolver crossfade, the worklet's loop points by 3 ms equal-power crossfades. Until the worklet
 * module has loaded the input goes straight to the filter (rolls are refused). It knows nothing of
 * the app: times are AudioContext seconds, lengths seconds, tempo cps. `destroy()` disconnects every
 * node it made.
 *
 * @license AGPL-3.0-or-later
 */

import {
  filterParams,
  clampFilterPosition,
  MASTER_FX_LP_OPEN_HZ,
  MASTER_FX_HP_OPEN_HZ,
  MASTER_FX_Q_FLAT,
} from './filterCurve.mjs';
import { BEAT_REPEAT_PROCESSOR, loadBeatRepeatWorklet } from './beatRepeatLoader.mjs';
import {
  MASTER_FX_DEFAULTS,
  MASTER_FX_RANGES,
  MASTER_FX_DELAY_FRACTIONS,
  sanitizeMasterFxSettings,
} from './masterFxSettings.mjs';

/** Seconds a throw's send takes to open or close (linear). */
export const MASTER_FX_SEND_RAMP_SECONDS = 0.01;
/** Seconds of the filter's dry/wet crossfade (linear). */
export const MASTER_FX_FILTER_FADE_SECONDS = 0.01;
/** Time constant of the cutoff and Q glides. */
export const MASTER_FX_CUTOFF_TAU = 0.015;
/** Time constant of the delay-time glide (tempo or fraction changes). */
export const MASTER_FX_DELAY_TIME_TAU = 0.05;
/** Seconds a level or feedback change takes (linear). */
export const MASTER_FX_LEVEL_RAMP_SECONDS = 0.02;
/** Seconds of the crossfade between the old and the new convolver on a decay change. */
export const MASTER_FX_REVERB_SWAP_SECONDS = 0.05;
/** A decay change rebuilds the impulse response after the slider rests this long. */
export const MASTER_FX_REVERB_DEBOUNCE_MS = 150;
/** stopTails(): the delay and reverb levels reach 0 within this many seconds … */
export const MASTER_FX_STOP_FADE_SECONDS = 0.1;
/** … and come back (with empty delay line and convolver, the sends closed) after this many ms. */
export const MASTER_FX_STOP_RESTORE_MS = 250;
/** The longest delay time; a longer fraction / cps is clamped. */
export const MASTER_FX_MAX_DELAY_SECONDS = 4;
/** Seconds of the crossfade when the beat-repeat worklet comes into (or is rebuilt in) the path. */
export const MASTER_FX_WORKLET_SWAP_SECONDS = 0.003;
/**
 * Seconds after a worklet node is made before the crossfade into it starts: its processor is built
 * on the audio thread and outputs silence until then (measured: the first quantum).
 */
export const MASTER_FX_WORKLET_SETTLE_SECONDS = 0.02;
/** The tempo assumed until setCps is called. */
export const MASTER_FX_DEFAULT_CPS = 0.5;

/** Ms after a crossfade before the retired nodes are disconnected. */
const CLEANUP_MARGIN_MS = 50;

/**
 * A stereo impulse response: decorrelated noise × exp(−6.9·t/decay) (−60 dB at `decay`), `decay` long.
 * @param {BaseAudioContext} ctx
 * @param {number} decay - Seconds.
 * @param {function(): number} [random] - 0..1 (default Math.random).
 * @returns {AudioBuffer}
 */
export function makeReverbImpulse(ctx, decay, random = Math.random) {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.round(decay * sr));
  const buffer = ctx.createBuffer(2, length, sr);
  const k = -6.9 / (decay * sr);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (random() * 2 - 1) * Math.exp(k * i);
  }
  return buffer;
}

export class MasterFx {
  /**
   * @param {BaseAudioContext} audioContext - The main (speakers) context.
   * @param {object} [options]
   * @param {number} [options.channelCount] - Output channels (default the destination's).
   * @param {Promise<void>|false} [options.workletReady] - Resolves once the beat-repeat module is on
   *   the context (default: {@link loadBeatRepeatWorklet}); `false`: no beat-repeat.
   * @param {object} [options.settings] - Initial settings (sanitised; see masterFxSettings.mjs).
   * @param {number} [options.cps] - Initial tempo.
   * @param {function(): number} [options.random] - Noise source for the impulse response (tests).
   */
  constructor(audioContext, { channelCount, workletReady, settings, cps, random } = {}) {
    const ctx = audioContext;
    this.audioContext = ctx;
    this.channelCount = Math.max(1, Math.floor(channelCount || ctx.destination?.channelCount || 2));
    this.random = random ?? Math.random;
    /** @private Every node this stage made and still owns. */
    this.nodes = new Set();
    /** @private Pending timers (cleanups, the reverb debounce, the stop restore). */
    this.timers = new Set();
    /**
     * @private param → { value, time } set by setParamNow. A browser's `param.value` still reads the
     * old value until the audio thread renders the change, so a ramp scheduled at that same instant
     * must start from the value just set, not from `param.value`.
     */
    this.justSet = new WeakMap();
    this.destroyed = false;

    const s = sanitizeMasterFxSettings(settings ?? MASTER_FX_DEFAULTS);
    this.resonance = s.resonance;
    this.delaySettings = { ...s.delay };
    this.reverbSettings = { ...s.reverb };
    this.cps = Number.isFinite(cps) && cps > 0 ? cps : MASTER_FX_DEFAULT_CPS;
    this.filterPos = 0;
    this.filterOn = false;
    /** @private Context time the wet path is silent from (after a crossfade to dry). */
    this.wetSilentAt = 0;
    this.delayHeld = false;
    this.reverbHeld = false;
    this.stopping = false;

    const gain = (value) => {
      const node = this.make(ctx.createGain());
      if (value !== 1) this.setParamNow(node.gain, value); // before it is connected
      return node;
    };

    /** The stage's input: connect the source here. */
    this.input = gain(1);
    /** The stage's output. */
    this.output = gain(1);

    // Beat-repeat: until the worklet is in, the input goes straight to the filter through `bypass`.
    this.filterIn = gain(1);
    this.bypass = gain(1);
    this.input.connect(this.bypass);
    this.bypass.connect(this.filterIn);
    /** @private The worklet path in use: { node, gain } or null. */
    this.worklet = null;

    // Filter: a dry path and a wet one (low-pass → high-pass), crossfaded.
    this.dry = gain(1);
    this.wet = gain(0);
    this.lowpass = this.make(ctx.createBiquadFilter());
    this.lowpass.type = 'lowpass';
    this.highpass = this.make(ctx.createBiquadFilter());
    this.highpass.type = 'highpass';
    this.setParamNow(this.lowpass.frequency, MASTER_FX_LP_OPEN_HZ);
    this.setParamNow(this.highpass.frequency, MASTER_FX_HP_OPEN_HZ);
    this.setParamNow(this.lowpass.Q, MASTER_FX_Q_FLAT);
    this.setParamNow(this.highpass.Q, MASTER_FX_Q_FLAT);
    this.split = gain(1);
    this.filterIn.connect(this.dry);
    this.dry.connect(this.split);
    this.filterIn.connect(this.lowpass);
    this.lowpass.connect(this.highpass);
    this.highpass.connect(this.wet);
    this.wet.connect(this.split);
    this.split.connect(this.output);

    // Delay throw.
    this.delaySend = gain(0);
    this.delayLevel = gain(this.delaySettings.level);
    this.split.connect(this.delaySend);
    this.delayLevel.connect(this.output);
    this.delay = null;
    this.feedback = null;
    this.buildDelayCore();

    // Reverb throw.
    this.reverbSend = gain(0);
    this.reverbLevel = gain(this.reverbSettings.level);
    this.split.connect(this.reverbSend);
    this.reverbLevel.connect(this.output);
    /** @private { convolver, gain, decay } in use. */
    this.reverb = null;
    this.reverb = this.buildReverbSlot(makeReverbImpulse(ctx, this.reverbSettings.decay, this.random), 1);
    this.reverbBuiltDecay = this.reverbSettings.decay;

    /** True once the beat-repeat worklet is in the path. */
    this.workletLoaded = false;
    const loading = workletReady === false ? null : (workletReady ?? loadBeatRepeatWorklet(ctx));
    /**
     * Settles once the beat-repeat worklet is in the path (true) or could not load (false).
     * @type {Promise<boolean>}
     */
    this.ready = loading
      ? Promise.resolve(loading).then(
          () => this.installWorklet(),
          (err) => {
            if (!this.destroyed) console.warn('[MasterFx] beat-repeat worklet failed to load:', err);
            return false;
          },
        )
      : Promise.resolve(false);
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers

  /** @private Own a node (disconnected on destroy). */
  make(node) {
    this.nodes.add(node);
    return node;
  }

  /** @private Disconnect a node and stop owning it. */
  retire(node) {
    if (!node) return;
    try {
      node.disconnect();
    } catch {
      // already disconnected
    }
    node.port?.close?.();
    this.nodes.delete(node);
  }

  /** @private Run `fn` after `ms`, unless destroyed first. */
  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  /** @private Clear a timer from `later`. */
  cancel(id) {
    if (id == null) return;
    clearTimeout(id);
    this.timers.delete(id);
  }

  /** @private A param set at the current time (for nodes not in the audible path yet). */
  setParamNow(param, value) {
    const now = this.audioContext.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(value, now);
    this.justSet.set(param, { value, time: now });
  }

  /** @private Where `param` is now: the value setParamNow just set at this instant, else `param.value`. */
  currentValue(param) {
    const set = this.justSet.get(param);
    return set && set.time === this.audioContext.currentTime ? set.value : param.value;
  }

  /** @private A linear ramp from where `param` is now to `value`, over `seconds` (starting at `at`). */
  ramp(param, value, seconds, at = this.audioContext.currentTime) {
    const now = this.audioContext.currentTime;
    const current = this.currentValue(param);
    this.justSet.delete(param);
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    if (at > now) param.setValueAtTime(current, at);
    param.linearRampToValueAtTime(value, Math.max(at, now) + seconds);
  }

  /** @private An exponential glide from where `param` is now towards `value` (time constant `tau`), from `at`. */
  glide(param, value, tau, at = this.audioContext.currentTime) {
    const now = this.audioContext.currentTime;
    const current = this.currentValue(param);
    this.justSet.delete(param);
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.setTargetAtTime(value, Math.max(at, now), tau);
  }

  // ---------------------------------------------------------------------------------------------
  // Filter

  /**
   * The filter knob: −100 (low-pass 150 Hz) … 0 (off) … +100 (high-pass 6 kHz); ±3 is off too.
   * @param {number} pos
   */
  setFilter(pos) {
    if (this.destroyed) return;
    this.filterPos = clampFilterPosition(pos);
    this.applyFilter();
  }

  /**
   * The filter's resonance, 0..1 (Q 0.707 … 8 on the side in use).
   * @param {number} r01
   */
  setResonance(r01) {
    if (this.destroyed) return;
    const { min, max } = MASTER_FX_RANGES.resonance;
    if (typeof r01 !== 'number' || !Number.isFinite(r01)) return;
    this.resonance = Math.min(max, Math.max(min, r01));
    if (this.filterOn) this.applyFilter();
  }

  /** @private Drive the filter nodes from filterPos and resonance. */
  applyFilter() {
    const p = filterParams(this.filterPos, this.resonance);
    const now = this.audioContext.currentTime;
    const fade = MASTER_FX_FILTER_FADE_SECONDS;
    const tau = MASTER_FX_CUTOFF_TAU;
    const lp = this.lowpass;
    const hp = this.highpass;
    if (p.wet && !this.filterOn) {
      // Leaving the dead zone: open both filters first (the wet path is silent), crossfade to wet,
      // then glide to the cutoff. If the wet path is still fading out, glide from where it is.
      let glideFrom = now + fade;
      if (now >= this.wetSilentAt) {
        this.setParamNow(lp.frequency, MASTER_FX_LP_OPEN_HZ);
        this.setParamNow(hp.frequency, MASTER_FX_HP_OPEN_HZ);
        this.setParamNow(lp.Q, MASTER_FX_Q_FLAT);
        this.setParamNow(hp.Q, MASTER_FX_Q_FLAT);
      } else {
        glideFrom = now;
      }
      this.ramp(this.wet.gain, 1, fade);
      this.ramp(this.dry.gain, 0, fade);
      this.glideFilter(p, glideFrom, tau);
      this.filterOn = true;
    } else if (p.wet) {
      this.glideFilter(p, now, tau);
    } else if (this.filterOn) {
      this.ramp(this.wet.gain, 0, fade);
      this.ramp(this.dry.gain, 1, fade);
      this.wetSilentAt = now + fade;
      this.filterOn = false;
    }
  }

  /** @private Glide both biquads to `p` from `at`. */
  glideFilter(p, at, tau) {
    const glide = (param, value) => {
      const now = this.audioContext.currentTime;
      if (at > now) {
        // The param was just set at `now`: start the approach later, keeping that value.
        param.setTargetAtTime(value, at, tau);
      } else {
        this.glide(param, value, tau);
      }
    };
    glide(this.lowpass.frequency, p.lpHz);
    glide(this.highpass.frequency, p.hpHz);
    glide(this.lowpass.Q, p.lpQ);
    glide(this.highpass.Q, p.hpQ);
  }

  // ---------------------------------------------------------------------------------------------
  // Delay

  /** @private The delay time for the current fraction and tempo, clamped. */
  delayTime() {
    return Math.min(MASTER_FX_MAX_DELAY_SECONDS, this.delaySettings.fraction / this.cps);
  }

  /** @private (Re)build the delay line and its feedback loop between delaySend and delayLevel. */
  buildDelayCore() {
    const ctx = this.audioContext;
    const delay = this.make(ctx.createDelay(MASTER_FX_MAX_DELAY_SECONDS));
    const feedback = this.make(ctx.createGain());
    this.setParamNow(delay.delayTime, this.delayTime());
    this.setParamNow(feedback.gain, this.stopping ? 0 : this.delaySettings.feedback);
    this.delaySend.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(this.delayLevel);
    const old = [this.delay, this.feedback];
    this.delay = delay;
    this.feedback = feedback;
    old.forEach((n) => this.retire(n));
  }

  /**
   * Delay settings; omitted fields stay. `fraction` of a cycle (one of 1/8, 3/16, 1/4, 3/8),
   * `feedback` 0..0.9, `level` 0..1. Invalid values are ignored.
   * @param {{fraction?: number, feedback?: number, level?: number}} settings
   */
  setDelay({ fraction, feedback, level } = {}) {
    if (this.destroyed) return;
    const d = this.delaySettings;
    const hit = MASTER_FX_DELAY_FRACTIONS.find((c) => Math.abs(c - fraction) < 1e-9);
    if (hit !== undefined && hit !== d.fraction) {
      d.fraction = hit;
      this.glide(this.delay.delayTime, this.delayTime(), MASTER_FX_DELAY_TIME_TAU);
    }
    const fb = MASTER_FX_RANGES.delayFeedback;
    if (Number.isFinite(feedback) && feedback >= fb.min && feedback <= fb.max && feedback !== d.feedback) {
      d.feedback = feedback;
      if (!this.stopping) this.ramp(this.feedback.gain, feedback, MASTER_FX_LEVEL_RAMP_SECONDS);
    }
    const lv = MASTER_FX_RANGES.delayLevel;
    if (Number.isFinite(level) && level >= lv.min && level <= lv.max && level !== d.level) {
      d.level = level;
      if (!this.stopping) this.ramp(this.delayLevel.gain, level, MASTER_FX_LEVEL_RAMP_SECONDS);
    }
  }

  /**
   * The tempo (cycles per second); the delay time follows it by gliding.
   * @param {number} cps
   */
  setCps(cps) {
    if (this.destroyed || !Number.isFinite(cps) || cps <= 0 || cps === this.cps) return;
    this.cps = cps;
    this.glide(this.delay.delayTime, this.delayTime(), MASTER_FX_DELAY_TIME_TAU);
  }

  /**
   * Open (true) or close (false) the delay send, over 10 ms. What is in the delay rings out.
   * @param {boolean} on
   */
  throwDelay(on) {
    if (this.destroyed) return;
    this.delayHeld = !!on;
    this.ramp(this.delaySend.gain, on ? 1 : 0, MASTER_FX_SEND_RAMP_SECONDS);
  }

  // ---------------------------------------------------------------------------------------------
  // Reverb

  /** @private A convolver (+ its crossfade gain at `gainValue`) between reverbSend and reverbLevel. */
  buildReverbSlot(buffer, gainValue) {
    const ctx = this.audioContext;
    const convolver = this.make(ctx.createConvolver());
    convolver.normalize = true;
    convolver.buffer = buffer;
    const g = this.make(ctx.createGain());
    this.setParamNow(g.gain, gainValue);
    this.reverbSend.connect(convolver);
    convolver.connect(g);
    g.connect(this.reverbLevel);
    return { convolver, gain: g, buffer };
  }

  /**
   * Reverb settings; omitted fields stay. `decay` 1..8 s, `level` 0..1. Invalid values are ignored.
   * A decay change rebuilds the impulse response once the value rests for 150 ms and crossfades to
   * it over 50 ms.
   * @param {{decay?: number, level?: number}} settings
   */
  setReverb({ decay, level } = {}) {
    if (this.destroyed) return;
    const r = this.reverbSettings;
    const dr = MASTER_FX_RANGES.reverbDecay;
    if (Number.isFinite(decay) && decay >= dr.min && decay <= dr.max && decay !== r.decay) {
      r.decay = decay;
      this.cancel(this.reverbTimer);
      this.reverbTimer = this.later(() => {
        this.reverbTimer = null;
        this.rebuildReverb();
      }, MASTER_FX_REVERB_DEBOUNCE_MS);
    }
    const lv = MASTER_FX_RANGES.reverbLevel;
    if (Number.isFinite(level) && level >= lv.min && level <= lv.max && level !== r.level) {
      r.level = level;
      if (!this.stopping) this.ramp(this.reverbLevel.gain, level, MASTER_FX_LEVEL_RAMP_SECONDS);
    }
  }

  /** @private Swap in a convolver for the current decay, crossfaded; the old one goes after its fade. */
  rebuildReverb() {
    const decay = this.reverbSettings.decay;
    if (decay === this.reverbBuiltDecay) return;
    this.reverbBuiltDecay = decay;
    const old = this.reverb;
    const next = this.buildReverbSlot(makeReverbImpulse(this.audioContext, decay, this.random), 0);
    this.reverb = next;
    this.ramp(next.gain.gain, 1, MASTER_FX_REVERB_SWAP_SECONDS);
    this.ramp(old.gain.gain, 0, MASTER_FX_REVERB_SWAP_SECONDS);
    this.later(
      () => {
        this.retire(old.convolver);
        this.retire(old.gain);
      },
      MASTER_FX_REVERB_SWAP_SECONDS * 1000 + CLEANUP_MARGIN_MS,
    );
  }

  /**
   * Open (true) or close (false) the reverb send, over 10 ms. The tail rings out.
   * @param {boolean} on
   */
  throwReverb(on) {
    if (this.destroyed) return;
    this.reverbHeld = !!on;
    this.ramp(this.reverbSend.gain, on ? 1 : 0, MASTER_FX_SEND_RAMP_SECONDS);
  }

  // ---------------------------------------------------------------------------------------------
  // Stop

  /**
   * Stop: close both sends and fade the delay and reverb out within 0.1 s; after 0.25 s the delay
   * line and the convolver are replaced by empty ones and the levels come back (sends still
   * closed), so nothing echoes on after Stop.
   */
  stopTails() {
    if (this.destroyed) return;
    const send = MASTER_FX_SEND_RAMP_SECONDS;
    this.delayHeld = false;
    this.reverbHeld = false;
    this.ramp(this.delaySend.gain, 0, send);
    this.ramp(this.reverbSend.gain, 0, send);
    this.ramp(this.feedback.gain, 0, send);
    this.ramp(this.delayLevel.gain, 0, MASTER_FX_STOP_FADE_SECONDS);
    this.ramp(this.reverbLevel.gain, 0, MASTER_FX_STOP_FADE_SECONDS);
    this.stopping = true;
    this.cancel(this.stopTimer);
    this.stopTimer = this.later(() => {
      this.stopTimer = null;
      this.stopping = false;
      // Empty delay line and convolver (both silent now: their levels are 0).
      this.buildDelayCore();
      const old = this.reverb;
      this.reverb = this.buildReverbSlot(old.buffer, 1);
      this.retire(old.convolver);
      this.retire(old.gain);
      const ramp = MASTER_FX_SEND_RAMP_SECONDS;
      this.ramp(this.delayLevel.gain, this.delaySettings.level, ramp);
      this.ramp(this.reverbLevel.gain, this.reverbSettings.level, ramp);
    }, MASTER_FX_STOP_RESTORE_MS);
  }

  // ---------------------------------------------------------------------------------------------
  // Beat-repeat

  /** @private Put a fresh worklet node in the path (crossfaded from the current path). */
  installWorklet() {
    if (this.destroyed) return false;
    const ctx = this.audioContext;
    const n = this.channelCount;
    let node;
    try {
      node = this.make(
        new AudioWorkletNode(ctx, BEAT_REPEAT_PROCESSOR, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: n,
          channelCountMode: 'explicit',
          channelInterpretation: 'discrete',
          outputChannelCount: [n],
        }),
      );
    } catch (err) {
      console.warn('[MasterFx] beat-repeat worklet could not be created:', err);
      return false;
    }
    const g = this.make(ctx.createGain());
    this.setParamNow(g.gain, 0);
    this.input.connect(node);
    node.connect(g);
    g.connect(this.filterIn);
    const old = this.worklet;
    this.worklet = { node, gain: g, channels: n };
    // Both paths carry the same signal (the idle worklet is an exact copy), so a linear crossfade is seamless.
    const swap = MASTER_FX_WORKLET_SWAP_SECONDS;
    const at = ctx.currentTime + MASTER_FX_WORKLET_SETTLE_SECONDS;
    this.ramp(g.gain, 1, swap, at);
    this.ramp((old ? old.gain : this.bypass).gain, 0, swap, at);
    if (old) {
      this.later(
        () => {
          this.retire(old.node);
          this.retire(old.gain);
        },
        (MASTER_FX_WORKLET_SETTLE_SECONDS + swap) * 1000 + CLEANUP_MARGIN_MS,
      );
    }
    this.workletLoaded = true;
    return true;
  }

  /**
   * Start (or restart) a roll: the slice `[startTime, startTime + length)` (AudioContext seconds)
   * repeats once the track has played it; `null` stops (back to live, where the track is).
   * Refused (false) until the worklet has loaded.
   * @param {{startTime: number, length: number}|null} roll
   * @returns {boolean}
   */
  roll(roll) {
    if (this.destroyed || !this.worklet) return false;
    if (roll == null) {
      this.worklet.node.port.postMessage({ type: 'stop' });
      return true;
    }
    const sr = this.audioContext.sampleRate;
    const { startTime, length } = roll;
    if (!Number.isFinite(startTime) || !Number.isFinite(length) || length <= 0) return false;
    this.worklet.node.port.postMessage({
      type: 'roll',
      startFrame: Math.round(startTime * sr),
      lengthFrames: Math.round(length * sr),
    });
    return true;
  }

  /**
   * The roll's slice length in seconds; applies at the next repeat.
   * @param {number} seconds
   * @returns {boolean}
   */
  setRollLength(seconds) {
    if (this.destroyed || !this.worklet || !Number.isFinite(seconds) || seconds <= 0) return false;
    this.worklet.node.port.postMessage({
      type: 'length',
      lengthFrames: Math.round(seconds * this.audioContext.sampleRate),
    });
    return true;
  }

  /**
   * The output's channel count (superdough's `onChannelCount` on reset). The worklet's count is
   * fixed when it is made, so a different count rebuilds it (a roll in progress ends).
   * @param {number} n
   */
  setChannelCount(n) {
    const count = Math.max(1, Math.floor(n) || 1);
    if (this.destroyed || count === this.channelCount) return;
    this.channelCount = count;
    if (this.worklet) this.installWorklet();
  }

  // ---------------------------------------------------------------------------------------------

  /** Disconnect every node this stage made and cancel its timers. Idempotent. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.timers.forEach((id) => clearTimeout(id));
    this.timers.clear();
    [...this.nodes].forEach((node) => this.retire(node));
    this.worklet = null;
  }
}
