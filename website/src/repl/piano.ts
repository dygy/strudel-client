import { Pattern, noteToMidi, valueToMidi } from '@strudel/core';

/**
 * Piano-specific pattern extensions for Strudel
 */

const maxPan = noteToMidi('C8');

/**
 * Calculates pan position based on width
 * @param pan - Pan value (0-1)
 * @param width - Width factor (0-1)
 * @returns Calculated pan position
 */
const panwidth = (pan: number, width: number): number => pan * width + (1 - width) / 2;

/**
 * Adds piano-specific processing to a pattern
 * - Sets clip to 1
 * - Uses 'piano' sound
 * - Sets release to 0.1
 * - Applies pitch-based panning
 */
(Pattern.prototype as any).piano = function (): any {
  return this.clip(1)
    .s('piano')
    .release(0.1)
    .fmap((value: any) => {
      const midi = valueToMidi(value);
      // Pan by pitch
      const pan = panwidth(Math.min(Math.round(midi) / maxPan, 1), 0.5);
      return { ...value, pan: (value.pan || 1) * pan };
    });
};