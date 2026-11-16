/**
 * @spec: 031-midi-mapping (§2.7 strings; tech §2.6 i18n)
 * The MIDI panel, volume and crossfader strings exist and are non-empty in all 9 settings.json
 * files with the same placeholders, every language but English has its own words (except names kept
 * as is: MIDI, EQ, A/B and the loanwords listed), and types.ts declares them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const I18N_DIR = resolve(process.cwd(), 'website/src/i18n');
const LANGUAGES = ['en', 'es', 'fr', 'ru', 'sr', 'he', 'ar', 'zh', 'ko'];
const KEYS = [
  'midiTitle',
  'midiDescription',
  'midiStatusUnsupported',
  'midiStatusIdle',
  'midiStatusDenied',
  'midiStatusFailed',
  'midiStatusReady',
  'midiStatusNoInputs',
  'midiGroupEq',
  'midiGroupMixer',
  'midiGroupSet',
  'midiGroupTransport',
  'midiGroupTransition',
  'midiGroupView',
  'midiGroupScratch',
  'midiTargetBand',
  'midiTargetEqToggle',
  'midiTargetEqAb',
  'midiTargetSpeakers',
  'midiTargetHeadphones',
  'midiTargetCrossfader',
  'midiTargetCueGo',
  'midiTargetPlayStop',
  'midiTargetUpdate',
  'midiTargetNextType',
  'midiTargetPrevType',
  'midiTargetPerformance',
  'midiTargetJog',
  'midiTargetBrake',
  'midiTargetSpinUp',
  'midiBindingCc',
  'midiBindingNote',
  'midiLearn',
  'midiLearning',
  'midiClear',
  'midiClearAll',
  'midiClearAllConfirm',
  'midiClearAllYes',
  'midiCancel',
  'midiExport',
  'midiImport',
  'midiImported',
  'midiImportErrorNotJson',
  'midiImportErrorNotMap',
  'midiImportErrorVersion',
  'midiImportErrorBinding',
  'midiImportErrorDuplicate',
  'midiImportErrorConflict',
  'midiImportErrorRead',
  'midiPickup',
  'midiTimedOut',
  'midiCancelled',
  'midiConflict',
  'mixerLevels',
  'mixerCrossfaderSideA',
  'mixerCrossfaderSideB',
  'mixerCrossfaderPlaying',
  'mixerCrossfaderMixing',
  'mixerCrossfaderNothingCued',
  'mixerCrossfaderReturn',
  'mixerCrossfaderHint',
  'scratchMidiConflictHolder',
];
/** Kept as is in some languages: a name, an abbreviation or a DJ loanword. */
const SAME_ALLOWED = new Set([
  'midiTitle',
  'midiGroupEq',
  'midiTargetEqAb',
  'midiGroupSet',
  'midiGroupScratch',
  'midiGroupTransport',
  'midiGroupTransition',
  'midiTargetCrossfader',
]);

const read = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(I18N_DIR, 'locales', lang, 'settings.json'), 'utf8'));
const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();

describe('spec 031: MIDI mapping strings', () => {
  const en = read('en');

  it.each(LANGUAGES)('%s has every key, non-empty, with English placeholders', (lang) => {
    const strings = read(lang);
    for (const key of KEYS) {
      expect(typeof strings[key], `${lang}:${key}`).toBe('string');
      expect(strings[key].trim(), `${lang}:${key}`).not.toBe('');
      expect(placeholders(strings[key]), `${lang}:${key}`).toEqual(placeholders(en[key]));
    }
  });

  it.each(LANGUAGES.filter((lang) => lang !== 'en'))('%s is translated, not English copied over', (lang) => {
    const strings = read(lang);
    const copied = KEYS.filter((key) => !SAME_ALLOWED.has(key) && strings[key].trim() === en[key].trim());
    expect(copied).toEqual([]);
  });

  it('the failed status and Learn reason have their own string, as denied does', () => {
    expect(en.midiStatusFailed).toBeTruthy();
    expect(en.midiStatusFailed).not.toBe(en.midiStatusDenied);
  });

  it('types.ts declares every key', () => {
    const types = readFileSync(resolve(I18N_DIR, 'types.ts'), 'utf8');
    for (const key of KEYS) expect(types).toMatch(new RegExp(`\\b${key}: string;`));
  });
});
