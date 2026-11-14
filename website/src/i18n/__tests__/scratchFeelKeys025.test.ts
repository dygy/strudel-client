/**
 * @spec: 025-scratch-feel-controls (2.3 Languages)
 * Snap and its four options, Brake, Spin-up, Reset and the hint exist in all 9 languages,
 * translated (not English copies).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES = ['ar', 'en', 'es', 'fr', 'he', 'ko', 'ru', 'sr', 'zh'];
const KEYS = [
  'scratchSnap',
  'scratchSnapOff',
  'scratchSnapHalf',
  'scratchSnapBeat',
  'scratchSnapBar',
  'scratchBrake',
  'scratchSpinUp',
  'scratchFeelReset',
  'scratchFeelHint',
];
const read = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(__dirname, `../locales/${locale}/settings.json`), 'utf8'));
const en = read('en');

describe('scratch feel labels', () => {
  it.each(LOCALES)('%s has the 9 spec 025 keys', (locale) => {
    const strings = read(locale);
    for (const key of KEYS) {
      expect(typeof strings[key], `${locale}.${key}`).toBe('string');
      expect(strings[key].trim().length).toBeGreaterThan(0);
      if (locale !== 'en') expect(strings[key], `${locale}.${key}`).not.toBe(en[key]);
    }
  });

  it('the English snap label is the grid choice, not 023’s "Snap to beat"', () => {
    expect(en.scratchSnap).toBe('Snap');
    expect(en.scratchSnapHalf).toContain('½');
  });
});
