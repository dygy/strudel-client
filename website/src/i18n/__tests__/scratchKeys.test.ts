/**
 * @spec: 019-vinyl-scratch-control (2.7 Languages, tech 2.6)
 * Every Scratch label (Mixer settings section, platter, MIDI Learn, Shortcuts tab row) exists in
 * all 9 locales, keeps its {{placeholders}}, and none silently falls back to English.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const I18N_DIR = resolve(process.cwd(), 'website/src/i18n');
const LANGUAGES = ['en', 'es', 'fr', 'ru', 'sr', 'he', 'ar', 'zh', 'ko'];

/** The same word in English and this language (a loanword, not an untranslated string). */
const SAME_AS_ENGLISH = new Set(['es:settings:scratch', 'fr:settings:scratch']);

const read = (lang: string, ns: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(I18N_DIR, 'locales', lang, `${ns}.json`), 'utf8')) as Record<string, unknown>;

const placeholders = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort();

const NAMESPACES = {
  settings: Object.keys(read('en', 'settings')).filter((k) => k.startsWith('scratch')),
  shortcuts: ['scratch'],
};

describe('scratch labels', () => {
  it('English defines the scratch section, deck, hint and MIDI strings', () => {
    expect(NAMESPACES.settings.length).toBeGreaterThanOrEqual(20);
    expect(NAMESPACES.settings).toEqual(
      expect.arrayContaining([
        'scratch',
        'scratchDeckMain',
        'scratchDeckPreview',
        'scratchMidiLearn',
        'scratchShortcutHint',
      ]),
    );
  });

  for (const [ns, keys] of Object.entries(NAMESPACES)) {
    const en = read('en', ns);

    it.each(LANGUAGES)(`%s has every ${ns} scratch key as a non-empty string with the same placeholders`, (lang) => {
      const dict = read(lang, ns);
      const bad = keys.filter(
        (key) =>
          typeof dict[key] !== 'string' ||
          (dict[key] as string).trim() === '' ||
          placeholders(dict[key] as string).join() !== placeholders(en[key] as string).join(),
      );
      expect(bad).toEqual([]);
    });

    it.each(LANGUAGES.filter((lang) => lang !== 'en'))(`%s translates every ${ns} scratch key`, (lang) => {
      const dict = read(lang, ns);
      const english = keys.filter((key) => dict[key] === en[key] && !SAME_AS_ENGLISH.has(`${lang}:${ns}:${key}`));
      expect(english).toEqual([]);
    });
  }
});
