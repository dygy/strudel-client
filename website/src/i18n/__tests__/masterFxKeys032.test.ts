/**
 * @spec: 032-master-fx (§2.9 locales; tech §2.7 i18n)
 * The Master FX panel strings (`masterFx.*`) and MIDI row labels exist, non-empty, in all 9
 * settings.json files with the English placeholders; every language but English has its own words
 * (except the seconds unit some languages share); types.ts declares them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const I18N_DIR = resolve(process.cwd(), 'website/src/i18n');
const LANGUAGES = ['en', 'es', 'fr', 'ru', 'sr', 'he', 'ar', 'zh', 'ko'];
const FLAT_KEYS = [
  'midiGroupMasterFx',
  'midiTargetMasterFilter',
  'midiTargetMasterDelay',
  'midiTargetMasterReverb',
  'midiTargetMasterRepeat',
  'midiTargetMasterBrake',
  'midiTargetMasterRepeatLength',
];
const NESTED_KEYS = [
  'title',
  'description',
  'filter',
  'filterOff',
  'filterLowPass',
  'filterHighPass',
  'filterLp',
  'filterHp',
  'filterHint',
  'resonance',
  'delay',
  'delayTime',
  'delayFeedback',
  'level',
  'reverb',
  'reverbDecay',
  'repeat',
  'repeatLength',
  'brake',
  'brakeNote',
  'brakeLink',
  'holdHint',
  'holdLabel',
  'allOff',
  'cycle',
  'seconds',
];

/** The SI unit is the same in some languages ("{{value}} s"). */
const SAME_ALLOWED = new Set(['masterFx.seconds']);

type Strings = Record<string, unknown> & { masterFx: Record<string, string> };
const read = (lang: string): Strings =>
  JSON.parse(readFileSync(resolve(I18N_DIR, 'locales', lang, 'settings.json'), 'utf8')) as Strings;
const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();
const all = (strings: Strings): Array<[string, string]> => [
  ...FLAT_KEYS.map((key): [string, string] => [key, String(strings[key])]),
  ...NESTED_KEYS.map((key): [string, string] => [`masterFx.${key}`, strings.masterFx?.[key]]),
];

describe('spec 032: Master FX strings', () => {
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
    const block = types.slice(types.indexOf('masterFx: {'));
    for (const key of NESTED_KEYS) expect(block).toMatch(new RegExp(`\\b${key}: string;`));
  });
});
