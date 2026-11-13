/**
 * scratchDsp.mjs - the vinyl scratch DSP (spec 019 tech §2.2, reworked by spec 023 tech §2.1).
 *
 * Pure: no Web Audio, no DOM, no browser globals. The `scratch-processor` AudioWorklet
 * (scratchProcessor.mjs) wraps it, and the unit tests drive it directly.
 *
 * The ring is always written, held or not. The read head sits `lag` samples behind the newest
 * input sample, so holding the record still makes the lag grow by one sample per sample, and a
 * forward push can bring the record back up to "now" (spec 023 2.1).
 *
 * Phases:
 * - `live`: nobody holds the record. The input passes through bit-exact (and is written).
 * - `held`: grabbed. A brake stops the turning record over ~0.1 s (raised cosine); the hand
 *   (moveBy, setMotor) moves it. Output crossfades (10 ms) from live to the record.
 * - `spinUp`: let go. The motor brings the record to rate 1 over ~0.4 s (stretched to land on
 *   the snapped lag), then a correction bump, if needed, lands the lag exactly on the target.
 * - `settled`: rate 1 at the target lag. A lag above 0 is reported (`lagSettled`) so the main
 *   thread shifts the deck's pattern by it; the deck then sends `handOver` with the sample
 *   where the shifted live input arrives. Target 0 hands over at once.
 * - `handOver`: a ~20 ms crossfade from the record to live, then `live` again (`idle`).
 *
 * @module @strudel/mixer/scratch/scratchDsp
 * @license AGPL-3.0-or-later
 */

import {
  SCRATCH_BRAKE_SECONDS,
  SCRATCH_HANDOVER_SECONDS,
  planScratchRelease,
  scratchBumpSeconds,
  scratchSmoothStep,
} from './scratchPhysics.mjs';

/** Seconds of audio the ring keeps, i.e. how far back the record reaches. */
export const SCRATCH_DSP_BUFFER_SECONDS = 8;
/** Length of the live→record crossfade at a grab, in seconds. */
export const SCRATCH_MIX_SECONDS = 0.01;
/** Largest playback rate the read head may reach (and the motor clamp), in × normal speed. */
export const SCRATCH_MAX_RATE = 8;
/** The smallest lag the 4-point read can have: its look-ahead sample is the newest input sample. */
export const SCRATCH_MIN_LAG_SAMPLES = 2;
/** A settled record that gets no `handOver` within this long goes back to live by itself. */
export const SCRATCH_SETTLE_TIMEOUT_SECONDS = 3;

/** The DSP's phases (see the module doc). */
export const SCRATCH_PHASES = Object.freeze(['live', 'held', 'spinUp', 'settled', 'handOver']);

/**
 * The scratch DSP for one deck. Every buffer is allocated in the constructor; `process()`
 * never allocates.
 */
export class ScratchDsp {
  /**
   * @param {number} sampleRate - Context sample rate in Hz.
   * @param {number} [channelCount=2] - Channels to buffer and process.
   * @param {number} [bufferSeconds=8] - Ring length in seconds.
   */
  constructor(sampleRate, channelCount = 2, bufferSeconds = SCRATCH_DSP_BUFFER_SECONDS) {
    const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
    const channels = Math.max(1, Math.floor(channelCount) || 1);
    const seconds = Number.isFinite(bufferSeconds) && bufferSeconds > 0 ? bufferSeconds : SCRATCH_DSP_BUFFER_SECONDS;
    this.sampleRate = sr;
    this.channelCount = channels;
    // Hermite reads need headroom on each side of the readable span.
    this.length = Math.ceil(seconds * sr) + 4;
    this.ring = [];
    for (let c = 0; c < channels; c++) this.ring.push(new Float32Array(this.length));
    /** Ring index the next input sample goes to. */
    this.writeIndex = 0;
    /** Input samples processed since construction (the DSP's clock). */
    this.n = 0;

    /** @type {'live'|'held'|'spinUp'|'settled'|'handOver'} */
    this.phase = 'live';
    this.grabbed = false;
    /** A grab that waits for the running hand-over to finish (see grab()). */
    this.grabQueued = false;

    this.minLag = SCRATCH_MIN_LAG_SAMPLES;
    /** Largest lag, in samples (≈ bufferSeconds). */
    this.maxLag = this.length - 4;
    /** How far the read head is behind the newest input sample, in samples. */
    this.lag = this.minLag;
    /** The record's actual rate over the last sample (0 at an edge while held). */
    this.rate = 1;
    /** The brake / motor part of the rate (without the hand). */
    this.motor = 1;

    // The hand: moveBy distance not yet travelled (samples), smoothed with τ ≈ 8 ms.
    this.handPending = 0;
    this.posAlpha = 1 - Math.exp(-1 / (0.008 * sr));
    /** Keyboard motor while held (setMotor), × normal speed. */
    this.motorRate = 0;
    this.maxRate = SCRATCH_MAX_RATE;

    // Brake.
    this.brakeFrom = 0;
    this.brakeT = 0;
    this.brakeLen = Math.max(1, Math.round(SCRATCH_BRAKE_SECONDS * sr));

    // Spin-up plan (samples).
    this.upFrom = 0;
    this.upLen = 1;
    this.bumpLen = 0;
    this.bumpDepth = 0;
    this.spinT = 0;
    this.targetLag = this.minLag;
    this.targetZero = true;
    this.releaseId = 0;
    this.settledAt = 0;
    /** Sample (DSP clock) at which the hand-over starts, or -1 while not scheduled. */
    this.handOverAt = -1;
    /** Sample at which the shifted live input starts arriving (the main thread's shift time). */
    this.shiftAt = -1;
    this.settleTimeout = Math.round(SCRATCH_SETTLE_TIMEOUT_SECONDS * sr);

    // Spec 023 review 5(b): a grab after the pattern shift was applied but before the hand-over
    // holds a record that straddles two timelines. From `spliceAt` the ring holds the shifted
    // input (old content `spliceShift` samples later), so reads map through the splice and the
    // lag is counted in the old timeline's content until the next return to live.
    this.spliceAt = -1;
    this.spliceShift = 0;
    this.spliceCrossed = false;

    /** The latest release's plan (seconds), sent once to the main thread for the platter. */
    this.planTarget = 0;
    this.planUp = 0;
    this.planFrom = 0;
    this.planBumpSeconds = 0;
    this.planDepth = 0;

    // Stylus-velocity gain: |rate| / 0.05 clamped to [0, 1], smoothed with τ ≈ 5 ms.
    this.velGain = 1;
    this.velAlpha = 1 - Math.exp(-1 / (0.005 * sr));
    // DC blocker (≈ 10 Hz one-pole high-pass) on the record path, per channel.
    this.dcR = Math.exp((-2 * Math.PI * 10) / sr);
    this.dcX = new Float64Array(channels);
    this.dcY = new Float64Array(channels);

    /** Current live→record mix, 0 (live) … 1 (record). */
    this.mix = 0;
    this.mixCount = 0;
    this.mixTarget = 0;
    this.grabSteps = Math.max(1, Math.floor(SCRATCH_MIX_SECONDS * sr));
    this.handOverSteps = Math.max(1, Math.floor(SCRATCH_HANDOVER_SECONDS * sr));
    this.mixSteps = this.grabSteps;

    /**
     * The last event for the main thread, read and cleared by {@link takeEvent}: `'lagSettled'`
     * or `'idle'` (back to live), with {@link eventId} and {@link eventLagSeconds}.
     * @type {null|'lagSettled'|'idle'}
     */
    this.event = null;
    this.eventId = 0;
    this.eventLagSeconds = 0;

    this.silence = new Float32Array(128);
  }

  /** True while the record path is audible or the platter is held (not bit-exact pass-through). */
  get active() {
    return this.phase !== 'live' || this.mix > 0;
  }

  /** The read head in seconds relative to the newest input sample (≤ 0). */
  get posSeconds() {
    return -this.lag / this.sampleRate;
  }

  /** The lag in seconds. */
  get lagSeconds() {
    return this.lag / this.sampleRate;
  }

  /**
   * Grab the platter. The turning record brakes to a stop (~0.1 s) and the output ramps to it.
   * A grab while held is a no-op.
   *
   * A grab once the hand-over is scheduled (the pattern is already shifted, its audio on the way)
   * starts at once too, braking from where the record is: the ring is read through the splice
   * where the shifted input begins (see `spliceAt`), so the record stays one continuous piece of
   * the old timeline. Only during the 20 ms hand-over crossfade itself (or with a splice already
   * in use) does the grab wait for live; moves made meanwhile are kept. A grab of a settled
   * record with no hand-over scheduled starts at once: messages arrive in order, so the main
   * thread grabbed before it saw the lag and will ignore it (no shift happens).
   */
  grab() {
    if (this.grabbed) return;
    this.grabbed = true;
    this.handPending = 0;
    this.motorRate = 0;
    const scheduled = (this.phase === 'settled' || this.phase === 'spinUp') && this.handOverAt >= 0;
    if (this.phase === 'handOver' || (scheduled && this.spliceAt >= 0)) {
      this.grabQueued = true;
      return;
    }
    if (scheduled) {
      this.spliceAt = this.shiftAt >= 0 ? this.shiftAt : this.handOverAt;
      this.spliceShift = this.targetLag;
      this.spliceCrossed = false;
      this.handOverAt = -1;
      // Already past the splice: the record's lag in the old timeline's content.
      this.crossSplice();
    }
    this.startHold();
  }

  /**
   * @private How far behind the newest ring sample a record at (content) lag `lag` reads: the
   * same lag without a splice; across one, the ring's copy of that content.
   */
  readLag(lag) {
    if (this.spliceAt < 0) return lag;
    const nowShift = this.spliceCrossed ? this.spliceShift : 0;
    const content = this.n - nowShift - lag;
    return lag + nowShift - (content >= this.spliceAt ? this.spliceShift : 0);
  }

  /** @private The shifted input has begun: the lag (in old-timeline content) drops by the shift. */
  crossSplice() {
    if (this.spliceAt < 0 || this.spliceCrossed || this.n < this.spliceAt) return;
    this.spliceCrossed = true;
    this.lag = Math.max(this.minLag, this.lag - this.spliceShift);
  }

  /** @private */
  startHold() {
    this.grabQueued = false;
    if (this.phase === 'live') {
      this.lag = this.minLag;
      this.spliceAt = -1;
      this.motor = 1;
      this.velGain = 1;
      this.dcX.fill(0);
      this.dcY.fill(0);
    }
    this.phase = 'held';
    this.brakeFrom = this.motor;
    this.brakeT = 0;
    this.setMix(1, this.grabSteps);
  }

  /**
   * Let go: the motor spins the record up and the lag lands on its target.
   * @param {object} [options]
   * @param {number} [options.id] - Echoed in `lagSettled` / `idle`.
   * @param {number} [options.beatSeconds=0] - Snap to this beat; 0 = snap off.
   */
  release(options) {
    if (!this.grabbed) return;
    this.grabbed = false;
    this.motorRate = 0;
    this.handPending = 0;
    const id = options?.id;
    if (Number.isFinite(id)) this.releaseId = id;
    if (this.grabQueued) {
      // The grab never started: the hand-over carries on.
      this.grabQueued = false;
      return;
    }
    const sr = this.sampleRate;
    const plan = planScratchRelease({
      lagSeconds: this.lag / sr,
      fromRate: this.rate,
      beatSeconds: options?.beatSeconds,
      maxLagSeconds: (this.maxLag - this.handOverSteps - this.spliceShift) / sr - 0.5,
      minLagSeconds: this.minLag / sr,
    });
    this.planTarget = plan.targetSeconds;
    this.planUp = plan.upSeconds;
    this.planFrom = plan.fromRate;
    this.planBumpSeconds = plan.bumpSeconds;
    this.planDepth = plan.bumpDepth;
    this.phase = 'spinUp';
    this.upFrom = plan.fromRate;
    this.upLen = Math.max(1, Math.round(plan.upSeconds * sr));
    this.bumpLen = 0;
    this.bumpDepth = 0;
    this.spinT = 0;
    this.targetZero = plan.targetSeconds === 0;
    this.targetLag = Math.max(this.minLag, plan.targetSeconds * sr);
    this.handOverAt = -1;
  }

  /**
   * The main thread has shifted the pattern: start the hand-over at DSP sample `atSample`
   * (now, if it is in the past). `shiftSample` is where the shifted input begins (default
   * `atSample`). For the settled release `id`, or a release still spinning up whose planned lag
   * the main thread applied early (an Update during the spin-up): its hand-over is then quick,
   * at `atSample`, wherever the spin-up has got to.
   * @param {number} id
   * @param {number} atSample
   * @param {number} [shiftSample]
   */
  handOver(id, atSample, shiftSample) {
    if (id !== this.releaseId) return;
    if (this.phase === 'held' && this.spliceAt < 0 && this.targetLag > this.minLag) {
      // Grabbed again before the main thread knew when the shifted input arrives (sync mode):
      // the hand-over is moot, but where the input changes timeline is not.
      this.spliceAt = Number.isFinite(shiftSample) ? shiftSample : atSample;
      this.spliceShift = this.targetLag;
      this.spliceCrossed = false;
      this.crossSplice();
      return;
    }
    if (this.phase !== 'settled' && this.phase !== 'spinUp') return;
    this.handOverAt = Number.isFinite(atSample) ? Math.max(this.n, atSample) : this.n;
    this.shiftAt = Number.isFinite(shiftSample) ? shiftSample : this.handOverAt;
  }

  /** Go back to live now (a 20 ms crossfade) from a spin-up or a settled record. Holds are kept. */
  abort() {
    if (this.phase === 'spinUp' || this.phase === 'settled') this.startHandOver();
  }

  /** @private */
  startHandOver() {
    this.phase = 'handOver';
    this.handOverAt = -1;
    this.setMix(0, this.handOverSteps);
  }

  /** @private Retarget the mix ramp, continuing from the current mix. */
  setMix(target, steps) {
    const m = this.mixCount / this.mixSteps;
    this.mixSteps = steps;
    this.mixCount = Math.round(m * steps);
    this.mixTarget = target;
  }

  /**
   * Move the platter by `seconds` of audio (negative = backwards). Ignored unless held, and
   * ignored for NaN / ±Infinity. Clamped to the record's edges (8 s back, "now" forwards).
   * @param {number} seconds
   */
  moveBy(seconds) {
    if (!this.grabbed || typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
    const next = this.handPending + seconds * this.sampleRate;
    // Forward moves shrink the lag: never past the newest sample nor the oldest one.
    const lo = this.lag - this.maxLag;
    const hi = this.lag - this.minLag;
    this.handPending = next < lo ? lo : next > hi ? (hi > 0 ? hi : 0) : next;
  }

  /**
   * Turn the held platter continuously at `rate` × normal speed (1 = forwards, −1 = backwards,
   * 0 = stop). Ignored unless held and for NaN / ±Infinity; clamped to ±8.
   * @param {number} rate
   */
  setMotor(rate) {
    if (!this.grabbed || typeof rate !== 'number' || !Number.isFinite(rate)) return;
    this.motorRate = Math.max(-this.maxRate, Math.min(this.maxRate, rate));
  }

  /** Read and clear the pending event (see {@link event}). */
  takeEvent() {
    const e = this.event;
    this.event = null;
    return e;
  }

  /**
   * Process one block. `inputs[c]` / `outputs[c]` are per-channel sample arrays; missing input
   * channels count as silence (and a mono input feeds every channel). Never allocates unless a
   * block is longer than every block before it.
   * @param {ArrayLike<Float32Array>|undefined} inputs
   * @param {ArrayLike<Float32Array>} outputs
   * @param {number} [frames]
   */
  process(inputs, outputs, frames) {
    const n = frames ?? outputs?.[0]?.length ?? 0;
    if (!outputs || n === 0) return;
    if (this.silence.length < n) this.silence = new Float32Array(n);
    const inCount = inputs ? inputs.length : 0;
    const chCount = Math.min(this.channelCount, outputs.length);

    // Live: bit-exact pass-through, plus the ring write.
    if (!this.active) {
      for (let c = 0; c < outputs.length; c++) {
        const input = inCount === 0 ? this.silence : c < inCount ? inputs[c] : inCount === 1 ? inputs[0] : this.silence;
        const out = outputs[c];
        if (input.length === n && out.length === n) {
          out.set(input);
        } else {
          for (let i = 0; i < n; i++) out[i] = i < input.length ? input[i] : 0;
        }
      }
      this.writeBlock(inputs, inCount, n);
      return;
    }

    const len = this.length;
    const ring = this.ring;
    for (let i = 0; i < n; i++) {
      // 1. Write the input sample: the newest sample the record can reach.
      const w = this.writeIndex;
      for (let c = 0; c < chCount; c++) {
        const input = inCount === 0 ? this.silence : c < inCount ? inputs[c] : inCount === 1 ? inputs[0] : this.silence;
        ring[c][w] = i < input.length ? input[i] : 0;
      }

      // 2. The record's rate this sample.
      const phase = this.phase;
      let v = 1;
      if (phase === 'held') {
        let motor = 0;
        if (this.brakeT < this.brakeLen) {
          motor = this.brakeFrom * (1 - scratchSmoothStep(this.brakeT / this.brakeLen));
          this.brakeT++;
        }
        this.motor = motor;
        const hand = this.handPending * this.posAlpha;
        this.handPending -= hand;
        v = motor + this.motorRate + hand;
        if (v > this.maxRate) v = this.maxRate;
        else if (v < -this.maxRate) v = -this.maxRate;
      } else if (phase === 'spinUp') {
        const t = this.spinT;
        if (t < this.upLen) {
          v = this.upFrom + (1 - this.upFrom) * scratchSmoothStep(t / this.upLen);
        } else {
          if (t === this.upLen) this.planBump();
          const tb = t - this.upLen;
          if (tb < this.bumpLen) {
            const s = Math.sin((Math.PI * tb) / this.bumpLen);
            v = 1 - this.bumpDepth * s * s;
          }
        }
        this.spinT = t + 1;
        this.motor = v;
      } else {
        this.motor = 1;
      }

      // 3. Lag: holding still adds one sample per sample; the edges clamp it. After a splice
      // the oldest edge is where the *read* lag (see readLag) reaches the ring's end.
      if (this.spliceAt >= 0 && !this.spliceCrossed) this.crossSplice();
      let lag = this.lag + 1 - v;
      let edge = false;
      if (lag < this.minLag) {
        edge = phase === 'held' && lag < this.minLag - 1e-6;
        lag = this.minLag;
      } else {
        const over = this.readLag(lag) - this.maxLag;
        if (over > 0) {
          edge = phase === 'held';
          lag -= over;
        }
      }
      if (edge) this.handPending = 0;
      this.rate = edge ? 0 : 1 - (lag - this.lag);
      this.lag = lag;
      const speed = edge ? 0 : Math.abs(v);
      const gTarget = speed >= 0.05 ? 1 : speed / 0.05;
      this.velGain += (gTarget - this.velGain) * this.velAlpha;

      // 4. Spin-up done: land exactly on the target and settle. A release whose lag the main
      // thread already applied (handOverAt set, an Update during the spin-up) hands over once it
      // has landed and its time has come: never at a lag short of the planned one.
      if (phase === 'spinUp' && this.spinT >= this.upLen + this.bumpLen && this.spinT > this.upLen) {
        this.lag = this.targetLag;
        this.phase = 'settled';
        this.settledAt = this.n;
        if (this.targetZero) {
          this.startHandOver();
        } else if (this.handOverAt < 0) {
          this.event = 'lagSettled';
          this.eventId = this.releaseId;
          this.eventLagSeconds = this.targetLag / this.sampleRate;
        }
      } else if (this.phase === 'settled') {
        if (this.handOverAt >= 0 ? this.n >= this.handOverAt : this.n - this.settledAt >= this.settleTimeout) {
          this.startHandOver();
        }
      }

      // 5. Mix ramp: linear, one integer step per sample (exact endpoints), sample-accurate.
      if (this.mixTarget === 1) {
        if (this.mixCount < this.mixSteps) this.mixCount++;
      } else if (this.mixCount > 0) {
        this.mixCount--;
      }
      this.mix = this.mixCount / this.mixSteps;

      // 6. Read the record at `lag` behind the newest sample (4-point, 3rd-order Hermite),
      // through the splice if there is one.
      const rawLag = Math.min(this.maxLag, Math.max(this.minLag, this.readLag(this.lag)));
      let abs = w - rawLag;
      if (abs < 0) abs += len;
      const i0 = Math.floor(abs);
      const frac = abs - i0;
      const i0w = i0 >= len ? i0 - len : i0;
      const im1 = i0w === 0 ? len - 1 : i0w - 1;
      const i1 = i0w + 1 === len ? 0 : i0w + 1;
      const i2 = i1 + 1 === len ? 0 : i1 + 1;
      const mix = this.mix;
      const g = this.velGain;

      for (let c = 0; c < outputs.length; c++) {
        const input = inCount === 0 ? this.silence : c < inCount ? inputs[c] : inCount === 1 ? inputs[0] : this.silence;
        const live = i < input.length ? input[i] : 0;
        let scratch = 0;
        if (c < chCount) {
          const r = ring[c];
          const xm1 = r[im1];
          const x0 = r[i0w];
          const x1 = r[i1];
          const x2 = r[i2];
          const c1 = 0.5 * (x1 - xm1);
          const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
          const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
          const s = (((c3 * frac + c2) * frac + c1) * frac + x0) * g;
          // DC blocker: y[n] = x[n] − x[n−1] + R·y[n−1].
          const y = s - this.dcX[c] + this.dcR * this.dcY[c];
          this.dcX[c] = s;
          this.dcY[c] = y;
          scratch = y;
        }
        outputs[c][i] = mix === 0 ? live : live * (1 - mix) + scratch * mix;
      }

      this.writeIndex = w + 1 === len ? 0 : w + 1;
      this.n++;

      // 7. Hand-over finished: live again (a grab that waited starts now).
      if (this.phase === 'handOver' && this.mixCount === 0) {
        this.phase = 'live';
        this.lag = this.minLag;
        this.spliceAt = -1;
        this.spliceShift = 0;
        this.motor = 1;
        this.rate = 1;
        this.event = 'idle';
        this.eventId = this.releaseId;
        if (this.grabQueued) this.startHold();
      }
    }
  }

  /** @private After the spin-up: plan the bump that lands the lag exactly on the target. */
  planBump() {
    const error = this.targetLag - this.lag; // samples; > 0 = fall further behind
    if (Math.abs(error) < 1e-9) {
      this.bumpLen = 0;
      this.bumpDepth = 0;
      return;
    }
    const seconds = scratchBumpSeconds(error / this.sampleRate, this.targetZero);
    this.bumpLen = Math.max(2, Math.round(seconds * this.sampleRate));
    // Σ sin²(πt/N) over t = 0…N−1 is exactly N/2, so the lag changes by depth·N/2.
    this.bumpDepth = (2 * error) / this.bumpLen;
  }

  /** @private Write one live block into the ring. */
  writeBlock(inputs, inCount, n) {
    const len = this.length;
    for (let c = 0; c < this.channelCount; c++) {
      const input = inCount === 0 ? this.silence : c < inCount ? inputs[c] : inCount === 1 ? inputs[0] : this.silence;
      const r = this.ring[c];
      let w = this.writeIndex;
      const avail = Math.min(n, input.length);
      for (let i = 0; i < n; i++) {
        r[w] = i < avail ? input[i] : 0;
        w = w + 1 === len ? 0 : w + 1;
      }
    }
    this.writeIndex = (this.writeIndex + n) % len;
    this.n += n;
  }
}
