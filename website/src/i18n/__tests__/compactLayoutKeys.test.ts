/**
 * @spec: 016-responsive-repl-layout (2.5 Languages, tech 2.7)
 * The labels of the compact layout (title bar, More menu, control bar, library drawer, compact EQ)
 * exist in all 9 locales and in CommonTranslations, and none silently falls back to English.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const I18N_DIR = resolve(process.cwd(), 'website/src/i18n');
const LANGUAGES = ['en', 'es', 'fr', 'ru', 'sr', 'he', 'ar', 'zh', 'ko'];

const KEYS = [
  'more',
  'library',
  'openLibrary',
  'closeLibrary',
  'settings',
  'recordAudio',
  'recordScreen',
  'stopRecording',
  'share',
  'preview',
  'playPreview',
  'stopPreview',
  'eqBand',
  'gain',
];

/** The same word in English and this language (a loanword, not an untranslated string). */
const SAME_AS_ENGLISH = new Set(['fr:gain']);

const readCommon = (lang: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(I18N_DIR, 'locales', lang, 'common.json'), 'utf8')) as Record<string, unknown>;

describe('compact layout labels', () => {
  const en = readCommon('en');

  it.each(LANGUAGES)('%s has every key as a non-empty string', (lang) => {
    const common = readCommon(lang);
    const bad = KEYS.filter((key) => typeof common[key] !== 'string' || (common[key] as string).trim() === '');
    expect(bad).toEqual([]);
  });

  it.each(LANGUAGES.filter((lang) => lang !== 'en'))('%s translates every key (no English fallback)', (lang) => {
    const common = readCommon(lang);
    const english = KEYS.filter((key) => common[key] === en[key] && !SAME_AS_ENGLISH.has(`${lang}:${key}`));
    expect(english).toEqual([]);
  });

  it('eqBand keeps the {{n}} placeholder everywhere', () => {
    const missing = LANGUAGES.filter((lang) => !String(readCommon(lang).eqBand).includes('{{n}}'));
    expect(missing).toEqual([]);
  });

  it('CommonTranslations declares every key', () => {
    const types = readFileSync(resolve(I18N_DIR, 'types.ts'), 'utf8');
    const body = types.match(/export interface CommonTranslations \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const missing = KEYS.filter((key) => !new RegExp(`^\\s*${key}: string;`, 'm').test(body));
    expect(missing).toEqual([]);
  });
});
