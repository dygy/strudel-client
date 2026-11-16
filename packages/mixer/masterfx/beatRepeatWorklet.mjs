/**
 * beatRepeatWorklet.mjs - the `beat-repeat-processor` AudioWorklet (spec 032 tech §2.2).
 *
 * Runs in the AudioWorkletGlobalScope: it may use only `AudioWorkletProcessor`,
 * `registerProcessor`, `sampleRate` and `currentFrame`, never the DOM or other browser globals. It
 * is bundled (with beatRepeatCore.mjs inlined) into a data: URL by vite-plugin-bundle-audioworklet;
 * see beatRepeatLoader.mjs for the loader. The DSP is the pure beatRepeatCore.mjs.
 *
 * The channel count is fixed when the node is made (`outputChannelCount: [n]`); a different count
 * needs a new node.
 *
 * Port messages (main thread → worklet), frames being absolute (`currentFrame`, i.e. context time ×
 * sampleRate):
 * - `{ type: 'roll', startFrame, lengthFrames }` — start (or restart) a roll
 * - `{ type: 'length', lengthFrames }` — the slice length from the next wrap
 * - `{ type: 'stop' }` — crossfade back to live
 * - `{ type: 'debug', id }` — test hook; answered with `{ type: 'debug', id, frame, active, looping, start, len }`
 *
 * @license AGPL-3.0-or-later
 */

import { createRollState, processBlock, rollActive, rollLength, rollStart, rollStop } from './beatRepeatCore.mjs';

/** The worklet processor: a thin message adapter around the roll core. */
class BeatRepeatProcessor extends AudioWorkletProcessor {
  /** @param {AudioWorkletNodeOptions} [options] */
  constructor(options) {
    super();
    const channels = options?.outputChannelCount?.[0] ?? options?.channelCount ?? 2;
    const ringSeconds = options?.processorOptions?.ringSeconds;
    this.state = createRollState({ channels, sampleRate, ...(ringSeconds ? { ringSeconds } : {}) });
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  /** @param {any} msg */
  handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'roll':
        rollStart(this.state, msg.startFrame, msg.lengthFrames);
        break;
      case 'length':
        rollLength(this.state, msg.lengthFrames);
        break;
      case 'stop':
        rollStop(this.state);
        break;
      case 'debug': {
        const v = this.state.voice;
        this.port.postMessage({
          type: 'debug',
          id: msg.id,
          frame: this.state.frame,
          active: rollActive(this.state),
          looping: !!v?.looping,
          start: v?.start ?? null,
          len: v?.len ?? null,
        });
        break;
      }
      default:
        break;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output && output.length) {
      const frame = globalThis.currentFrame;
      processBlock(this.state, inputs[0], output, typeof frame === 'number' ? frame : undefined);
    }
    return true;
  }
}

registerProcessor('beat-repeat-processor', BeatRepeatProcessor);
