/**
 * beatRepeatLoader.mjs - loads the `beat-repeat-processor` module once per AudioContext (spec 032).
 *
 * The same mechanism as scratch/scratchWorklet.mjs: the processor source (beatRepeatWorklet.mjs
 * with beatRepeatCore.mjs inlined) is bundled into a `data:text/javascript;base64,…` URL at build
 * time by vite-plugin-bundle-audioworklet, so the Vite dev server and the Cloudflare build both
 * serve it with no separate asset.
 *
 * @license AGPL-3.0-or-later
 */

import beatRepeatProcessorUrl from './beatRepeatWorklet.mjs?audioworklet';

/** Name the processor registers under (kept here so the main thread never imports the worklet module). */
export const BEAT_REPEAT_PROCESSOR = 'beat-repeat-processor';

/** @type {WeakMap<BaseAudioContext, Promise<void>>} */
const loading = new WeakMap();

/**
 * Add the beat-repeat processor module to `audioContext`, once per context. A failed load is not
 * cached, so a later call retries.
 * @param {BaseAudioContext} audioContext
 * @returns {Promise<void>}
 */
export function loadBeatRepeatWorklet(audioContext) {
  if (!audioContext?.audioWorklet?.addModule) {
    return Promise.reject(new Error('AudioWorklet is not supported by this AudioContext'));
  }
  let promise = loading.get(audioContext);
  if (!promise) {
    promise = Promise.resolve()
      .then(() => audioContext.audioWorklet.addModule(beatRepeatProcessorUrl))
      .catch((err) => {
        loading.delete(audioContext);
        throw err;
      });
    loading.set(audioContext, promise);
  }
  return promise;
}
