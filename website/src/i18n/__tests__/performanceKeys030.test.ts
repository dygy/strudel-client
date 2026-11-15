/**
 * @spec: 030-performance-mode (functional §2.6: 9 languages; tech §2.8)
 * The performance view's ten labels exist and are non-empty in all 9 settings.json files, and every
 * language but English has its own words, and types.ts declares them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const I18N_DIR = resolve(process.cwd(), 'website/src/i18n');
const LANGUAGES = ['en', 'es', 'fr', 'ru', 'sr', 'he', 'ar', 'zh', 'ko'];
const KEYS = [
  'performMode',
  'performModeDescription',
  'performExit',
  'performSetTime',
  'performTrackTime',
  'performResetClock',
  'performLevel',
  'performClip',
  'performBiggerCode',
  'performSmallerCode',
];

const read = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(I18N_DIR, 'locales', lang, 'settings.json'), 'utf8'));

describe('spec 030: performance view strings', () => {
  const en = read('en');

  it.each(LANGUAGES)('%s has all ten, non-empty', (lang) => {
    const strings = read(lang);
    for (const key of KEYS) {
      expect(typeof strings[key], `${lang}:${key}`).toBe('string');
      expect(strings[key].trim(), `${lang}:${key}`).not.toBe('');
    }
  });

  it.each(LANGUAGES.filter((lang) => lang !== 'en'))('%s is translated, not English copied over', (lang) => {
    const strings = read(lang);
    const copied = KEYS.filter((key) => strings[key].trim() === en[key].trim());
    expect(copied).toEqual([]);
  });

  it('types.ts declares every key', () => {
    const types = readFileSync(resolve(I18N_DIR, 'types.ts'), 'utf8');
    for (const key of KEYS) expect(types).toMatch(new RegExp(`\\b${key}: string;`));
  });
});
