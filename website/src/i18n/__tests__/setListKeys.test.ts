/**
 * Spec 022 §2.7: "When the app is in any of the 9 languages, then no set label shows an
 * untranslated key", and "in Hebrew or Arabic the Set tab and set bar show translated text and
 * mirror correctly." localeCompleteness proves the keys exist and are non-empty; this proves they
 * are not English copied over. A word that really is the same in a language (French "Set", a
 * loanword) is listed explicitly.
 *
 * The RTL guard: the Set tab, the set bar and the "Add to set" chooser use only logical
 * (start/end) spacing and alignment, which the app's `dir="rtl"` mirrors. The visual check itself
 * is a browser verification.
 *
 * @spec: 022-set-playlist
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const LOCALES_DIR = resolve(ROOT, 'website/src/i18n/locales');
const LANGUAGES = ['ar', 'es', 'fr', 'he', 'ko', 'ru', 'sr', 'zh'];
/** Strings that are legitimately spelled the same as in English. */
const SAME_AS_ENGLISH: Record<string, string[]> = { fr: ['settings:setListDefaultBase'] };

type Strings = Record<string, string>;
const read = (lang: string, ns: string): Strings =>
  JSON.parse(readFileSync(resolve(LOCALES_DIR, lang, `${ns}.json`), 'utf8'));

/** Every spec 022 string of a language, keyed `namespace:key`. */
function setStrings(lang: string): Strings {
  const settings = read(lang, 'settings');
  const out: Strings = {};
  for (const [key, text] of Object.entries(settings)) if (/^setList/.test(key)) out[`settings:${key}`] = text;
  out['tabs:set'] = read(lang, 'tabs').set;
  out['files:addToSet'] = read(lang, 'files').addToSet;
  out['shortcuts:setNext'] = read(lang, 'shortcuts').setNext;
  return out;
}

const en = setStrings('en');
const SET_KEYS = Object.keys(en);

/** Keys that are missing, empty or the English text in `target`. */
function untranslated(target: Strings): string[] {
  return SET_KEYS.filter((key) => {
    const text = target[key];
    return typeof text !== 'string' || !text.trim() || text.trim() === en[key].trim();
  });
}

/** Keys whose `{{placeholders}}` differ from English (a broken interpolation shows `{{name}}`). */
function placeholderMismatches(target: Strings): string[] {
  const names = (text: string | undefined) =>
    [...(text ?? '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
  return SET_KEYS.filter((key) => names(target[key]).join() !== names(en[key]).join());
}

describe('spec 022: every set string is translated in all 9 languages', () => {
  it('covers the Set tab, the set bar, the toasts, the chooser, the tab, the menu entry and the shortcut', () => {
    expect(SET_KEYS.length).toBeGreaterThanOrEqual(40);
    for (const key of [
      'settings:setListSignIn',
      'settings:setListNameTaken',
      'settings:setListMissing',
      'settings:setListEndOfSet',
      'settings:setListCue',
      'settings:setListGo',
      'settings:setListCueShort',
      'settings:setListGoShort',
      'settings:setListCueNoLibrary',
      'settings:setListCueNoPreview',
      'settings:setListCueFailed',
      'settings:setListGoIgnored',
      'settings:setListSaveRetrying',
      'settings:setListSkippedMissing',
      'settings:setListChooserTitle',
      'tabs:set',
      'files:addToSet',
      'shortcuts:setNext',
    ]) {
      expect(SET_KEYS).toContain(key);
      expect(en[key]?.trim()).toBeTruthy();
    }
    // The texts the spec quotes.
    expect(en['settings:setListSignIn']).toBe('Sign in to build a set');
    expect(en['settings:setListNameTaken']).toBe('A set with this name already exists');
    expect(en['settings:setListSaveRetrying']).toBe("Couldn't save the set — retrying");
    expect(en['settings:setListSkippedMissing']).toBe('Skipped a missing track');
    expect(en['settings:setListEndOfSet']).toBe('End of set');
  });

  it.each(LANGUAGES)('%s: no set string is missing or left in English', (lang) => {
    expect(untranslated(setStrings(lang))).toEqual(SAME_AS_ENGLISH[lang] ?? []);
  });

  it.each(LANGUAGES)('%s: placeholders ({{name}}) are kept', (lang) => {
    expect(placeholderMismatches(setStrings(lang))).toEqual([]);
  });

  it('negative: English copied into a locale, a missing key and a lost placeholder are caught', () => {
    const copied = { ...setStrings('es'), 'settings:setListGo': en['settings:setListGo'] };
    delete copied['files:addToSet'];
    expect(untranslated(copied)).toEqual(['settings:setListGo', 'files:addToSet']);
    expect(untranslated(en)).toEqual(SET_KEYS);
    const broken = { ...setStrings('he'), 'settings:setListDeleteConfirm': 'מחיקה?' };
    expect(placeholderMismatches(broken)).toEqual(['settings:setListDeleteConfirm']);
  });
});

// The compact control bar's set button shows one of these under its icon, like its siblings'
// captions (2026-11-13 browser check: a long Cue label broke mid-word or overflowed a 360px phone).
const SHORT_KEYS = ['setListCueShort', 'setListGoShort'];
const MAX_SHORT = 7;
/** Short captions that aren't one word of at most 7 characters. */
function badShortCaptions(settings: Strings): string[] {
  return SHORT_KEYS.filter((key) => {
    const text = settings[key];
    return typeof text !== 'string' || !text.trim() || /\s/.test(text.trim()) || [...text.trim()].length > MAX_SHORT;
  });
}

describe('spec 022: the compact Cue/Go captions are one short word', () => {
  it('English is Cue / Go', () => {
    const settings = read('en', 'settings');
    expect([settings.setListCueShort, settings.setListGoShort]).toEqual(['Cue', 'Go']);
  });

  it.each(['en', ...LANGUAGES])(`%s: one word of at most ${MAX_SHORT} characters`, (lang) => {
    expect(badShortCaptions(read(lang, 'settings'))).toEqual([]);
  });

  it('sr is in Cyrillic', () => {
    const settings = read('sr', 'settings');
    for (const key of SHORT_KEYS) expect(settings[key]).toMatch(/^[Ѐ-ӿ]+$/);
  });

  it('negative: two words, a long word and a missing caption are caught', () => {
    expect(badShortCaptions({ setListCueShort: 'האזנה מקדימה', setListGoShort: 'Preescuchar' })).toEqual(SHORT_KEYS);
    expect(badShortCaptions({ setListCueShort: 'Cue' })).toEqual(['setListGoShort']);
  });
});

/** Tailwind classes that pin a side (left/right) instead of start/end, so they don't mirror in RTL. */
const PHYSICAL =
  /(?<=^|[\s"'`:])-?(?:m[lr]|p[lr]|left|right|text-left|text-right|rounded-[lr]|rounded-[tb][lr]|border-[lr]|float-left|float-right)(?:-[\w./[\]]+)?(?=[\s"'`]|$)/g;
const physicalClasses = (source: string) => [...source.matchAll(PHYSICAL)].map((m) => m[0]);

describe('spec 022: the Set tab and the set bar mirror in right-to-left languages', () => {
  it.each([
    'website/src/repl/components/panel/SetTab.tsx',
    'website/src/repl/components/set/SetBar.tsx',
    'website/src/repl/components/set/AddToSetChooser.tsx',
  ])('%s uses only logical (start/end) sides', (file) => {
    expect(physicalClasses(readFileSync(resolve(ROOT, file), 'utf8'))).toEqual([]);
  });

  it('negative: left/right classes are caught', () => {
    expect(physicalClasses(`className="ml-2 pr-4 text-left ps-2 me-1 right-0 rounded-l"`)).toEqual([
      'ml-2',
      'pr-4',
      'text-left',
      'right-0',
      'rounded-l',
    ]);
  });
});
