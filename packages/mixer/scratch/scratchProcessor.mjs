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
 * - `{ type: 'release' }`
 * - `{ type: 'debug', id }` — test hook; answered with `{ type: 'debug', id, mix, grabbed, pos }`
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
      case 'release':
        this.dsp.release();
        break;
      case 'debug':
        this.port.postMessage({
          type: 'debug',
          id: msg.id,
          mix: this.dsp.mix,
          grabbed: this.dsp.grabbed,
          pos: this.dsp.posSeconds,
        });
        break;
      default:
        break;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output && output.length) this.dsp.process(inputs[0], output, output[0].length);
    return true;
  }
}

registerProcessor('scratch-processor', ScratchProcessor);
