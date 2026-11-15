/**
 * The performance view's level meter (spec 030 functional §2.4, tech §2.6): a passive tap on the main
 * output as heard on the speakers (the main EQ's final output, the same point Record as heard uses; or
 * superdough's destinationGain while there is no EQ), plus the pure ballistics the display draws.
 *
 * Graph, only while the meter is open:
 *
 *   source ──┬──▶ (the speakers' edge, untouched)
 *            └──▶ upmix Gain(1, 2 ch speakers) ──▶ ChannelSplitter(2) ──▶ AnalyserNode (left)
 *                                                                  └─▶ AnalyserNode (right)
 *
 * The upmix node is a unity GainNode fixed at 2 channels with 'speakers' interpretation, so a mono
 * source shows in both bars (a ChannelSplitter's own channelInterpretation is locked to 'discrete',
 * and assigning it throws an InvalidStateError). Its gain is never changed: it is not on the speakers'
 * path. The analysers connect onward to nothing, so the tap is inaudible and needs no ramp. The preview
 * engine is a separate AudioContext and never reaches it. `close()` removes exactly the source → upmix
 * edge and every edge of the nodes the tap made.
 */
import { getAudioContext, getSuperdoughAudioController } from '@strudel/webaudio';
import { getMainEqualizerOutputTap, subscribeMainEqualizer } from '../mainEqualizer';

/** One read of the tap. Silence reads `-Infinity`. Index 0 is left, 1 is right. */
export interface MeterReading {
  /** Sample peak per channel, dBFS. */
  peakDb: [number, number];
  /** RMS per channel, dBFS. */
  rmsDb: [number, number];
  /** Whether any sample of either channel reached OVER_DBFS (|sample| ≥ OVER_LINEAR). */
  over: boolean;
}

/** An open meter tap: read it once per frame; close it when the meter goes away. */
export interface LevelMeterTap {
  /** The current window (fftSize samples) of each channel. Silence while there is no source. */
  read(): MeterReading;
  /** Disconnect everything the tap made and stop following the main EQ. Idempotent. */
  close(): void;
}

/** What the display draws, from meterBallistics. dB values below METER_FLOOR_DB read `-Infinity`. */
export interface MeterDisplay {
  /** The bars: the current peak per channel. */
  peakDb: [number, number];
  /** The peak markers: held METER_PEAK_HOLD_MS, then falling METER_PEAK_FALL_DB_PER_S. */
  holdDb: [number, number];
  /** How long each marker has been at or above its last peak, ms. */
  holdAgeMs: [number, number];
  /** The clip light: on until METER_CLIP_LATCH_MS after the last `over`. */
  clip: boolean;
  /** Time since the last `over`, ms (`Infinity` if there has been none). */
  clipAgeMs: number;
}

/** The clip threshold, dBFS: the EQ limiter's ceiling (spec 020). */
export const OVER_DBFS = -0.3;
/** OVER_DBFS as a linear sample magnitude (about 0.966). */
export const OVER_LINEAR = 10 ** (OVER_DBFS / 20);
/**
 * OVER_LINEAR at the samples' precision: analysers hand out float32 samples, and a sample at exactly
 * −0.3 dBFS rounds to just under the double-precision OVER_LINEAR, which would miss it.
 */
const OVER_SAMPLE = Math.fround(OVER_LINEAR);
/** The meter's floor, dB: anything quieter is drawn as an empty bar. */
export const METER_FLOOR_DB = -60;
/** How long a peak marker holds before it falls, ms. */
export const METER_PEAK_HOLD_MS = 1500;
/** How fast a peak marker falls after its hold, dB per second. */
export const METER_PEAK_FALL_DB_PER_S = 20;
/** How long the clip light stays on after the last `over`, ms. */
export const METER_CLIP_LATCH_MS = 2000;
/** The analysers' window, samples (about 43 ms at 48 kHz). */
export const METER_FFT_SIZE = 2048;

const SILENCE: MeterReading = { peakDb: [-Infinity, -Infinity], rmsDb: [-Infinity, -Infinity], over: false };

function silence(): MeterReading {
  return { peakDb: [...SILENCE.peakDb], rmsDb: [...SILENCE.rmsDb], over: false };
}

function toDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

/** Where the meter's sound comes from (injectable for tests). */
export interface MeterSourceDeps {
  /** The main EQ's final output (getMainEqualizerOutputTap by default). */
  eqTap?: () => AudioNode | null;
  /** superdough's destinationGain, or null before audio has started. */
  destinationGain?: () => AudioNode | null;
  /** A clock in ms for the re-resolve throttle (performance.now by default). */
  now?: () => number;
}

/** How often a following meter re-checks its source in read(), ms (about 4 Hz). */
export const METER_RESOLVE_INTERVAL_MS = 250;

/**
 * superdough's destinationGain, without creating superdough's controller early: only once the main
 * AudioContext is running (audio has started) is the controller read. Creating it before initAudio
 * would size its merger for the wrong output device (see mainEqualizer.ts).
 */
function defaultDestinationGain(): AudioNode | null {
  try {
    const ac = getAudioContext() as BaseAudioContext | undefined;
    if (!ac || ac.state !== 'running') return null;
    return (getSuperdoughAudioController()?.output?.destinationGain as AudioNode | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * The node the meter listens to: the main EQ's output (what the speakers get), else superdough's
 * destinationGain (audio started, no EQ), else null (audio not started: the meter reads silence).
 * A node on another AudioContext than `audioContext` (when given) is skipped: it can't be connected.
 * @param audioContext - The context the meter's nodes will live on (optional check)
 * @param deps - Overrides for the two candidates (tests)
 */
export function resolveMeterSource(
  audioContext?: BaseAudioContext | null,
  deps: MeterSourceDeps = {},
): AudioNode | null {
  const sameContext = (node: AudioNode | null | undefined): node is AudioNode =>
    !!node && (!audioContext || !node.context || node.context === audioContext);
  const eqTap = (deps.eqTap ?? getMainEqualizerOutputTap)();
  if (sameContext(eqTap)) return eqTap;
  const destinationGain = (deps.destinationGain ?? defaultDestinationGain)();
  if (sameContext(destinationGain)) return destinationGain;
  return null;
}

/**
 * Open the meter's passive tap on `source` (see the module comment for the graph). Without a source,
 * it resolves one itself (resolveMeterSource) and follows the main EQ: when the EQ appears, is
 * re-created or goes away (subscribeMainEqualizer), the tap moves to the new source. While there is
 * no source, `read()` returns silence. `read()` also re-resolves the source every
 * METER_RESOLVE_INTERVAL_MS, because superdough's resetGlobalEffects() replaces destinationGain without
 * any event: without the EQ, the tap would otherwise stay on the old, silent node.
 * @param audioContext - The main AudioContext (the meter's nodes live on it)
 * @param source - The node to meter; omit (or null) to follow the main output
 * @param deps - Source overrides when following the main output (tests)
 */
export function openLevelMeter(
  audioContext: BaseAudioContext,
  source?: AudioNode | null,
  deps: MeterSourceDeps = {},
): LevelMeterTap {
  const follow = source == null;
  // Mono upmixes into both bars; stereo passes as it is; more channels (multichannel orbits) mix down by
  // the speakers rules where they exist, else keep the first two. A splitter can't do this itself.
  const upmix = audioContext.createGain();
  upmix.channelCount = 2;
  upmix.channelCountMode = 'explicit';
  upmix.channelInterpretation = 'speakers';
  const splitter = audioContext.createChannelSplitter(2);
  upmix.connect(splitter);
  const analysers = [audioContext.createAnalyser(), audioContext.createAnalyser()];
  analysers.forEach((analyser, channel) => {
    analyser.fftSize = METER_FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    splitter.connect(analyser, channel, 0);
  });
  const buffer = new Float32Array(METER_FFT_SIZE);

  let open = true;
  let current: AudioNode | null = null;

  const attach = (node: AudioNode | null) => {
    if (node === current) return;
    if (current) {
      try {
        current.disconnect(upmix);
      } catch {
        // already disconnected (e.g. the old EQ was torn down)
      }
    }
    current = node;
    if (current) current.connect(upmix);
  };

  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  let resolvedAt = now();
  attach(follow ? resolveMeterSource(audioContext, deps) : source);
  const unsubscribe = follow
    ? subscribeMainEqualizer(() => open && attach(resolveMeterSource(audioContext, deps)))
    : null;

  return {
    read() {
      if (!open) return silence();
      if (follow) {
        const t = now();
        if (!current || t - resolvedAt >= METER_RESOLVE_INTERVAL_MS) {
          resolvedAt = t;
          attach(resolveMeterSource(audioContext, deps));
        }
      }
      if (!current) return silence();
      const reading = silence();
      analysers.forEach((analyser, channel) => {
        analyser.getFloatTimeDomainData(buffer);
        let peak = 0;
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const x = buffer[i];
          const magnitude = Math.abs(x);
          if (magnitude > peak) peak = magnitude;
          sum += x * x;
        }
        reading.peakDb[channel] = toDb(peak);
        reading.rmsDb[channel] = toDb(Math.sqrt(sum / buffer.length));
        if (peak >= OVER_SAMPLE) reading.over = true;
      });
      return reading;
    },
    close() {
      if (!open) return;
      open = false;
      unsubscribe?.();
      attach(null);
      upmix.disconnect();
      splitter.disconnect();
      analysers.forEach((analyser) => analyser.disconnect());
    },
  };
}

function floored(db: number): number {
  return Number.isFinite(db) && db >= METER_FLOOR_DB ? db : -Infinity;
}

/**
 * The meter's ballistics, pure: the bars follow the reading's peaks; each peak marker holds
 * METER_PEAK_HOLD_MS, then falls METER_PEAK_FALL_DB_PER_S until a louder peak catches it; the clip light
 * stays on until METER_CLIP_LATCH_MS after the last `over`. Anything below METER_FLOOR_DB is `-Infinity`.
 * @param prev - The previous display (null on the first frame)
 * @param reading - This frame's read() of the tap
 * @param dtMs - The time since the previous frame, ms (negative or non-finite counts as 0)
 */
export function meterBallistics(prev: MeterDisplay | null, reading: MeterReading, dtMs: number): MeterDisplay {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const peakDb: [number, number] = [floored(reading.peakDb[0]), floored(reading.peakDb[1])];
  const holdDb: [number, number] = [-Infinity, -Infinity];
  const holdAgeMs: [number, number] = [0, 0];
  for (const channel of [0, 1] as const) {
    const peak = peakDb[channel];
    if (!prev) {
      holdDb[channel] = peak;
      continue;
    }
    const prevAge = prev.holdAgeMs[channel];
    const age = prevAge + dt;
    const fallingMs = Math.max(0, age - Math.max(prevAge, METER_PEAK_HOLD_MS));
    const held = floored(prev.holdDb[channel] - (METER_PEAK_FALL_DB_PER_S * fallingMs) / 1000);
    if (peak >= held) {
      holdDb[channel] = peak;
      holdAgeMs[channel] = 0;
    } else {
      holdDb[channel] = held;
      holdAgeMs[channel] = age;
    }
  }
  if (reading.over) return { peakDb, holdDb, holdAgeMs, clip: true, clipAgeMs: 0 };
  const clipAgeMs = (prev ? prev.clipAgeMs : Infinity) + dt;
  return { peakDb, holdDb, holdAgeMs, clip: !!prev?.clip && clipAgeMs < METER_CLIP_LATCH_MS, clipAgeMs };
}
