/**
 * Generate logarithmically spaced frequencies
 * @param {number} min - Minimum frequency (Hz)
 * @param {number} max - Maximum frequency (Hz)
 * @param {number} count - Number of frequency points
 * @returns {Float32Array} Array of frequencies
 */
export function generateLogFrequencies(min, max, count) {
  const frequencies = new Float32Array(count);
  const minLog = Math.log10(min);
  const maxLog = Math.log10(max);
  const step = (maxLog - minLog) / (count - 1);
  
  for (let i = 0; i < count; i++) {
    frequencies[i] = Math.pow(10, minLog + (step * i));
  }
  
  return frequencies;
}

/**
 * Convert frequency to X coordinate (logarithmic scale)
 * @param {number} freq - Frequency in Hz
 * @param {number} width - Canvas width
 * @returns {number} X coordinate
 */
export function frequencyToX(freq, width) {
  // Logarithmic scale: 20 Hz to 20 kHz
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  const freqLog = Math.log10(freq);
  return ((freqLog - minLog) / (maxLog - minLog)) * width;
}

/**
 * Convert gain to Y coordinate (linear scale)
 * @param {number} gain - Gain in dB
 * @param {number} height - Canvas height
 * @returns {number} Y coordinate
 */
export function gainToY(gain, height) {
  // -12 dB to +12 dB
  const normalized = (gain + 12) / 24; // 0 to 1
  return height - (normalized * height);
}

/**
 * Format frequency for display
 * @param {number} freq - Frequency in Hz
 * @returns {string} Formatted frequency string
 */
export function formatFrequency(freq) {
  if (freq >= 1000) {
    return `${freq / 1000}k`;
  }
  return `${freq}`;
}
