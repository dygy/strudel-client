/**
 * @spec: 026-eq-listening-tools (functional §2.5, tech §2.5)
 * The listening-tools labels exist and are non-empty in all 9 settings.json files: A, B, the two
 * copy directions, Spectrum, Record as heard and their hints. Every language but English has its
 * own words for the sentences (the slot letters and the arrow may stay as they are).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES_DIR = resolve(process.cwd(), 'website/src/i18n/locales');
const LANGUAGES = ['en', 'es', 'fr', 'ru', 'sr', 'he', 'ar', 'zh', 'ko'];
const KEYS = [
  'equalizerSlotA',
  'equalizerSlotB',
  'equalizerCopyAtoB',
  'equalizerCopyBtoA',
  'equalizerSlotsHint',
  'equalizerSpectrum',
  'equalizerSpectrumHint',
  'recordPostEq',
  'recordPostEqHint',
];
const SENTENCES = ['equalizerSlotsHint', 'equalizerSpectrumHint', 'recordPostEq', 'recordPostEqHint'];

const readSettings = (lang: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(LOCALES_DIR, lang, 'settings.json'), 'utf8')) as Record<string, unknown>;

describe('EQ listening tools labels (spec 026)', () => {
  const en = readSettings('en');

  it.each(LANGUAGES)('%s has every key, non-empty', (lang) => {
    const settings = readSettings(lang);
    for (const key of KEYS) {
      expect([lang, key, typeof settings[key]]).toEqual([lang, key, 'string']);
      expect([lang, key, (settings[key] as string).trim().length > 0]).toEqual([lang, key, true]);
    }
  });

  it.each(LANGUAGES.filter((lang) => lang !== 'en'))('%s translates the sentences', (lang) => {
    const settings = readSettings(lang);
    for (const key of SENTENCES) expect([lang, key, settings[key] === en[key]]).toEqual([lang, key, false]);
  });

  it.each(LANGUAGES)('%s copy labels name the direction', (lang) => {
    const settings = readSettings(lang);
    expect(settings.equalizerCopyAtoB).toContain('A→B');
    expect(settings.equalizerCopyBtoA).toContain('B→A');
  });
});
