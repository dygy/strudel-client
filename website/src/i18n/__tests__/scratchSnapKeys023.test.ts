/**
 * @spec: 023-vinyl-scratch-realism (2.5 Languages)
 * "Snap to beat" and its hint exist in all 9 languages, translated (not English copies).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES = ['ar', 'en', 'es', 'fr', 'he', 'ko', 'ru', 'sr', 'zh'];
const read = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(__dirname, `../locales/${locale}/settings.json`), 'utf8'));
const en = read('en');

describe('Snap to beat labels', () => {
  it.each(LOCALES)('%s has scratchSnap and scratchSnapHint', (locale) => {
    const strings = read(locale);
    for (const key of ['scratchSnap', 'scratchSnapHint']) {
      expect(typeof strings[key]).toBe('string');
      expect(strings[key].trim().length).toBeGreaterThan(0);
      if (locale !== 'en') expect(strings[key]).not.toBe(en[key]);
    }
  });
});
