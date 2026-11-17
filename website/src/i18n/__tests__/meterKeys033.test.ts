/**
 * @spec: 033-loudness-meter (§2.8 locales; tech §2.4 i18n)
 * The loudness meter strings (`meter.*`) and the EQ's Before EQ toggle exist, non-empty, in all 9
 * settings.json files with the English placeholders; every language but English has its own words
 * (except the few that are the same word in some languages); types.ts declares them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const I18N_DIR = resolve(process.cwd(), 'website/src/i18n');
const LANGUAGES = ['en', 'es', 'fr', 'ru', 'sr', 'he', 'ar', 'zh', 'ko'];
const FLAT_KEYS = ['eqSpectrumPre', 'eqSpectrumPreHint'];
const NESTED_KEYS = [
  'title',
  'description',
  'on',
  'offNote',
  'momentary',
  'shortTerm',
  'integrated',
  'truePeak',
  'range',
  'peakRms',
  'history',
  'historyLabel',
  'target',
  'targetStreaming',
  'targetBroadcast',
  'targetClub',
  'targetOff',
  'warnings',
  'warningLight',
  'warningNone',
  'warningTitle',
  'reasonCount',
  'reasonTruePeak',
  'reasonLimiter',
  'reasonClip',
  'reset',
  'resetHint',
  'open',
  'strip',
];

/** The same in some languages: "Streaming" and "Club" (es, fr), and the "{{reason}} ({{count}}×)" pattern. */
const SAME_ALLOWED = new Set(['meter.targetStreaming', 'meter.targetClub', 'meter.reasonCount']);

type Strings = Record<string, unknown> & { meter: Record<string, string> };
const read = (lang: string): Strings =>
  JSON.parse(readFileSync(resolve(I18N_DIR, 'locales', lang, 'settings.json'), 'utf8')) as Strings;
const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();
const all = (strings: Strings): Array<[string, string]> => [
  ...FLAT_KEYS.map((key): [string, string] => [key, String(strings[key])]),
  ...NESTED_KEYS.map((key): [string, string] => [`meter.${key}`, strings.meter?.[key]]),
];

describe('spec 033: loudness meter strings', () => {
  const en = Object.fromEntries(all(read('en')));

  it.each(LANGUAGES)('%s has every key, non-empty, with the English placeholders', (lang) => {
    for (const [key, value] of all(read(lang))) {
      expect(typeof value, `${lang}:${key}`).toBe('string');
      expect(value.trim(), `${lang}:${key}`).not.toBe('');
      expect(placeholders(value), `${lang}:${key}`).toEqual(placeholders(en[key]));
    }
  });

  it.each(LANGUAGES.filter((lang) => lang !== 'en'))('%s is translated, not English copied over', (lang) => {
    const copied = all(read(lang)).filter(([key, value]) => !SAME_ALLOWED.has(key) && value.trim() === en[key].trim());
    expect(copied.map(([key]) => key)).toEqual([]);
  });

  it('types.ts declares every key', () => {
    const types = readFileSync(resolve(I18N_DIR, 'types.ts'), 'utf8');
    for (const key of FLAT_KEYS) expect(types).toMatch(new RegExp(`\\b${key}: string;`));
    const block = types.slice(types.indexOf('meter: {'));
    for (const key of NESTED_KEYS) expect(block).toMatch(new RegExp(`\\b${key}: string;`));
  });
});
