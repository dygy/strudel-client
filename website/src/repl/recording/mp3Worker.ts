/**
 * Web Worker that encodes stereo Float32Array audio data to MP3 via lamejs.
 *
 * Expected message format:
 *   { left: Float32Array, right: Float32Array, sampleRate: number, bitrate: number }
 *
 * Posts back:
 *   { type: 'complete', blob: Blob } on success
 *   { type: 'error', message: string } on failure
 */

/** Max samples per encode call — lamejs processes in frames of 1152 samples. */
const SAMPLES_PER_FRAME = 1152;

/** Clamp a float32 sample (-1..1) to a signed 16-bit integer. */
function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

/** Convert a Float32Array of samples to Int16Array for lamejs. */
function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    int16[i] = floatToInt16(float32[i]);
  }
  return int16;
}

self.onmessage = async (e: MessageEvent) => {
  const { left, right, sampleRate, bitrate = 192 } = e.data;

  try {
    // Dynamic import — lamejs is CJS, Vite handles the conversion for workers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lamejs = await import('lamejs' as any);
    const Mp3Encoder = lamejs.Mp3Encoder ?? lamejs.default?.Mp3Encoder;

    if (!Mp3Encoder) {
      self.postMessage({ type: 'error', message: 'lamejs Mp3Encoder not found' });
      return;
    }

    const encoder = new Mp3Encoder(2, sampleRate, bitrate);

    const leftInt16 = float32ToInt16(left);
    const rightInt16 = float32ToInt16(right);

    const mp3Chunks: Int8Array[] = [];
    const totalSamples = leftInt16.length;

    for (let i = 0; i < totalSamples; i += SAMPLES_PER_FRAME) {
      const leftChunk = leftInt16.subarray(i, i + SAMPLES_PER_FRAME);
      const rightChunk = rightInt16.subarray(i, i + SAMPLES_PER_FRAME);
      const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
      if (mp3buf.length > 0) {
        mp3Chunks.push(new Int8Array(mp3buf));
      }
    }

    // Flush remaining data
    const flushBuf = encoder.flush();
    if (flushBuf.length > 0) {
      mp3Chunks.push(new Int8Array(flushBuf));
    }

    const blob = new Blob(mp3Chunks, { type: 'audio/mp3' });
    self.postMessage({ type: 'complete', blob });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'MP3 encoding failed';
    self.postMessage({ type: 'error', message });
  }
};
