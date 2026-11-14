/**
 * scratchProcessor.mjs - the `scratch-processor` AudioWorklet (spec 019, tech §2.3).
 *
 * Runs in the AudioWorkletGlobalScope: it may use only `AudioWorkletProcessor`,
 * `registerProcessor` and `sampleRate`, never the DOM or other browser globals. It is bundled
 * (with scratchDsp.mjs inlined) into a data: URL by vite-plugin-bundle-audioworklet; see
 * scratchWorklet.mjs for the loader.
 *
 * Port messages (main thread → worklet):
 * - `{ type: 'grab' }`
 * - `{ type: 'move', delta }` — delta in seconds of audio, negative = backwards
 * - `{ type: 'motor', rate }` — × normal speed, 0 stops
 * - `{ type: 'release', id, beatSeconds, spinUpSeconds? }` — spec 023: spin up; snap the lag to
 *   `beatSeconds` (0 = off). Spec 025: plan with `spinUpSeconds` (default: the latest `feel`)
 * - `{ type: 'feel', brakeSeconds, spinUpSeconds }` — spec 025: the brake for the next grab and
 *   the spin-up for the next release; a running brake or spin-up keeps its length
 * - `{ type: 'handOver', id, at, shiftAt }` — spec 023: hand over at context time `at` (s); the
 *   shifted live input starts at `shiftAt` (default `at`)
 * - `{ type: 'abort' }` — spec 023: back to live now (stop, a cancelled release)
 * - `{ type: 'debug', id }` — test hook; answered with
 *   `{ type: 'debug', id, mix, grabbed, pos, phase, lag, rate }`
 *
 * Events (worklet → main thread), one of each per release at most:
 * - `{ type: 'plan', id, targetSeconds, upSeconds, fromRate, bumpSeconds, bumpDepth }` — at the
 *   release (from the message handler, not from process()): the spin-up the worklet will run
 * - `{ type: 'lagSettled', id, lagSeconds }` — the record runs at rate 1, `lagSeconds` behind live
 * - `{ type: 'idle', id }` — back to live (bit-exact pass-through)
 *
 * @license AGPL-3.0-or-later
 */

import { ScratchDsp } from './scratchDsp.mjs';

/** The worklet processor: a thin message adapter around ScratchDsp. */
class ScratchProcessor extends AudioWorkletProcessor {
  /** @param {AudioWorkletNodeOptions} [options] */
  constructor(options) {
    super();
    const channels = options?.outputChannelCount?.[0] ?? options?.channelCount ?? 2;
    const seconds = options?.processorOptions?.bufferSeconds;
    this.dsp = new ScratchDsp(sampleRate, channels, seconds);
    /** currentFrame − DSP clock, for converting context times to DSP samples (null until known). */
    this.frameOffset = null;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  /** @param {any} msg */
  handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'grab':
        this.dsp.grab();
        break;
      case 'move':
        this.dsp.moveBy(msg.delta);
        break;
      case 'motor':
        this.dsp.setMotor(msg.rate);
        break;
      case 'release': {
        const wasHeld = this.dsp.grabbed;
        this.dsp.release({ id: msg.id, beatSeconds: msg.beatSeconds, spinUpSeconds: msg.spinUpSeconds });
        // Spec 023 review 2: the release's plan, once, so the platter follows the same curve.
        if (wasHeld && this.dsp.phase === 'spinUp') {
          const d = this.dsp;
          this.port.postMessage({
            type: 'plan',
            id: d.releaseId,
            targetSeconds: d.planTarget,
            upSeconds: d.planUp,
            fromRate: d.planFrom,
            bumpSeconds: d.planBumpSeconds,
            bumpDepth: d.planDepth,
            // Context time the spin-up started (the plan runs from it), when the clock is known.
            startTime: this.frameOffset === null ? undefined : (d.n + this.frameOffset) / d.sampleRate,
          });
        }
        break;
      }
      case 'handOver':
        this.dsp.handOver(
          msg.id,
          this.sampleAt(msg.at),
          Number.isFinite(msg.shiftAt) ? this.sampleAt(msg.shiftAt) : undefined,
        );
        break;
      case 'abort':
        this.dsp.abort();
        break;
      case 'feel':
        this.dsp.setFeel({ brakeSeconds: msg.brakeSeconds, spinUpSeconds: msg.spinUpSeconds });
        break;
      case 'debug':
        this.port.postMessage({
          type: 'debug',
          id: msg.id,
          mix: this.dsp.mix,
          grabbed: this.dsp.grabbed,
          pos: this.dsp.posSeconds,
          phase: this.dsp.phase,
          lag: this.dsp.lagSeconds,
          rate: this.dsp.rate,
        });
        break;
      default:
        break;
    }
  }

  /**
   * The DSP sample at context time `at` (seconds). The worklet scope's `currentFrame` ties the
   * DSP's clock to the context's; without it (tests), the hand-over starts now.
   * @param {number} at
   */
  sampleAt(at) {
    if (!Number.isFinite(at) || this.frameOffset === null) return this.dsp.n;
    return Math.round(at * this.dsp.sampleRate) - this.frameOffset;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const frame = globalThis.currentFrame;
    if (typeof frame === 'number') this.frameOffset = frame - this.dsp.n;
    if (output && output.length) this.dsp.process(inputs[0], output, output[0].length);
    const event = this.dsp.takeEvent();
    if (event === 'lagSettled') {
      this.port.postMessage({ type: 'lagSettled', id: this.dsp.eventId, lagSeconds: this.dsp.eventLagSeconds });
    } else if (event === 'idle') {
      this.port.postMessage({ type: 'idle', id: this.dsp.eventId });
    }
    return true;
  }
}

registerProcessor('scratch-processor', ScratchProcessor);
