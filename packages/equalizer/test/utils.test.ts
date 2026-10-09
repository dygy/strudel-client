/**
 * EQ display helpers (spec 015 §2.2): frequency labels and chart coordinates.
 */
import { describe, it, expect } from 'vitest';
import { formatFrequency, generateLogFrequencies, frequencyToX, gainToY } from '../utils';

describe('formatFrequency (spec 015 §2.2)', () => {
  it('labels 1000 Hz as "1k" and 16000 Hz as "16k"', () => {
    expect(formatFrequency(1000)).toBe('1k');
    expect(formatFrequency(16000)).toBe('16k');
  });

  it('labels 63 Hz as "63", with no "k" below 1000 Hz', () => {
    expect(formatFrequency(63)).toBe('63');
    expect(formatFrequency(999)).toBe('999');
  });
});

describe('EQ chart helpers', () => {
  it('generateLogFrequencies spans min to max on a log scale', () => {
    const f = generateLogFrequencies(20, 20000, 4);

    expect(Array.from(f).map((x) => Math.round(x))).toEqual([20, 200, 2000, 20000]);
  });

  it('frequencyToX maps 20 Hz to the left edge and 20 kHz to the right edge', () => {
    expect(frequencyToX(20, 300)).toBeCloseTo(0);
    expect(frequencyToX(20000, 300)).toBeCloseTo(300);
    expect(frequencyToX(632.46, 300)).toBeCloseTo(150, 0);
  });

  it('gainToY maps +12 dB to the top, −12 dB to the bottom and 0 dB to the middle', () => {
    expect(gainToY(12, 200)).toBe(0);
    expect(gainToY(-12, 200)).toBe(200);
    expect(gainToY(0, 200)).toBe(100);
  });
});
