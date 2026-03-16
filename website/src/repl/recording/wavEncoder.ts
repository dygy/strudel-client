/**
 * WAV encoder — converts an AudioBuffer to a PCM 16-bit stereo RIFF/WAVE Blob.
 */

/**
 * Encodes an AudioBuffer as a PCM 16-bit stereo WAV file.
 *
 * Produces a standard 44-byte RIFF/WAVE header followed by interleaved
 * little-endian int16 sample data for left and right channels.
 *
 * @param audioBuffer - A 2-channel AudioBuffer at any sample rate
 * @returns A Blob of type audio/wav
 */
export function encodeWAV(audioBuffer: AudioBuffer): Blob {
  const numChannels = 2;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;

  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;

  const dataSize = numSamples * numChannels * bytesPerSample;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // --- RIFF header ---
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // file size - 8
  writeString(view, 8, 'WAVE');

  // --- fmt sub-chunk ---
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // sub-chunk size (16 for PCM)
  view.setUint16(20, 1, true); // audio format: PCM = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true); // block align
  view.setUint16(34, bitsPerSample, true);

  // --- data sub-chunk ---
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // --- interleaved PCM samples ---
  let offset = headerSize;
  for (let i = 0; i < numSamples; i++) {
    view.setInt16(offset, floatToInt16(left[i]), true);
    offset += 2;
    view.setInt16(offset, floatToInt16(right[i]), true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/** Clamp a float32 sample (-1..1) to a signed 16-bit integer. */
function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

/** Write an ASCII string into a DataView at the given byte offset. */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
