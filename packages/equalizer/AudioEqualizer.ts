import { EQUALIZER_PRESETS } from './presets.js';
import { BUTTERWORTH_Q_DB, type CutSettings } from './response.js';

/** Seconds; gain/Q changes glide with this time constant (~15 ms to 95 %). */
export const SMOOTHING_TIME_CONSTANT = 0.005;
/** Seconds; the on/off wet/dry crossfade time constant (~20 ms to 98 %). */
export const CROSSFADE_TIME_CONSTANT = 0.005;
/** Seconds; low/high cut frequency glide (sweeps follow smoothly, no zipper noise). */
export const CUT_TIME_CONSTANT = 0.01;
/**
 * Seconds; the low cut glides slower when its frequency goes down (the highpass opens). Opening a
 * 24 dB/oct highpass near 10–40 Hz quickly releases a sub-bass bump: measured in Chromium, 25 → 10 Hz
 * peaked +4.4 dB over both steady states at τ 10 ms and stayed under them at τ 100 ms. Closing (going
 * up) is clean at any speed, so it keeps CUT_TIME_CONSTANT.
 */
export const LOW_CUT_OPEN_TIME_CONSTANT = 0.1;
/**
 * Seconds; the output level glides slower when it goes up. A preset switch lowers a big sub boost
 * while raising the output; a low band's change lags by its group delay, so a fast output rise
 * swelled the bass (measured in Chromium, driftPhonk → trap: +2.6 dB in one 20 ms window at τ 5 ms,
 * +1.6 dB at τ 60 ms with no peak above either preset's steady state). Falling keeps the fast glide.
 */
export const OUTPUT_RISE_TIME_CONSTANT = 0.06;

/** Band gain range (dB): −24…+24 (spec 020; was ±12). */
export const EQ_GAIN_LIMIT = 24;
/** Band Q range. */
export const EQ_Q_RANGE = { min: 0.5, max: 4 } as const;
/** Low cut frequency range (Hz). */
export const LOW_CUT_RANGE = { min: 20, max: 1000 } as const;
/** High cut frequency range (Hz). */
export const HIGH_CUT_RANGE = { min: 1000, max: 20000 } as const;
/** Output level range (dB). */
export const OUTPUT_GAIN_RANGE = { min: -24, max: 6 } as const;
/**
 * Where the low cut's highpass stages rest while the cut is off: 10 Hz (−0.02 dB at 20 Hz, nothing
 * above). Not 0 Hz, although Web Audio defines a 0 Hz highpass as a pass-through: a highpass gliding
 * to or from ~0 Hz has its poles on z = 1 and was measured (Chromium) to throw a 9–16 dB transient.
 * The high cut rests at Nyquist, which is an exact pass-through and glides cleanly.
 */
export const LOW_CUT_OFF_FREQUENCY = 10;
/** The frequency a cut has before the user picks one (and what old saves load with). */
export const DEFAULT_LOW_CUT_FREQUENCY = 80;
export const DEFAULT_HIGH_CUT_FREQUENCY = 12000;

/**
 * The protection stage: a DynamicsCompressorNode used as a limiter, then a fixed trim that cancels
 * the compressor's automatic makeup gain (so a signal under the threshold passes at exactly 0 dB),
 * then a soft safety clipper for the attack overshoot (output peaks stay under 0 dBFS).
 */
export const LIMITER = {
  /**
   * dB. Owner decision (spec 020 review): just under 0 dBFS, so loud flat material (peaks at or under
   * −0.5 dBFS) passes the EQ unchanged while it is on, which it is by default. Was −1 dB.
   */
  threshold: -0.3,
  knee: 0,
  ratio: 20,
  attack: 0.002,
  release: 0.1,
  /**
   * The compressor's look-ahead (measured 6.0 ms at 44.1 and 48 kHz); the dry path is delayed to
   * match, so the EQ delays its output by this much, on and off alike. @strudel/midi's default
   * latency includes it (40 ms = 34 + 6). `.dough()` / the dsp worklet plays straight to the
   * destination, skips the EQ, and so is 6 ms early relative to superdough's sounds.
   */
  lookahead: 0.006,
} as const;
/**
 * The safety clipper is transparent up to CLIP_KNEE (−0.3 dBFS, the limiter threshold), then
 * saturates smoothly (tanh) towards CLIP_CEILING (−0.01 dBFS), so output peaks stay under 0 dBFS.
 * It covers inputs up to ±CLIP_INPUT_RANGE (+6 dBFS: the stage before it scales by 1/CLIP_INPUT_RANGE
 * and the curve scales back, both exact), so a limiter overshoot is rounded off, not hard-clipped.
 */
export const CLIP_KNEE = 0.966;
export const CLIP_CEILING = 0.999;
export const CLIP_INPUT_RANGE = 2;

/**
 * The compressor's automatic makeup gain (dB): Chromium/WebKit/Gecko multiply the output by
 * (1 / gain at 0 dBFS)^0.6. With knee 0 the gain at 0 dBFS is threshold·(1 − 1/ratio).
 */
export const LIMITER_MAKEUP_DB = 0.6 * -LIMITER.threshold * (1 - 1 / LIMITER.ratio);

/**
 * Band configuration interface
 */
interface BandConfig {
  frequency: number;
  type: BiquadFilterType;
  gain: number;
  Q: number;
}

/**
 * Band state interface
 */
interface Band {
  filter: BiquadFilterNode;
  config: BandConfig;
}

/** A low or high cut: on/off and its frequency (Hz). */
export type CutConfig = CutSettings;

/**
 * Equalizer state interface
 */
export interface EqualizerState {
  isEnabled: boolean;
  bands: BandConfig[];
  /** Absent in states from before spec 020: left as they are. */
  lowCut?: CutConfig;
  highCut?: CutConfig;
  outputGain?: number;
}

/**
 * Band update parameters
 */
export interface BandUpdate {
  gain?: number;
  Q?: number;
}

/** A cut update: either field may be left out. */
export interface CutUpdate {
  enabled?: boolean;
  frequency?: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const dbToGain = (db: number) => Math.pow(10, db / 20);
/**
 * The limiter stage's output level (linear): cancels the limiter's makeup gain, and scales into the
 * clipper's ±CLIP_INPUT_RANGE input (the curve scales back).
 */
const MAKEUP_TRIM = dbToGain(-LIMITER_MAKEUP_DB) / CLIP_INPUT_RANGE;
const channelCountOf = (channels: unknown) => Math.max(1, Math.min(32, Math.floor(Number(channels) || 2)));

/** One limiter stage: outputGain → entry … output (gain with the makeup trim) → clipper. */
interface LimiterStage {
  entry: AudioNode;
  output: GainNode;
  nodes: AudioNode[];
  limiters: DynamicsCompressorNode[];
}

/**
 * WaveShaper curve over inputs ±CLIP_INPUT_RANGE (fed scaled by 1/CLIP_INPUT_RANGE): identity up to
 * CLIP_KNEE, then a smooth (tanh) approach to CLIP_CEILING.
 */
function safetyClipperCurve(size = 8193): Float32Array {
  const curve = new Float32Array(size);
  const room = CLIP_CEILING - CLIP_KNEE;
  for (let i = 0; i < size; i++) {
    const x = ((i / (size - 1)) * 2 - 1) * CLIP_INPUT_RANGE;
    const magnitude = Math.abs(x);
    const y = magnitude <= CLIP_KNEE ? magnitude : CLIP_KNEE + room * Math.tanh((magnitude - CLIP_KNEE) / room);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/**
 * AudioEqualizer - a channel strip: 10-band parametric EQ, low/high cut, output level, limiter.
 *
 *   input ─┬─ dryDelay ─ dryGain ─────────────────────────────────────────────────────┬─ output
 *          └─ lowCut(2× highpass) → 10 bands → highCut(2× lowpass) → outputGain
 *               → limiter → makeup trim → safety clipper → wetGain ──────────────────┘
 *
 * On/off crossfades wetGain and dryGain (equal gain, coherent: the dry path is delayed by the
 * limiter's look-ahead, so the two do not comb). Off is a true bypass. Every setting is always
 * stored but applied only while the EQ is on; while off the wet chain rests at flat. Every change
 * glides (setTargetAtTime); nothing jumps. All nodes keep the default 'max' channel count mode;
 * the compressor cannot (it is clamped to 2 channels), so with more than 2 channels each stereo
 * pair gets its own limiter.
 */
export class AudioEqualizer {
  private audioContext: AudioContext;
  private isEnabled: boolean;
  private bands: Band[];
  private inputNode: GainNode | null;
  private outputNode: GainNode | null;
  private bandConfig: BandConfig[];
  private lowCutFilters: BiquadFilterNode[] = [];
  private highCutFilters: BiquadFilterNode[] = [];
  private outputGainNode: GainNode | null = null;
  private limiters: DynamicsCompressorNode[] = [];
  /** The limiter stage now heard (rebuilt by setChannelCount), and its channel count. */
  private limiterStage: LimiterStage | null = null;
  private channels = 2;
  private clipper: WaveShaperNode | null = null;
  private wetGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  /** Every node this EQ created, for destroy(). */
  private nodes: AudioNode[] = [];
  private lowCut: CutConfig = { enabled: false, frequency: DEFAULT_LOW_CUT_FREQUENCY };
  private highCut: CutConfig = { enabled: false, frequency: DEFAULT_HIGH_CUT_FREQUENCY };
  private outputGainDb = 0;
  /** Where the low cut's stages were last sent (to pick the opening or closing glide). */
  private lowCutTarget = LOW_CUT_OFF_FREQUENCY;
  /** The output gain (linear) last glided to (to pick the rise or fall glide). */
  private outputGainTarget = 1;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
    this.isEnabled = true;
    this.bands = [];
    this.inputNode = null;
    this.outputNode = null;

    // Default 10-band configuration
    this.bandConfig = [
      { frequency: 31, type: 'lowshelf', gain: 0, Q: 1.0 },
      { frequency: 62, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 125, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 250, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 500, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 1000, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 2000, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 4000, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 8000, type: 'peaking', gain: 0, Q: 1.0 },
      { frequency: 16000, type: 'highshelf', gain: 0, Q: 1.0 },
    ];

    this.initialize();
  }

  /** Nyquist: a lowpass there passes everything (the high cut's "off" position). */
  private get nyquist(): number {
    return (this.audioContext.sampleRate || 44100) / 2;
  }

  private track<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  /**
   * Initialize the graph. Initial values are written directly: nothing is playing through the
   * nodes yet, so there is nothing to click.
   */
  private initialize(): void {
    const ac = this.audioContext;
    this.inputNode = this.track(ac.createGain());
    this.outputNode = this.track(ac.createGain());

    // Low cut: two highpass stages resting at 10 Hz (off).
    this.lowCutFilters = BUTTERWORTH_Q_DB.map((q) => {
      const f = this.track(ac.createBiquadFilter());
      f.type = 'highpass';
      f.frequency.value = LOW_CUT_OFF_FREQUENCY;
      f.Q.value = q;
      return f;
    });

    for (const config of this.bandConfig) {
      const filter = this.track(ac.createBiquadFilter());
      filter.type = config.type;
      filter.frequency.value = config.frequency;
      filter.gain.value = config.gain;
      filter.Q.value = config.Q;
      this.bands.push({ filter, config: { ...config } });
    }

    // High cut: two lowpass stages at Nyquist, a pass-through (off).
    this.highCutFilters = BUTTERWORTH_Q_DB.map((q) => {
      const f = this.track(ac.createBiquadFilter());
      f.type = 'lowpass';
      f.frequency.value = this.nyquist;
      f.Q.value = q;
      return f;
    });

    this.outputGainNode = this.track(ac.createGain());
    this.outputGainNode.gain.value = 1;

    const wetChain: AudioNode[] = [
      this.inputNode,
      ...this.lowCutFilters,
      ...this.bands.map((b) => b.filter),
      ...this.highCutFilters,
      this.outputGainNode,
    ];
    for (let i = 1; i < wetChain.length; i++) wetChain[i - 1].connect(wetChain[i]);

    const clipper = this.track(ac.createWaveShaper());
    clipper.curve = safetyClipperCurve();
    clipper.oversample = 'none';
    this.clipper = clipper;
    this.channels = channelCountOf(ac.destination?.channelCount);
    this.limiterStage = this.buildLimiterStage(this.channels, MAKEUP_TRIM);
    this.wetGain = this.track(ac.createGain());
    this.wetGain.gain.value = 1;
    clipper.connect(this.wetGain);
    this.wetGain.connect(this.outputNode);

    // Dry (bypass) path, aligned with the wet path's look-ahead so the crossfade does not comb.
    const dryDelay = this.track(ac.createDelay(0.05));
    dryDelay.delayTime.value = LIMITER.lookahead;
    this.dryGain = this.track(ac.createGain());
    this.dryGain.gain.value = 0;
    this.inputNode.connect(dryDelay);
    dryDelay.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);
  }

  private createLimiter(nodes: AudioNode[]): DynamicsCompressorNode {
    const limiter = this.audioContext.createDynamicsCompressor();
    nodes.push(limiter);
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    return limiter;
  }

  /**
   * Build a limiter stage for `channels` between outputGain and the clipper: one limiter for stereo;
   * for more channels (a multichannel output), split into stereo pairs, limit each pair and merge
   * back, so nothing is downmixed. The stage ends in a gain that carries the makeup trim (and is the
   * crossfade point when the stage is rebuilt), starting at `level`.
   */
  private buildLimiterStage(channels: number, level: number): LimiterStage {
    const ac = this.audioContext;
    const nodes: AudioNode[] = [];
    const limiters: DynamicsCompressorNode[] = [];
    const output = ac.createGain();
    output.gain.value = level;
    let entry: AudioNode;
    if (channels <= 2) {
      const limiter = this.createLimiter(nodes);
      limiters.push(limiter);
      limiter.connect(output);
      entry = limiter;
    } else {
      const splitter = ac.createChannelSplitter(channels);
      const merger = ac.createChannelMerger(channels);
      nodes.push(splitter, merger);
      for (let first = 0; first < channels; first += 2) {
        const width = Math.min(2, channels - first);
        const pairIn = ac.createChannelMerger(width);
        const limiter = this.createLimiter(nodes);
        limiters.push(limiter);
        const pairOut = ac.createChannelSplitter(width);
        nodes.push(pairIn, pairOut);
        for (let c = 0; c < width; c++) splitter.connect(pairIn, first + c, c);
        pairIn.connect(limiter);
        limiter.connect(pairOut);
        for (let c = 0; c < width; c++) pairOut.connect(merger, c, first + c);
      }
      merger.connect(output);
      entry = splitter;
    }
    nodes.push(output);
    nodes.forEach((n) => this.track(n));
    this.outputGainNode!.connect(entry);
    output.connect(this.clipper!);
    this.limiters.push(...limiters);
    return { entry, output, nodes, limiters };
  }

  /** Disconnect a stage that is no longer heard and forget its nodes. */
  private dropLimiterStage(stage: LimiterStage): void {
    try {
      this.outputGainNode?.disconnect(stage.entry);
    } catch {
      // already disconnected (destroy)
    }
    stage.nodes.forEach((n) => n.disconnect());
    this.nodes = this.nodes.filter((n) => !stage.nodes.includes(n));
    this.limiters = this.limiters.filter((l) => !stage.limiters.includes(l));
  }

  /**
   * Size the limiter stage for the output's channel count (1–32), so a multichannel output is
   * limited per stereo pair and nothing is downmixed. Call it when the output's channel count
   * changes (mainEqualizer does, through superdough's output reset). A change rebuilds the stage
   * click-free: the new one runs in parallel and the two crossfade, then the old one is removed.
   * @param channels - The channel count of the signal the EQ carries (the destination's)
   */
  setChannelCount(channels: number): void {
    if (!Number.isFinite(channels) || !this.limiterStage) return;
    const next = channelCountOf(channels);
    if (next === this.channels) return;
    this.channels = next;
    const old = this.limiterStage;
    const running = this.audioContext.state === 'running';
    const stage = this.buildLimiterStage(next, running ? 0 : MAKEUP_TRIM);
    this.limiterStage = stage;
    if (!running) {
      this.dropLimiterStage(old);
      return;
    }
    // Same signal, same look-ahead: an equal-gain crossfade, then drop the old stage once silent.
    this.glide(old.output.gain, 0, CROSSFADE_TIME_CONSTANT);
    this.glide(stage.output.gain, MAKEUP_TRIM, CROSSFADE_TIME_CONSTANT);
    setTimeout(
      () => {
        if (this.nodes.includes(old.output)) this.dropLimiterStage(old);
      },
      CROSSFADE_TIME_CONSTANT * 20 * 1000,
    );
  }

  /** The channel count the limiter stage is built for. */
  getChannelCount(): number {
    return this.channels;
  }

  /**
   * Move a parameter to `value` without a click: an exponential approach starting now
   * (~95 % there after 3 time constants).
   */
  private glide(param: AudioParam, value: number, timeConstant = SMOOTHING_TIME_CONSTANT): void {
    param.setTargetAtTime(value, this.audioContext.currentTime, timeConstant);
  }

  /** Apply the stored cuts (or their off position while the EQ is off). */
  private applyCuts(): void {
    const low = this.isEnabled && this.lowCut.enabled ? this.lowCut.frequency : LOW_CUT_OFF_FREQUENCY;
    const high = this.isEnabled && this.highCut.enabled ? this.highCut.frequency : this.nyquist;
    const lowTimeConstant = low < this.lowCutTarget ? LOW_CUT_OPEN_TIME_CONSTANT : CUT_TIME_CONSTANT;
    this.lowCutTarget = low;
    this.lowCutFilters.forEach((f) => this.glide(f.frequency, low, lowTimeConstant));
    this.highCutFilters.forEach((f) => this.glide(f.frequency, high, CUT_TIME_CONSTANT));
  }

  private applyOutputGain(): void {
    if (!this.outputGainNode) return;
    const target = dbToGain(this.isEnabled ? this.outputGainDb : 0);
    const rising = target > this.outputGainTarget;
    this.outputGainTarget = target;
    this.glide(this.outputGainNode.gain, target, rising ? OUTPUT_RISE_TIME_CONSTANT : SMOOTHING_TIME_CONSTANT);
  }

  /**
   * Connect audio source to equalizer input
   */
  getInput(): GainNode {
    if (!this.inputNode) {
      throw new Error('Equalizer not initialized');
    }
    return this.inputNode;
  }

  /**
   * Get equalizer output for connection to next node
   */
  getOutput(): GainNode {
    if (!this.outputNode) {
      throw new Error('Equalizer not initialized');
    }
    return this.outputNode;
  }

  /**
   * Enable or disable the equalizer. Off crossfades to the dry path (a true bypass: no bands,
   * cuts, output level or limiter) and lets the wet chain rest at flat; on brings the stored
   * settings back and crossfades to the wet path. Settings are remembered either way.
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;

    // Glide every band back to its stored gain, or to 0 dB (flat) while off.
    this.bands.forEach((band) => {
      this.glide(band.filter.gain, enabled ? band.config.gain : 0);
    });
    this.applyCuts();
    this.applyOutputGain();
    // Equal-gain crossfade (the same time constant on both, so wet + dry stays 1).
    if (this.wetGain) this.glide(this.wetGain.gain, enabled ? 1 : 0, CROSSFADE_TIME_CONSTANT);
    if (this.dryGain) this.glide(this.dryGain.gain, enabled ? 0 : 1, CROSSFADE_TIME_CONSTANT);
  }

  /**
   * Get current equalizer state
   */
  getState(): EqualizerState {
    return {
      isEnabled: this.isEnabled,
      bands: this.bands.map((b) => ({ ...b.config })),
      lowCut: { ...this.lowCut },
      highCut: { ...this.highCut },
      outputGain: this.outputGainDb,
    };
  }

  /**
   * Restore equalizer state (fields that are absent are left as they are).
   */
  setState(state: EqualizerState): void {
    if (state.isEnabled !== undefined) {
      this.setEnabled(state.isEnabled);
    }
    if (state.bands) {
      state.bands.forEach((bandState, index) => {
        this.setBand(index, bandState);
      });
    }
    if (state.lowCut) this.setLowCut(state.lowCut);
    if (state.highCut) this.setHighCut(state.highCut);
    if (state.outputGain !== undefined) this.setOutputGain(state.outputGain);
  }

  /**
   * Update a specific band's parameters. Gain is clamped to ±24 dB and Q to 0.5–4; non-finite
   * values are ignored with a warning. Stored always, heard only while the EQ is on.
   */
  setBand(index: number, { gain, Q }: BandUpdate): void {
    if (index < 0 || index >= this.bands.length) return;

    const band = this.bands[index];

    // Ignore non-finite values (damaged settings, bad input): an AudioParam rejects them
    // and Math.max/min would turn them into NaN instead of clamping. Warn, so a caller that
    // forgets to parse a number (e.g. passes an input's string value) is noticed.
    if (gain !== undefined && !Number.isFinite(gain)) {
      console.warn(`[Equalizer] Ignoring non-numeric gain for band ${index}:`, gain);
    }
    if (Q !== undefined && !Number.isFinite(Q)) {
      console.warn(`[Equalizer] Ignoring non-numeric Q for band ${index}:`, Q);
    }

    if (gain !== undefined && Number.isFinite(gain)) {
      const clampedGain = clamp(gain, -EQ_GAIN_LIMIT, EQ_GAIN_LIMIT);
      band.config.gain = clampedGain;
      // While the EQ is off every filter stays at 0 dB (pass-through). The new
      // value is only remembered and is applied by setEnabled(true).
      if (this.isEnabled) {
        this.glide(band.filter.gain, clampedGain);
      }
    }

    if (Q !== undefined && Number.isFinite(Q)) {
      const clampedQ = clamp(Q, EQ_Q_RANGE.min, EQ_Q_RANGE.max);
      this.glide(band.filter.Q, clampedQ);
      band.config.Q = clampedQ;
    }
  }

  private updateCut(which: 'low' | 'high', { enabled, frequency }: CutUpdate): void {
    const cut = which === 'low' ? this.lowCut : this.highCut;
    const range = which === 'low' ? LOW_CUT_RANGE : HIGH_CUT_RANGE;
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      console.warn(`[Equalizer] Ignoring non-boolean ${which} cut on/off:`, enabled);
    } else if (enabled !== undefined) {
      cut.enabled = enabled;
    }
    if (frequency !== undefined && !Number.isFinite(frequency)) {
      console.warn(`[Equalizer] Ignoring non-numeric ${which} cut frequency:`, frequency);
    } else if (frequency !== undefined) {
      cut.frequency = clamp(frequency, range.min, range.max);
    }
    this.applyCuts();
  }

  /**
   * Set the low cut (a 24 dB/oct Butterworth high-pass). The frequency is clamped to 20–1000 Hz;
   * non-finite values are ignored with a warning. Stored always, heard only while the EQ is on;
   * the frequency glides, so a sweep is smooth.
   * @param update - `enabled` turns the cut on/off, `frequency` sets its corner (Hz)
   */
  setLowCut(update: CutUpdate): void {
    this.updateCut('low', update);
  }

  /**
   * Set the high cut (a 24 dB/oct Butterworth low-pass). The frequency is clamped to 1000–20000 Hz;
   * non-finite values are ignored with a warning. Stored always, heard only while the EQ is on;
   * the frequency glides, so a sweep is smooth.
   * @param update - `enabled` turns the cut on/off, `frequency` sets its corner (Hz)
   */
  setHighCut(update: CutUpdate): void {
    this.updateCut('high', update);
  }

  /**
   * Set the output level after the EQ, in dB, clamped to −24…+6. A non-finite value is ignored
   * with a warning. Stored always, heard only while the EQ is on; it glides.
   * @param db - Output level (dB)
   */
  setOutputGain(db: number): void {
    if (!Number.isFinite(db)) {
      console.warn('[Equalizer] Ignoring non-numeric output gain:', db);
      return;
    }
    this.outputGainDb = clamp(db, OUTPUT_GAIN_RANGE.min, OUTPUT_GAIN_RANGE.max);
    this.applyOutputGain();
  }

  /**
   * How much the limiter is turning the sound down right now, in dB (0 or negative; the strongest
   * of the limiters when there are several). 0 while the EQ is off (the limiter is not heard).
   */
  getLimiterReduction(): number {
    if (!this.isEnabled) return 0;
    let reduction = 0;
    for (const limiter of this.limiters) {
      const r = Number((limiter as { reduction: unknown }).reduction);
      if (Number.isFinite(r)) reduction = Math.min(reduction, r);
    }
    return reduction;
  }

  /**
   * Reset to flat: every band at 0 dB (Q 1), both cuts off, output 0 dB.
   */
  reset(): void {
    this.bands.forEach((_band, index) => {
      this.setBand(index, { gain: 0, Q: 1.0 });
    });
    this.setLowCut({ enabled: false });
    this.setHighCut({ enabled: false });
    this.setOutputGain(0);
  }

  /**
   * Apply a preset: its bands, cuts and output level. A preset without cuts (every listening
   * profile) turns both cuts off, keeping their frequencies, and sets the output to 0 dB.
   */
  applyPreset(preset: string): void {
    const presetConfig = EQUALIZER_PRESETS[preset];
    if (!presetConfig) {
      console.warn(`Unknown preset: ${preset}`);
      return;
    }

    presetConfig.gains.forEach((gain, index) => {
      this.setBand(index, { gain });
    });
    this.setLowCut(
      presetConfig.lowCut != null ? { enabled: true, frequency: presetConfig.lowCut } : { enabled: false },
    );
    this.setHighCut(
      presetConfig.highCut != null ? { enabled: true, frequency: presetConfig.highCut } : { enabled: false },
    );
    this.setOutputGain(presetConfig.outputGain ?? 0);
  }

  /**
   * Get frequency response data for visualization: the dB response of the cuts, the bands and
   * the output level, as the filters are now, for the given frequencies.
   */
  getFrequencyResponse(frequencies: Float32Array): Float32Array {
    const magResponse = new Float32Array(frequencies.length);
    magResponse.fill(1.0);

    const filters = [...this.lowCutFilters, ...this.bands.map((b) => b.filter), ...this.highCutFilters];
    filters.forEach((filter) => {
      const mag = new Float32Array(frequencies.length);
      const phase = new Float32Array(frequencies.length);
      filter.getFrequencyResponse(frequencies, mag, phase);
      for (let i = 0; i < frequencies.length; i++) {
        magResponse[i] *= mag[i];
      }
    });

    const output = this.outputGainNode?.gain.value ?? 1;
    const dbResponse = new Float32Array(frequencies.length);
    for (let i = 0; i < frequencies.length; i++) {
      dbResponse[i] = 20 * Math.log10(Math.max(magResponse[i] * output, 1e-12));
    }

    return dbResponse;
  }

  /**
   * Clean up resources: disconnect every node this EQ created.
   */
  destroy(): void {
    this.nodes.forEach((node) => node.disconnect());
    this.nodes = [];
    this.bands = [];
    this.lowCutFilters = [];
    this.highCutFilters = [];
    this.limiters = [];
  }
}
