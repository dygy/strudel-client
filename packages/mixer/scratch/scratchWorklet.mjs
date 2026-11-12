/**
 * scratchWorklet.mjs - loads the `scratch-processor` module once per AudioContext (spec 019).
 *
 * The processor source (scratchProcessor.mjs with scratchDsp.mjs inlined) is bundled into a
 * `data:text/javascript;base64,…` URL at build time by vite-plugin-bundle-audioworklet, the
 * same mechanism superdough uses for its worklets.mjs.
 *
 * @license AGPL-3.0-or-later
 */

import scratchProcessorUrl from './scratchProcessor.mjs?audioworklet';

/** Name the processor registers under (kept here so the main thread never imports the worklet module). */
export const SCRATCH_PROCESSOR = 'scratch-processor';

/** @type {WeakMap<BaseAudioContext, Promise<void>>} */
const loading = new WeakMap();

/**
 * Add the scratch processor module to `audioContext`, once per context. A failed load is not
 * cached, so a later call retries.
 * @param {BaseAudioContext} audioContext
 * @returns {Promise<void>}
 */
export function loadScratchWorklet(audioContext) {
  if (!audioContext?.audioWorklet?.addModule) {
    return Promise.reject(new Error('AudioWorklet is not supported by this AudioContext'));
  }
  let promise = loading.get(audioContext);
  if (!promise) {
    promise = Promise.resolve()
      .then(() => audioContext.audioWorklet.addModule(scratchProcessorUrl))
      .catch((err) => {
        loading.delete(audioContext);
        throw err;
      });
    loading.set(audioContext, promise);
  }
  return promise;
}
