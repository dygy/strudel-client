/**
 * @spec: 028-eq-named-presets (functional §2: 9 languages), 029-scratch-feel-midi-learn (functional §2: 9 languages)
 * The named-preset and feel-knob Learn labels exist and are non-empty in all 9 settings.json files,
 * every language but English has its own words, and the placeholders survive translation.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES_DIR = resolve(process.cwd(), 'website/src/i18n/locales');
const LANGUAGES = ['en', 'es', 'fr', 'ru', 'sr', 'he', 'ar', 'zh', 'ko'];
const KEYS = [
  'equalizerMyPresets',
  'equalizerSaveAs',
  'equalizerPresetName',
  'equalizerRename',
  'equalizerOverwrite',
  'equalizerDelete',
  'equalizerDeleteConfirm',
  'equalizerNameTaken',
  'equalizerNameInvalid',
  'equalizerPresetsFull',
  'equalizerPresetMissing',
  'scratchFeelLearn',
  'scratchFeelLearning',
  'scratchFeelForget',
  'scratchFeelLearnTimeout',
  'scratchFeelLearnConflict',
  'scratchMidiLearnConflict',
];
const SENTENCES = [
  'equalizerDeleteConfirm',
  'equalizerNameTaken',
  'equalizerNameInvalid',
  'equalizerPresetsFull',
  'scratchFeelLearning',
  'scratchFeelLearnTimeout',
  'scratchFeelLearnConflict',
  'equalizerPresetMissing',
  'scratchMidiLearnConflict',
];

const readSettings = (lang: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(LOCALES_DIR, lang, 'settings.json'), 'utf8')) as Record<string, unknown>;

describe('named EQ presets and feel knob Learn labels (specs 028, 029)', () => {
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

  it.each(LANGUAGES)('%s keeps the placeholders', (lang) => {
    const settings = readSettings(lang);
    expect(settings.equalizerDeleteConfirm).toContain('{{name}}');
    expect(settings.scratchFeelLearnConflict).toContain('{{control}}');
    expect(settings.scratchMidiLearnConflict).toContain('{{control}}');
  });
});
