/**
 * @spec: 021-eq-genre-presets-transparency (functional §2.3, tech §2.4)
 * In all 9 settings.json files: every genre preset has a name and a "why" sentence (≤ 120
 * characters), the four family labels, the six region words and the description templates exist,
 * and the subtitle counts 81 presets. Outside English, the families, regions, templates and the
 * "why" sentences are translated (genre names may stay as they are).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EQUALIZER_PRESETS } from '@strudel/equalizer';

const LOCALES_DIR = resolve(process.cwd(), 'website/src/i18n/locales');
const LANGUAGES = ['en', 'es', 'fr', 'ru', 'sr', 'he', 'ar', 'zh', 'ko'];

const cap = (key: string) => `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
const GENRES = Object.entries(EQUALIZER_PRESETS)
  .filter(([, p]) => p.group === 'genre')
  .map(([key]) => key);
const NAME_KEYS = GENRES.map((key) => `equalizerPreset${cap(key)}`);
const WHY_KEYS = GENRES.map((key) => `equalizerWhy${cap(key)}`);
const FAMILY_KEYS = ['BrazilianLatin', 'PhonkHipHop', 'Electronic', 'LiveOther'].map((f) => `equalizerFamily${f}`);
const REGION_KEYS = ['Sub', 'Bass', 'LowMid', 'Mid', 'Presence', 'Air'].map((r) => `equalizerRegion${r}`);
const TEMPLATE_KEYS = ['Title', 'Region', 'LowCut', 'HighCut', 'Output', 'Flat', 'Why'].map(
  (k) => `equalizerDescribe${k}`,
);
/** Same in a language as in English, legitimately: loanwords and the bare placeholder template. */
const MAY_MATCH_ENGLISH = new Set(['*:equalizerDescribeRegion', 'fr:equalizerRegionAir']);

const readSettings = (lang: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(LOCALES_DIR, lang, 'settings.json'), 'utf8')) as Record<string, unknown>;
const nonEmpty = (settings: Record<string, unknown>, key: string) =>
  typeof settings[key] === 'string' && (settings[key] as string).trim() !== '';

describe('EQ genre families and descriptions (spec 021)', () => {
  const en = readSettings('en');

  it('there are 59 genre presets to cover', () => {
    expect(GENRES).toHaveLength(59);
  });

  it.each(LANGUAGES)('%s names every genre preset and has a why for each', (lang) => {
    const settings = readSettings(lang);
    expect([...NAME_KEYS, ...WHY_KEYS].filter((key) => !nonEmpty(settings, key))).toEqual([]);
  });

  it.each(LANGUAGES)('%s keeps every why sentence to 120 characters', (lang) => {
    const settings = readSettings(lang);
    const long = WHY_KEYS.filter((key) => String(settings[key]).length > 120);
    expect(long).toEqual([]);
  });

  it.each(LANGUAGES)('%s has the family, region and description keys, with their placeholders', (lang) => {
    const settings = readSettings(lang);
    expect([...FAMILY_KEYS, ...REGION_KEYS, ...TEMPLATE_KEYS].filter((key) => !nonEmpty(settings, key))).toEqual([]);
    expect(String(settings.equalizerDescribeRegion)).toMatch(/\{\{region\}\}/);
    for (const key of [
      'equalizerDescribeRegion',
      'equalizerDescribeLowCut',
      'equalizerDescribeHighCut',
      'equalizerDescribeOutput',
    ]) {
      expect([key, String(settings[key])]).toEqual([key, expect.stringMatching(/\{\{value\}\}/)]);
    }
  });

  it.each(LANGUAGES)('%s subtitle counts 81 presets', (lang) => {
    const subtitle = String(readSettings(lang).equalizerSubtitle);
    expect(subtitle).toMatch(/81/);
    expect(subtitle).not.toMatch(/34/);
  });

  it.each(LANGUAGES.filter((lang) => lang !== 'en'))(
    '%s translates the families, regions, templates and why sentences',
    (lang) => {
      const settings = readSettings(lang);
      const english = [...FAMILY_KEYS, ...REGION_KEYS, ...TEMPLATE_KEYS, ...WHY_KEYS].filter(
        (key) =>
          settings[key] === en[key] && !MAY_MATCH_ENGLISH.has(`*:${key}`) && !MAY_MATCH_ENGLISH.has(`${lang}:${key}`),
      );
      expect(english).toEqual([]);
    },
  );

  it('the English why sentences describe their genre (spot checks against the values)', () => {
    expect(String(en.equalizerWhyAmapiano)).toMatch(/log drum/i);
    expect(String(en.equalizerWhyDriftPhonk)).toMatch(/808 sub and cowbell/);
    expect(String(en.equalizerWhyMetal)).toMatch(/scooped mids/i);
    expect(String(en.equalizerWhyMemphis)).toMatch(/high cut/i);
    expect(String(en.equalizerWhyUkGarage)).toMatch(/air band/i);
  });
});
