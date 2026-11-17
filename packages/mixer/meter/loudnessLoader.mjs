/**
 * loudnessLoader.mjs - loads the `loudness-meter-processor` module once per AudioContext (spec 033).
 *
 * The same mechanism as masterfx/beatRepeatLoader.mjs: the processor source (loudnessWorklet.mjs
 * with loudnessCore.mjs inlined) is bundled into a `data:text/javascript;base64,…` URL at build time
 * by vite-plugin-bundle-audioworklet, so the Vite dev server and the Cloudflare build both serve it
 * with no separate asset.
 *
 * @license AGPL-3.0-or-later
 */

import loudnessProcessorUrl from './loudnessWorklet.mjs?audioworklet';

/** Name the processor registers under (kept here so the main thread never imports the worklet module). */
export const LOUDNESS_PROCESSOR = 'loudness-meter-processor';

/** @type {WeakMap<BaseAudioContext, Promise<void>>} */
const loading = new WeakMap();

/**
 * Add the loudness meter processor module to `audioContext`, once per context. A failed load is
 * not cached, so a later call retries.
 * @param {BaseAudioContext} audioContext
 * @returns {Promise<void>}
 */
export function loadLoudnessWorklet(audioContext) {
  if (!audioContext?.audioWorklet?.addModule) {
    return Promise.reject(new Error('AudioWorklet is not supported by this AudioContext'));
  }
  let promise = loading.get(audioContext);
  if (!promise) {
    promise = Promise.resolve()
      .then(() => audioContext.audioWorklet.addModule(loudnessProcessorUrl))
      .catch((err) => {
        loading.delete(audioContext);
        throw err;
      });
    loading.set(audioContext, promise);
  }
  return promise;
}
