/**
 * @spec: 020-eq-strong-control (functional §2.4 AC 5, tech §2.5, tasks 5.2)
 * Every new EQ label exists and is non-empty in all 9 settings.json files: the 12 genre preset
 * names, the cut / output / limiting / group labels, and the range and subtitle updated for ±24 dB
 * and 34 presets. Every preset the panel lists resolves to a key in every locale (the panel builds
 * the key as `equalizerPreset<Key>`), so no preset shows a raw key in any language.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EQUALIZER_PRESETS } from '@strudel/equalizer';

const LOCALES_DIR = resolve(process.cwd(), 'website/src/i18n/locales');
const LANGUAGES = ['en', 'es', 'fr', 'ru', 'sr', 'he', 'ar', 'zh', 'ko'];

const GENRE_KEYS = [
  'equalizerPresetBrazilianFunk',
  'equalizerPresetAutomotivo',
  'equalizerPresetMontagem',
  'equalizerPresetFunkAgressivo',
  'equalizerPresetMandelao',
  'equalizerPresetPhonk',
  'equalizerPresetDriftPhonk',
  'equalizerPresetElectro',
  'equalizerPresetTechno',
  'equalizerPresetDrumAndBass',
  'equalizerPresetDubstep',
  'equalizerPresetTrap',
];
const CONTROL_KEYS = [
  'equalizerLowCut',
  'equalizerHighCut',
  'equalizerCutOff',
  'equalizerOutputLevel',
  'equalizerLimiting',
  'equalizerGroupGenres',
  'equalizerGroupProfiles',
];
const UPDATED_KEYS = ['equalizerRange', 'equalizerSubtitle'];
const NEW_KEYS = [...GENRE_KEYS, ...CONTROL_KEYS, ...UPDATED_KEYS];

/** Labels a language may leave as in English: genre names (spec §2.4) and loanwords. */
const MAY_STAY_ENGLISH = new Set([...GENRE_KEYS, 'fr:equalizerGroupGenres']);

const readSettings = (lang: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(LOCALES_DIR, lang, 'settings.json'), 'utf8')) as Record<string, unknown>;

const presetKey = (key: string) => `equalizerPreset${key.charAt(0).toUpperCase()}${key.slice(1)}`;

describe('EQ strong control labels (spec 020)', () => {
  const en = readSettings('en');

  it.each(LANGUAGES)('%s has every new EQ key as a non-empty string', (lang) => {
    const settings = readSettings(lang);
    const bad = NEW_KEYS.filter((key) => typeof settings[key] !== 'string' || (settings[key] as string).trim() === '');
    expect(bad).toEqual([]);
  });

  it.each(LANGUAGES)('%s names every preset the panel lists (genres and profiles)', (lang) => {
    const settings = readSettings(lang);
    const missing = Object.keys(EQUALIZER_PRESETS)
      .map(presetKey)
      .filter((key) => typeof settings[key] !== 'string' || (settings[key] as string).trim() === '');
    expect(missing).toEqual([]);
  });

  it.each(LANGUAGES)('%s shows the range as ±24 dB and the subtitle counts 34 presets', (lang) => {
    const settings = readSettings(lang);
    const range = String(settings.equalizerRange);
    expect(range).toMatch(/-\s?24/);
    expect(range).toMatch(/\+\s?24/);
    expect(range).not.toMatch(/12/);
    expect(String(settings.equalizerSubtitle)).toMatch(/34/);
    expect(String(settings.equalizerSubtitle)).not.toMatch(/22/);
  });

  it.each(LANGUAGES.filter((lang) => lang !== 'en'))(
    '%s translates the control labels (only genre names may stay English)',
    (lang) => {
      const settings = readSettings(lang);
      const english = [...CONTROL_KEYS, ...UPDATED_KEYS].filter(
        (key) => settings[key] === en[key] && !MAY_STAY_ENGLISH.has(key) && !MAY_STAY_ENGLISH.has(`${lang}:${key}`),
      );
      expect(english).toEqual([]);
    },
  );

  it('the key list matches the presets: exactly the 12 genre presets have genre keys', () => {
    const genres = Object.entries(EQUALIZER_PRESETS)
      .filter(([, preset]) => preset.group === 'genre')
      .map(([key]) => presetKey(key))
      .sort();
    expect(genres).toEqual([...GENRE_KEYS].sort());
  });
});
