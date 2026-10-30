/**
 * Spec 017 §2.6: "When the user views Mixer Settings in each of the 9 languages, then every
 * transition label and description is translated." localeCompleteness proves the keys exist and
 * are non-empty; this proves they are not English copied over. A word that really is the same in
 * a language (French "Transition") is listed explicitly.
 *
 * Also a guard for "laid out right to left": the Transition group and the picker use only logical
 * (start/end) spacing and alignment, which the app's `dir="rtl"` mirrors. The visual check itself
 * is a browser verification.
 *
 * @spec: 017-track-transition-types
 * @regression
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const LOCALES_DIR = resolve(ROOT, 'website/src/i18n/locales');
const LANGUAGES = ['ar', 'es', 'fr', 'he', 'ko', 'ru', 'sr', 'zh'];
/** Strings that are legitimately spelled the same as in English. */
const SAME_AS_ENGLISH: Record<string, string[]> = { fr: ['transition'] };

const settingsOf = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(LOCALES_DIR, lang, 'settings.json'), 'utf8'));

const en = settingsOf('en');
/** The spec 017 strings: the Transition group, types, descriptions, Length, modifiers, picker, errors. */
const TRANSITION_KEYS = Object.keys(en).filter((key) => /^transition/.test(key));

/** Keys whose text in `target` is the English text (not translated). */
function untranslated(target: Record<string, string>, keys = TRANSITION_KEYS): string[] {
  return keys.filter((key) => target[key]?.trim() === en[key].trim());
}

describe('spec 017: every transition string is translated in all 9 languages', () => {
  it('covers the group, the eight types with descriptions, Length, modifiers and picker', () => {
    expect(TRANSITION_KEYS.length).toBeGreaterThanOrEqual(30);
    for (const suffix of ['Off', 'Dip', 'Cut', 'Crossfade', 'FilterSweep', 'BassSwap', 'EchoOut', 'LayeredIntro']) {
      expect(TRANSITION_KEYS).toContain(`transitionType${suffix}`);
      expect(TRANSITION_KEYS).toContain(`transitionDesc${suffix}`);
    }
  });

  it.each(LANGUAGES)('%s: no transition string is left in English', (lang) => {
    expect(untranslated(settingsOf(lang))).toEqual(SAME_AS_ENGLISH[lang] ?? []);
  });

  it('negative: English copied into a locale is caught, key by key', () => {
    const copied = { ...settingsOf('es'), transitionDescEchoOut: en.transitionDescEchoOut };
    expect(untranslated(copied)).toEqual(['transitionDescEchoOut']);
    expect(untranslated(en)).toEqual(TRANSITION_KEYS);
  });
});

/** Tailwind classes that pin a side (left/right) instead of start/end, so they don't mirror in RTL. */
const PHYSICAL =
  /(?<=^|[\s"'`:])-?(?:m[lr]|p[lr]|left|right|text-left|text-right|rounded-[lr]|rounded-[tb][lr]|border-[lr]|float-left|float-right)(?:-[\w./[\]]+)?(?=[\s"'`]|$)/g;
const physicalClasses = (source: string) => [...source.matchAll(PHYSICAL)].map((m) => m[0]);

describe('spec 017: the Transition group and the picker mirror in right-to-left languages', () => {
  it.each([
    'website/src/repl/components/TransitionPicker.tsx',
    'website/src/repl/components/panel/TransitionSettingsSection.tsx',
  ])('%s uses only logical (start/end) sides', (file) => {
    expect(physicalClasses(readFileSync(resolve(ROOT, file), 'utf8'))).toEqual([]);
  });

  it('negative: left/right classes are caught', () => {
    expect(physicalClasses(`className="ml-2 pr-4 text-left ps-2 me-1 right-0"`)).toEqual([
      'ml-2',
      'pr-4',
      'text-left',
      'right-0',
    ]);
  });
});
