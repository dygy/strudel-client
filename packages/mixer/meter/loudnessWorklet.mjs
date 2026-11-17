/**
 * loudnessWorklet.mjs - the `loudness-meter-processor` AudioWorklet (spec 033 tech §2.1).
 *
 * Runs in the AudioWorkletGlobalScope: it may use only `AudioWorkletProcessor`,
 * `registerProcessor` and `sampleRate`, never the DOM or other browser globals. It is bundled (with
 * loudnessCore.mjs inlined) into a data: URL by vite-plugin-bundle-audioworklet; see
 * loudnessLoader.mjs for the loader. The DSP is the pure loudnessCore.mjs.
 *
 * Two inputs, both 2 channels (`channelCountMode: 'explicit'`, speaker up/down-mix), no outputs:
 * - input 0: the post-EQ signal (what the speakers volume receives);
 * - input 1: the EQ limiter's input (connected only while the EQ is on).
 * An input with no channels (not connected, or nothing actively feeding it) is silence; an absent
 * input 1 means the `clip` reason watches input 0.
 *
 * `process` returns true until `dispose`, so the node keeps measuring while installed although it
 * feeds nothing (an AudioWorkletNode with no outputs is pulled by the rendering thread).
 *
 * Port messages:
 * - worklet → main: `{ type: 'snapshot', snapshot }` every 100 ms of audio (from `sampleRate`);
 * - main → worklet: `{ type: 'reset' }` clears the measurement; `{ type: 'dispose' }` stops it
 *   (`process` then returns false and the node can be collected).
 *
 * @license AGPL-3.0-or-later
 */

import { LoudnessMeterCore, LOUDNESS_SUBBLOCK_SECONDS } from './loudnessCore.mjs';

/** Frames of a render quantum when neither input says (both absent). */
const QUANTUM = 128;

/** The worklet processor: a thin adapter around the loudness core. */
class LoudnessMeterProcessor extends AudioWorkletProcessor {
  /** @param {AudioWorkletNodeOptions} [options] */
  constructor(options) {
    super(options);
    this.core = new LoudnessMeterCore({ sampleRate, channels: 2 });
    this.interval = Math.max(1, Math.round(sampleRate * LOUDNESS_SUBBLOCK_SECONDS));
    this.sinceSnapshot = 0;
    this.disposed = false;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  /** @param {any} msg */
  handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'reset') {
      this.core.reset();
      this.sinceSnapshot = 0;
    } else if (msg.type === 'dispose') {
      this.disposed = true;
      this.port.onmessage = null;
    }
  }

  process(inputs) {
    if (this.disposed) return false;
    const post = inputs[0] && inputs[0].length ? inputs[0] : null;
    const pre = inputs[1] && inputs[1].length ? inputs[1] : null;
    const frames = (post && post[0].length) || (pre && pre[0].length) || QUANTUM;
    this.core.process(post, pre, frames);
    this.sinceSnapshot += frames;
    if (this.sinceSnapshot >= this.interval) {
      this.sinceSnapshot -= this.interval;
      this.port.postMessage({ type: 'snapshot', snapshot: this.core.snapshot() });
    }
    return true;
  }
}

registerProcessor('loudness-meter-processor', LoudnessMeterProcessor);
