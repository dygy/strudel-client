/**
 * MP3 encoding via a Web Worker backed by lamejs.
 *
 * Requirements: 5.2, 5.4
 */

/** Cached result of lamejs availability check. `null` means not yet resolved. */
let mp3AvailableCache: boolean | null = null;

// Eagerly probe for lamejs at module load time so `isMP3Available()` can return synchronously.
(async () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await import('lamejs' as any);
    mp3AvailableCache = true;
  } catch {
    mp3AvailableCache = false;
  }
})();

/**
 * Check whether lamejs can be loaded (MP3 encoding is available).
 * Returns `true` if the eager probe succeeded, `false` otherwise.
 * If the probe hasn't settled yet, returns `false` (conservative default).
 */
export function isMP3Available(): boolean {
  return mp3AvailableCache === true;
}

/**
 * Encode an AudioBuffer to MP3 via the mp3Worker Web Worker.
 *
 * @param audioBuffer - Decoded audio (must have at least 1 channel).
 * @param bitrate     - MP3 bitrate in kbps (default 192).
 * @returns A Blob of type `audio/mp3`.
 */
export function encodeMP3(audioBuffer: AudioBuffer, bitrate = 192): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(new URL('./mp3Worker.ts', import.meta.url), { type: 'module' });

    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;

    worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data;
      if (type === 'complete') {
        resolve(e.data.blob as Blob);
      } else if (type === 'error') {
        reject(new Error(e.data.message as string));
      }
      worker.terminate();
    };

    worker.onerror = (err) => {
      reject(new Error(err.message ?? 'MP3 worker error'));
      worker.terminate();
    };

    worker.postMessage(
      { left, right, sampleRate: audioBuffer.sampleRate, bitrate },
      [left.buffer, right.buffer],
    );
  });
}
