/**
 * loudnessCore.mjs - the loudness meter's DSP, pure (spec 033 functional §2.2–2.4, tech §2.1).
 *
 * No Web Audio, DOM or browser globals: it runs inside the `loudness-meter-processor` AudioWorklet
 * and in Node tests on plain Float32Arrays.
 *
 * What it measures (EBU R128 / ITU-R BS.1770-4, EBU Tech 3341 / 3342):
 * - **K-weighting**: the BS.1770-4 pre-filter (high shelf) and RLB high-pass, two biquads per
 *   channel in transposed direct form II, state kept across calls. Coefficients come from the
 *   analog prototypes by the bilinear transform (as libebur128 does), so any sample rate works; at
 *   48 kHz they reproduce the standard's table.
 * - **Sub-blocks** of 100 ms: the K-weighted mean square, summed over the channels (weights 1.0;
 *   the input is 2 channels, a mono input counts as L = R).
 * - **Momentary** (M): the last 4 sub-blocks (400 ms). **Short-term** (S): the last 30 (3 s).
 *   Until a window has filled, it is the mean over the sub-blocks measured so far.
 * - **Integrated** (I): 400 ms gating blocks at a 100 ms hop, absolute gate −70 LUFS, relative
 *   gate −10 LU below the absolute-gated mean. Block powers live in a histogram of 0.01 LU bins
 *   (−70…+5 LUFS) holding count and exact power sum, so memory is flat for any set length and the
 *   result is not quantised; only the relative gate edge is resolved to the bin width.
 * - **Loudness range** (LRA, EBU Tech 3342): full 3 s short-term values at a 100 ms hop, absolute
 *   gate −70, relative gate −20 LU, the 95th minus the 10th percentile (a second histogram). Null
 *   until 10 s have been measured (functional §2.6).
 * - **True peak**: 4× oversampling with the BS.1770-4 Annex 2 FIR (48 taps, 4 phases of 12), per
 *   channel with history across calls; never below the sample peak. The maximum since reset, and
 *   over the last 100 ms.
 * - **Sample peak and RMS** per channel over the last 300 ms (30 chunks of 10 ms).
 * - **Over events** (functional §2.4), each with a count; a new event starts when the previous
 *   over sample of that reason is at least 0.5 s old:
 *   - `truePeak`: a true peak above −1 dBTP;
 *   - `limiter`: a pre-limiter sample at or above the EQ limiter's −0.3 dBFS ceiling;
 *   - `clip`: a post-EQ sample at or above 0 dBFS, checked only while no pre-limiter input is
 *     present (the EQ is off, so nothing limits the output).
 *   The thresholds are compared at float32 precision (`Math.fround`): the samples are float32, and a
 *   sample at exactly −0.3 dBFS rounds to just under the double-precision ceiling (the trap spec
 *   030's `OVER_SAMPLE` documents).
 *
 * Loudness is `−0.691 + 10·log10(Σ meanSquare)`; silence, or a power at or below the absolute
 * gate, is `null`, never −Infinity.
 *
 * @module @strudel/mixer/meter/loudnessCore
 * @license AGPL-3.0-or-later
 */

/** Sub-block length, seconds (the hop of every loudness window). */
export const LOUDNESS_SUBBLOCK_SECONDS = 0.1;
/** Sub-blocks in the Momentary window (400 ms; also the gating block). */
export const LOUDNESS_MOMENTARY_BLOCKS = 4;
/** Sub-blocks in the Short-term window (3 s). */
export const LOUDNESS_SHORT_TERM_BLOCKS = 30;
/** The absolute gate, LUFS (Integrated and LRA). */
export const LOUDNESS_ABSOLUTE_GATE = -70;
/** Integrated's relative gate, LU below the absolute-gated mean. */
export const LOUDNESS_RELATIVE_GATE = -10;
/** LRA's relative gate, LU below the absolute-gated mean of the short-term values. */
export const LOUDNESS_LRA_RELATIVE_GATE = -20;
/** LRA is null until this many seconds have been measured. */
export const LOUDNESS_LRA_MIN_SECONDS = 10;
/** The gating histograms: 0.01 LU bins from −70 to +5 LUFS (louder blocks land in the top bin). */
export const LOUDNESS_HISTOGRAM = Object.freeze({ min: -70, max: 5, binWidth: 0.01, bins: 7500 });
/** The sample peak / RMS window, seconds. */
export const LOUDNESS_PEAK_WINDOW_SECONDS = 0.3;
/** Over events of one reason closer than this (seconds) are one event. */
export const LOUDNESS_OVER_MERGE_SECONDS = 0.5;
/** Over reason `truePeak`: a true peak above this, dBTP (the usual streaming headroom). */
export const LOUDNESS_TRUE_PEAK_LIMIT_DBTP = -1;
/** Over reason `limiter`: a pre-limiter sample at or above this, dBFS (the EQ limiter's threshold, spec 020). */
export const LOUDNESS_LIMITER_CEILING_DBFS = -0.3;
/** The over reasons, in display order. */
export const LOUDNESS_OVER_REASONS = Object.freeze(['truePeak', 'limiter', 'clip']);

/** The K-weighting's offset (dB): BS.1770's −0.691, so a 1 kHz sine reads its dBFS level. */
const LOUDNESS_OFFSET = -0.691;
const SUBBLOCK_RING = LOUDNESS_SHORT_TERM_BLOCKS;
/** 10 ms chunks for the peak/RMS/true-peak windows. */
const CHUNK_SECONDS = 0.01;
const CHUNK_RING = Math.round(LOUDNESS_PEAK_WINDOW_SECONDS / CHUNK_SECONDS);
/** Chunks in the true-peak "block" window (100 ms). */
const TP_BLOCK_CHUNKS = Math.round(LOUDNESS_SUBBLOCK_SECONDS / CHUNK_SECONDS);
/** Filter states below this are flushed to 0 after each call (no subnormals after silence). */
const DENORMAL = 1e-25;

// Thresholds at the samples' precision (float32): see the module comment.
const TRUE_PEAK_LIMIT_F32 = Math.fround(10 ** (LOUDNESS_TRUE_PEAK_LIMIT_DBTP / 20));
const LIMITER_CEILING_F32 = Math.fround(10 ** (LOUDNESS_LIMITER_CEILING_DBFS / 20));
const CLIP_F32 = Math.fround(1);

/**
 * The true-peak interpolation filter of ITU-R BS.1770-4, Annex 2 ("Guidelines for accurate
 * measurement of true-peak level", the 48-tap, 4-phase FIR interpolating by 4), as the four phases
 * of 12 taps each. Phase k gives the sample at time n + k/4 from x[n − 0 … n − 11].
 */
export const TRUE_PEAK_FIR = Object.freeze([
  Object.freeze([
    0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625, 0.97216796875,
    -0.102294921875, 0.047607421875, -0.026611328125, 0.014892578125, -0.00830078125,
  ]),
  Object.freeze([
    -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625, 0.77978515625,
    -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375,
  ]),
  Object.freeze([
    -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625, 0.465087890625,
    -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875,
  ]),
  Object.freeze([
    -0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875, 0.97216796875, 0.1373291015625,
    -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375,
  ]),
]);
const FIR_TAPS = 12;
const FIR_PHASES = 4;
/** Phase-major flat copy for the inner loop. */
const FIR_FLAT = Float64Array.from(TRUE_PEAK_FIR.flat());

/**
 * @typedef {object} Biquad
 * @property {number[]} b - [b0, b1, b2]
 * @property {number[]} a - [1, a1, a2]
 */

/**
 * The BS.1770-4 K-weighting filter for a sample rate: the pre-filter (a high shelf, +4 dB above
 * ~1.7 kHz) and the RLB high-pass (~38 Hz), each a biquad normalised to a0 = 1. Derived from the
 * analog prototypes by the bilinear transform (libebur128's derivation), so at 48 kHz it gives the
 * standard's table: pre b = [1.53512485958697, −2.69169618940638, 1.19839281085285],
 * a = [1, −1.69065929318241, 0.73248077421585]; RLB b = [1, −2, 1], a = [1, −1.99004745483398, 0.99007225036621].
 * @param {number} sampleRate - Hz
 * @returns {{ pre: Biquad, rlb: Biquad }}
 */
export function kWeightingCoefficients(sampleRate) {
  if (!(sampleRate > 0)) throw new RangeError(`kWeightingCoefficients: bad sample rate ${sampleRate}`);
  // Pre-filter: high shelf.
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  const pre = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  // RLB: high-pass.
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  const r0 = 1 + K / Q + K * K;
  const rlb = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / r0, (1 - K / Q + K * K) / r0] };
  return { pre, rlb };
}

/**
 * Loudness (LUFS) of a channel-summed mean square; null for silence or at/below the absolute gate.
 * @param {number} power
 * @returns {number|null}
 */
export function powerToLufs(power) {
  if (!(power > 0)) return null;
  const lufs = LOUDNESS_OFFSET + 10 * Math.log10(power);
  return lufs > LOUDNESS_ABSOLUTE_GATE ? lufs : null;
}

/** dB of a linear amplitude; null for silence. */
const toDb = (linear) => (linear > 0 ? 20 * Math.log10(linear) : null);

/** A gating histogram: count and exact power sum per 0.01 LU bin. */
class GateHistogram {
  constructor() {
    this.count = new Float64Array(LOUDNESS_HISTOGRAM.bins);
    this.power = new Float64Array(LOUDNESS_HISTOGRAM.bins);
    this.total = 0;
    this.totalPower = 0;
  }

  clear() {
    this.count.fill(0);
    this.power.fill(0);
    this.total = 0;
    this.totalPower = 0;
  }

  /** Index of the bin holding `lufs` (clamped to the range). */
  static bin(lufs) {
    const i = Math.floor((lufs - LOUDNESS_HISTOGRAM.min) / LOUDNESS_HISTOGRAM.binWidth);
    return i < 0 ? 0 : i >= LOUDNESS_HISTOGRAM.bins ? LOUDNESS_HISTOGRAM.bins - 1 : i;
  }

  /** The centre (LUFS) of bin `i`. */
  static centre(i) {
    return LOUDNESS_HISTOGRAM.min + (i + 0.5) * LOUDNESS_HISTOGRAM.binWidth;
  }

  add(power, lufs) {
    const i = GateHistogram.bin(lufs);
    this.count[i] += 1;
    this.power[i] += power;
    this.total += 1;
    this.totalPower += power;
  }

  /** The first bin above the relative gate `relativeLu` below the absolute-gated mean, or -1 if empty. */
  relativeGateBin(relativeLu) {
    if (!this.total) return -1;
    const mean = powerToLufs(this.totalPower / this.total);
    if (mean === null) return -1;
    const gate = mean + relativeLu;
    // Bins whose centre is above the gate pass.
    let first = GateHistogram.bin(gate);
    if (GateHistogram.centre(first) <= gate) first += 1;
    return first;
  }

  /** The gated mean power's loudness (Integrated), or null. */
  gatedLoudness(relativeLu) {
    const first = this.relativeGateBin(relativeLu);
    if (first < 0) return null;
    let n = 0;
    let p = 0;
    for (let i = first; i < LOUDNESS_HISTOGRAM.bins; i++) {
      n += this.count[i];
      p += this.power[i];
    }
    return n ? powerToLufs(p / n) : null;
  }

  /** P95 − P10 of the gated values (LRA, EBU Tech 3342), or null with fewer than 2 values. */
  range(relativeLu, low = 0.1, high = 0.95) {
    const first = this.relativeGateBin(relativeLu);
    if (first < 0) return null;
    let n = 0;
    for (let i = first; i < LOUDNESS_HISTOGRAM.bins; i++) n += this.count[i];
    if (n < 2) return null;
    // Rank of each percentile in the sorted values (libebur128's rounding).
    const lowRank = Math.floor((n - 1) * low + 0.5);
    const highRank = Math.floor((n - 1) * high + 0.5);
    let seen = 0;
    let lowValue = null;
    let highValue = null;
    for (let i = first; i < LOUDNESS_HISTOGRAM.bins && highValue === null; i++) {
      if (!this.count[i]) continue;
      seen += this.count[i];
      if (lowValue === null && seen > lowRank) lowValue = GateHistogram.centre(i);
      if (seen > highRank) highValue = GateHistogram.centre(i);
    }
    return highValue - lowValue;
  }
}

/**
 * @typedef {object} LoudnessSnapshot
 * @property {number|null} m - Momentary loudness, LUFS (null: silence)
 * @property {number|null} s - Short-term loudness, LUFS
 * @property {number|null} i - Integrated loudness since reset, LUFS
 * @property {number|null} lra - Loudness range, LU (null until 10 s measured)
 * @property {number|null} tpMax - Highest true peak since reset, dBTP
 * @property {number|null} tpBlock - Highest true peak over the last 100 ms, dBTP
 * @property {Array<number|null>} peakDb - Sample peak per channel [L, R] over the last 300 ms, dBFS
 * @property {Array<number|null>} rmsDb - RMS per channel [L, R] over the last 300 ms, dBFS
 * @property {{ truePeak: number, limiter: number, clip: number }} events - Over event counts since reset
 * @property {boolean} preLimiter - Whether the last block had a pre-limiter input (else `clip` watches the post-EQ input)
 * @property {number} measuredSeconds - Audio measured since reset, seconds
 */

/**
 * The loudness meter's state and DSP (see the module comment). Feed it blocks with `process`, read
 * `snapshot()`, clear the measurement with `reset()`.
 */
export class LoudnessMeterCore {
  /**
   * @param {{ sampleRate: number, channels?: number }} options - `channels` is always measured as 2
   *   (a mono input counts as L = R); the option is accepted for symmetry with the worklet.
   */
  constructor({ sampleRate, channels = 2 } = /** @type {any} */ ({})) {
    if (!(sampleRate > 0)) throw new RangeError(`LoudnessMeterCore: bad sample rate ${sampleRate}`);
    this.sampleRate = sampleRate;
    this.channels = 2;
    this.requestedChannels = channels;
    const { pre, rlb } = kWeightingCoefficients(sampleRate);
    // [b0, b1, b2, a1, a2] for each stage.
    this.preK = Float64Array.of(pre.b[0], pre.b[1], pre.b[2], pre.a[1], pre.a[2]);
    this.rlbK = Float64Array.of(rlb.b[0], rlb.b[1], rlb.b[2], rlb.a[1], rlb.a[2]);
    /** Biquad states per channel: [pre z1, pre z2, rlb z1, rlb z2]. */
    this.filterState = new Float64Array(4 * this.channels);
    /** True-peak FIR history per channel: 12 samples, doubled so a window is contiguous. */
    this.firHistory = new Float64Array(2 * FIR_TAPS * this.channels);
    this.firPos = 0;

    this.subBlockFrames = Math.max(1, Math.round(sampleRate * LOUDNESS_SUBBLOCK_SECONDS));
    this.chunkFrames = Math.max(1, Math.round(sampleRate * CHUNK_SECONDS));
    this.mergeFrames = Math.round(sampleRate * LOUDNESS_OVER_MERGE_SECONDS);

    this.subBlocks = new Float64Array(SUBBLOCK_RING);
    this.integrated = new GateHistogram();
    this.shortTerms = new GateHistogram();

    this.chunkPeak = new Float64Array(CHUNK_RING * this.channels);
    this.chunkSquares = new Float64Array(CHUNK_RING * this.channels);
    this.chunkTruePeak = new Float64Array(CHUNK_RING);
    this.chunkCount = new Float64Array(CHUNK_RING);

    this.reset();
  }

  /**
   * Clear the measurement: loudness windows, Integrated, LRA, true peak, peak/RMS, events and the
   * measured time. The K-weighting and true-peak filter states are kept (they are the signal's
   * continuity, not the measurement), so a reset during music gives no transient; the true peak
   * of the first 11 frames after it is their sample peak (the FIR still holds older samples).
   */
  reset() {
    this.frame = 0;
    this.subSum = 0;
    this.subCount = 0;
    this.subBlocks.fill(0);
    this.subPos = 0;
    this.subTotal = 0;
    this.integrated.clear();
    this.shortTerms.clear();
    this.truePeakMax = 0;
    this.chunkPeak.fill(0);
    this.chunkSquares.fill(0);
    this.chunkTruePeak.fill(0);
    this.chunkCount.fill(0);
    this.chunkPos = 0;
    this.preLimiter = false;
    /** @type {Record<string, { count: number, lastAt: number }>} */
    this.events = {};
    for (const reason of LOUDNESS_OVER_REASONS) this.events[reason] = { count: 0, lastAt: -Infinity };
  }

  /** @private Count an over sample of `reason` at absolute frame `at` (merging within 0.5 s). */
  over(reason, at) {
    const event = this.events[reason];
    if (at - event.lastAt >= this.mergeFrames) event.count += 1;
    event.lastAt = at;
  }

  /**
   * Measure one block.
   * @param {ArrayLike<ArrayLike<number>>|null|undefined} channels - The post-EQ input: 2 channel
   *   arrays (1: mono, counted as L = R; 0 or absent: silence).
   * @param {ArrayLike<ArrayLike<number>>|null} [preLimiter] - The pre-limiter input, or null/empty
   *   when absent (then the `clip` reason watches `channels`).
   * @param {number} [frameCount] - Frames in the block (needed only when both inputs are absent).
   */
  process(channels, preLimiter, frameCount) {
    const post = channels && channels.length ? channels : null;
    const pre = preLimiter && preLimiter.length ? preLimiter : null;
    const frames = frameCount ?? post?.[0]?.length ?? pre?.[0]?.length ?? 0;
    this.preLimiter = !!pre;
    if (!frames) return;

    const left = post ? post[0] : null;
    const right = post ? (post.length > 1 ? post[1] : post[0]) : null;
    const preLeft = pre ? pre[0] : null;
    const preRight = pre ? (pre.length > 1 ? pre[1] : pre[0]) : null;

    const pk = this.preK;
    const rk = this.rlbK;
    const st = this.filterState;
    const fir = this.firHistory;
    const h = FIR_FLAT;
    const twoTaps = 2 * FIR_TAPS;

    for (let n = 0; n < frames; n++) {
      const at = this.frame;
      this.firPos = this.firPos === 0 ? FIR_TAPS - 1 : this.firPos - 1;
      const pos = this.firPos;
      let truePeak = 0;
      let squares = 0;
      const slot = this.chunkPos;

      for (let c = 0; c < 2; c++) {
        const src = c === 0 ? left : right;
        const x = src ? src[n] || 0 : 0;

        // K-weighting: pre-filter then RLB, transposed direct form II.
        const s = 4 * c;
        const y1 = pk[0] * x + st[s];
        st[s] = pk[1] * x - pk[3] * y1 + st[s + 1];
        st[s + 1] = pk[2] * x - pk[4] * y1;
        const y2 = rk[0] * y1 + st[s + 2];
        st[s + 2] = rk[1] * y1 - rk[3] * y2 + st[s + 3];
        st[s + 3] = rk[2] * y1 - rk[4] * y2;
        squares += y2 * y2;

        // Sample peak and squares (300 ms window).
        const ax = x < 0 ? -x : x;
        const ci = c * CHUNK_RING + slot;
        if (ax > this.chunkPeak[ci]) this.chunkPeak[ci] = ax;
        this.chunkSquares[ci] += x * x;

        // True peak: 4 interpolated phases from the last 12 samples.
        const base = c * twoTaps + pos;
        fir[base] = x;
        fir[base + FIR_TAPS] = x;
        let tp = ax;
        // The history is kept across reset() (no step in the signal), but its first 11 frames after
        // a reset still hold samples from before it: those frames count their sample peak only.
        if (at >= FIR_TAPS - 1) {
          for (let k = 0; k < FIR_PHASES; k++) {
            let y = 0;
            const hk = k * FIR_TAPS;
            for (let j = 0; j < FIR_TAPS; j++) y += h[hk + j] * fir[base + j];
            if (y < 0) y = -y;
            if (y > tp) tp = y;
          }
        }
        if (tp > truePeak) truePeak = tp;

        // Clip: only while nothing limits the output (no pre-limiter input).
        if (!pre && ax >= CLIP_F32) this.over('clip', at);
      }

      if (pre) {
        const pl = preLeft[n] || 0;
        const pr = preRight[n] || 0;
        const al = pl < 0 ? -pl : pl;
        const ar = pr < 0 ? -pr : pr;
        if (al >= LIMITER_CEILING_F32 || ar >= LIMITER_CEILING_F32) this.over('limiter', at);
      }
      if (Math.fround(truePeak) > TRUE_PEAK_LIMIT_F32) this.over('truePeak', at);
      if (truePeak > this.truePeakMax) this.truePeakMax = truePeak;
      if (truePeak > this.chunkTruePeak[slot]) this.chunkTruePeak[slot] = truePeak;

      this.chunkCount[slot] += 1;
      if (this.chunkCount[slot] >= this.chunkFrames) this.nextChunk();

      this.subSum += squares;
      this.subCount += 1;
      if (this.subCount >= this.subBlockFrames) this.finishSubBlock();
      this.frame += 1;
    }

    for (let i = 0; i < st.length; i++) if (st[i] < DENORMAL && st[i] > -DENORMAL) st[i] = 0;
  }

  /** @private Start the next 10 ms chunk of the peak/RMS ring. */
  nextChunk() {
    this.chunkPos = (this.chunkPos + 1) % CHUNK_RING;
    const slot = this.chunkPos;
    this.chunkCount[slot] = 0;
    this.chunkTruePeak[slot] = 0;
    for (let c = 0; c < this.channels; c++) {
      this.chunkPeak[c * CHUNK_RING + slot] = 0;
      this.chunkSquares[c * CHUNK_RING + slot] = 0;
    }
  }

  /** @private Close a 100 ms sub-block: feed the gating block and the short-term value. */
  finishSubBlock() {
    const power = this.subSum / this.subCount;
    this.subSum = 0;
    this.subCount = 0;
    this.subBlocks[this.subPos] = power;
    this.subPos = (this.subPos + 1) % SUBBLOCK_RING;
    this.subTotal += 1;
    if (this.subTotal >= LOUDNESS_MOMENTARY_BLOCKS) {
      const gating = this.windowPower(LOUDNESS_MOMENTARY_BLOCKS);
      const lufs = powerToLufs(gating);
      if (lufs !== null) this.integrated.add(gating, lufs);
    }
    if (this.subTotal >= LOUDNESS_SHORT_TERM_BLOCKS) {
      const shortTerm = this.windowPower(LOUDNESS_SHORT_TERM_BLOCKS);
      const lufs = powerToLufs(shortTerm);
      if (lufs !== null) this.shortTerms.add(shortTerm, lufs);
    }
  }

  /** @private Mean power of the last `blocks` sub-blocks (fewer while the window fills); 0 if none. */
  windowPower(blocks) {
    const n = Math.min(blocks, this.subTotal);
    if (!n) return 0;
    let sum = 0;
    for (let k = 1; k <= n; k++) sum += this.subBlocks[(this.subPos - k + SUBBLOCK_RING) % SUBBLOCK_RING];
    return sum / n;
  }

  /** Momentary loudness, LUFS, or null. */
  momentary() {
    return powerToLufs(this.windowPower(LOUDNESS_MOMENTARY_BLOCKS));
  }

  /** Short-term loudness, LUFS, or null. */
  shortTerm() {
    return powerToLufs(this.windowPower(LOUDNESS_SHORT_TERM_BLOCKS));
  }

  /** Integrated loudness since reset, LUFS, or null. */
  integratedLoudness() {
    return this.integrated.gatedLoudness(LOUDNESS_RELATIVE_GATE);
  }

  /** Loudness range since reset, LU, or null (before 10 s measured, or too few gated values). */
  loudnessRange() {
    if (this.frame < LOUDNESS_LRA_MIN_SECONDS * this.sampleRate) return null;
    return this.shortTerms.range(LOUDNESS_LRA_RELATIVE_GATE);
  }

  /**
   * The readings now, as plain structured-cloneable data (see {@link LoudnessSnapshot}). Reading
   * changes nothing.
   * @returns {LoudnessSnapshot}
   */
  snapshot() {
    const peakDb = [];
    const rmsDb = [];
    let frames = 0;
    for (let k = 0; k < CHUNK_RING; k++) frames += this.chunkCount[k];
    for (let c = 0; c < this.channels; c++) {
      let peak = 0;
      let squares = 0;
      for (let k = 0; k < CHUNK_RING; k++) {
        const v = this.chunkPeak[c * CHUNK_RING + k];
        if (v > peak) peak = v;
        squares += this.chunkSquares[c * CHUNK_RING + k];
      }
      peakDb.push(toDb(peak));
      rmsDb.push(frames ? toDb(Math.sqrt(squares / frames)) : null);
    }
    let tpBlock = 0;
    for (let k = 0; k < TP_BLOCK_CHUNKS; k++) {
      const v = this.chunkTruePeak[(this.chunkPos - k + CHUNK_RING) % CHUNK_RING];
      if (v > tpBlock) tpBlock = v;
    }
    return {
      m: this.momentary(),
      s: this.shortTerm(),
      i: this.integratedLoudness(),
      lra: this.loudnessRange(),
      tpMax: toDb(this.truePeakMax),
      tpBlock: toDb(tpBlock),
      peakDb,
      rmsDb,
      events: {
        truePeak: this.events.truePeak.count,
        limiter: this.events.limiter.count,
        clip: this.events.clip.count,
      },
      preLimiter: this.preLimiter,
      measuredSeconds: this.frame / this.sampleRate,
    };
  }
}
