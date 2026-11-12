/**
 * scratchDsp.mjs - the vinyl scratch DSP (spec 019, tech §2.2).
 *
 * Pure: no Web Audio, no DOM, no browser globals. The `scratch-processor` AudioWorklet
 * (scratchProcessor.mjs) wraps it, and the unit tests drive it directly.
 *
 * While nobody holds the platter, the input passes through bit-exact and is written into a
 * ring buffer. `grab()` freezes the ring and crossfades (10 ms, linear, per sample) from the
 * live input to a read head that follows a target position the main thread moves. `release()`
 * resumes writing at once and crossfades back. Live input is never interrupted, only attenuated.
 *
 * @module @strudel/mixer/scratch/scratchDsp
 * @license AGPL-3.0-or-later
 */

/** Seconds of audio the ring keeps, i.e. how far back the record reaches. */
export const SCRATCH_DSP_BUFFER_SECONDS = 8;
/** Length of the live↔scratch crossfade, in seconds. */
export const SCRATCH_MIX_SECONDS = 0.01;
/** Largest playback rate the read head may reach (and the motor clamp), in × normal speed. */
export const SCRATCH_MAX_RATE = 8;

/**
 * The scratch DSP for one deck. Every buffer is allocated in the constructor; `process()`
 * never allocates.
 *
 * Positions are in samples relative to the moment of the grab: 0 is the last sample heard
 * before the grab, negative is older. The read head is clamped to [−bufferSeconds, 0]; at
 * either edge it stops, the stylus-velocity gain falls to 0, and the output is silent.
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
    // Hermite reads need one sample of headroom on each side of the readable span.
    this.length = Math.ceil(seconds * sr) + 4;
    this.ring = [];
    for (let c = 0; c < channels; c++) this.ring.push(new Float32Array(this.length));
    this.writeIndex = 0;
    this.frozen = false;
    this.grabbed = false;
    this.grabIndex = 0;
    this.writtenSinceRelease = 0;

    /** Oldest reachable position, in samples (≈ −bufferSeconds). */
    this.minPos = -Math.ceil(seconds * sr);
    this.pos = 0;
    this.targetPos = 0;
    this.motorRate = 0;
    this.maxRate = SCRATCH_MAX_RATE;
    // One-pole position smoother, τ ≈ 8 ms: message jitter becomes a smooth rate.
    this.posAlpha = 1 - Math.exp(-1 / (0.008 * sr));
    // Stylus-velocity gain: |Δpos| / 0.05 clamped to [0, 1], smoothed with τ ≈ 5 ms.
    this.velGain = 0;
    this.velAlpha = 1 - Math.exp(-1 / (0.005 * sr));
    // DC blocker (≈ 10 Hz one-pole high-pass) on the scratch path, per channel.
    this.dcR = Math.exp((-2 * Math.PI * 10) / sr);
    this.dcX = new Float64Array(channels);
    this.dcY = new Float64Array(channels);

    /** Current live→scratch mix, 0 (live) … 1 (scratch). */
    this.mix = 0;
    this.mixCount = 0;
    this.mixTarget = 0;
    this.mixSteps = Math.max(1, Math.floor(SCRATCH_MIX_SECONDS * sr));

    this.silence = new Float32Array(128);
  }

  /** True while the scratch path is audible or the platter is held (not bit-exact pass-through). */
  get active() {
    return this.grabbed || this.mix > 0;
  }

  /** Stops writing the ring and records the grab point. */
  freeze() {
    if (this.frozen) return;
    this.frozen = true;
    this.grabIndex = this.writeIndex;
  }

  /** Resumes writing the ring. */
  unfreeze() {
    if (!this.frozen) return;
    this.frozen = false;
    this.writtenSinceRelease = 0;
  }

  /**
   * Grab the platter: freeze the ring here and ramp to the scratch signal. A grab while
   * already held is a no-op. A grab during the release ramp keeps the read head on the same
   * recorded sample, so the scratch signal does not jump.
   */
  grab() {
    if (this.grabbed) return;
    const reGrab = this.mix > 0;
    // The ring has advanced by `writtenSinceRelease` samples since the previous grab point.
    const shift = reGrab ? this.writtenSinceRelease : 0;
    this.freeze();
    this.grabbed = true;
    this.motorRate = 0;
    if (reGrab) {
      this.pos = Math.max(this.minPos, this.pos - shift);
      this.targetPos = this.pos;
    } else {
      this.pos = 0;
      this.targetPos = 0;
      this.velGain = 0;
      this.dcX.fill(0);
      this.dcY.fill(0);
    }
    this.mixTarget = 1;
  }

  /** Let go: writing resumes at once and the output ramps back to the live input. No-op unless held. */
  release() {
    if (!this.grabbed) return;
    this.grabbed = false;
    this.motorRate = 0;
    this.unfreeze();
    this.mixTarget = 0;
  }

  /**
   * Move the platter by `seconds` of audio (negative = backwards). Ignored unless held, and
   * ignored for NaN / ±Infinity. The target is clamped to the record's edges.
   * @param {number} seconds
   */
  moveBy(seconds) {
    if (!this.grabbed || typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
    this.targetPos = this.clampPos(this.targetPos + seconds * this.sampleRate);
  }

  /**
   * Turn the platter continuously at `rate` × normal speed (1 = forwards, −1 = backwards,
   * 0 = stop). Ignored unless held and for NaN / ±Infinity; clamped to ±8.
   * @param {number} rate
   */
  setMotor(rate) {
    if (!this.grabbed || typeof rate !== 'number' || !Number.isFinite(rate)) return;
    this.motorRate = Math.max(-this.maxRate, Math.min(this.maxRate, rate));
  }

  /** @private */
  clampPos(p) {
    return p < this.minPos ? this.minPos : p > 0 ? 0 : p;
  }

  /** Read head position in seconds relative to the grab point (≤ 0). */
  get posSeconds() {
    return this.pos / this.sampleRate;
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

    // Idle: bit-exact pass-through, plus the ring write.
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
      // Mix ramp: linear, one integer step per sample (exact endpoints), sample-accurate.
      if (this.mixTarget === 1) {
        if (this.mixCount < this.mixSteps) this.mixCount++;
      } else if (this.mixCount > 0) {
        this.mixCount--;
      }
      this.mix = this.mixCount / this.mixSteps;

      // Motor, smoother, rate clamp.
      if (this.motorRate !== 0) this.targetPos = this.clampPos(this.targetPos + this.motorRate);
      let delta = (this.targetPos - this.pos) * this.posAlpha;
      if (delta > this.maxRate) delta = this.maxRate;
      else if (delta < -this.maxRate) delta = -this.maxRate;
      const prevPos = this.pos;
      this.pos = this.clampPos(this.pos + delta);
      const speed = Math.abs(this.pos - prevPos);
      const gTarget = speed >= 0.05 ? 1 : speed / 0.05;
      this.velGain += (gTarget - this.velGain) * this.velAlpha;

      // Read position in the ring. grabIndex − 1 is the last sample before the grab; reading
      // from grabIndex − 2 keeps the Hermite look-ahead (i2) on recorded audio at pos 0.
      let abs = this.grabIndex - 2 + this.pos;
      abs = ((abs % len) + len) % len;
      const i0 = Math.floor(abs);
      const frac = abs - i0;
      const im1 = i0 === 0 ? len - 1 : i0 - 1;
      const i1 = i0 + 1 === len ? 0 : i0 + 1;
      const i2 = i1 + 1 === len ? 0 : i1 + 1;
      const mix = this.mix;
      const g = this.velGain;

      for (let c = 0; c < outputs.length; c++) {
        const input = inCount === 0 ? this.silence : c < inCount ? inputs[c] : inCount === 1 ? inputs[0] : this.silence;
        const live = i < input.length ? input[i] : 0;
        let scratch = 0;
        if (c < chCount) {
          const r = ring[c];
          // 4-point, 3rd-order Hermite.
          const xm1 = r[im1];
          const x0 = r[i0];
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
        outputs[c][i] = live * (1 - mix) + scratch * mix;
      }

      if (!this.frozen) {
        // Writing resumed on release while the mix ramps down.
        const w = this.writeIndex;
        for (let c = 0; c < chCount; c++) {
          const input =
            inCount === 0 ? this.silence : c < inCount ? inputs[c] : inCount === 1 ? inputs[0] : this.silence;
          ring[c][w] = i < input.length ? input[i] : 0;
        }
        this.writeIndex = w + 1 === len ? 0 : w + 1;
        this.writtenSinceRelease++;
      }
    }
  }

  /** @private Write one idle block into the ring. */
  writeBlock(inputs, inCount, n) {
    if (this.frozen) return;
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
    this.writtenSinceRelease += n;
  }
}
