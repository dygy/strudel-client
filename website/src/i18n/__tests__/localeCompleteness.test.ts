/**
 * Every locale must carry every key that English (the source of truth) has.
 * A missing key makes i18next render the raw key name in the UI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Under vitest `import.meta.url` is root-relative, so resolve from the repo root.
const LOCALES_DIR = resolve(process.cwd(), 'website/src/i18n/locales');
const SOURCE = 'en';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function readLocale(lang: string, namespace: string): Json {
  return JSON.parse(readFileSync(resolve(LOCALES_DIR, lang, `${namespace}.json`), 'utf8')) as Json;
}

function flatten(value: Json, prefix = '', out = new Map<string, Json>()): Map<string, Json> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

/** `{{name}}` (i18next) and `{error}` (replaced by hand in packages/codemirror/prettierExtension.mjs). */
function placeholders(text: string): string[] {
  const found: string[] = [];
  const withoutDouble = text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, name: string) => {
    found.push(`{{${name}}}`);
    return '';
  });
  for (const match of withoutDouble.matchAll(/\{(\w+)\}/g)) {
    found.push(`{${match[1]}}`);
  }
  return found;
}

const namespaces = readdirSync(resolve(LOCALES_DIR, SOURCE))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort();

const languages = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== SOURCE)
  .map((entry) => entry.name)
  .sort();

describe('locale completeness', () => {
  it('finds the locales and namespaces', () => {
    expect(languages).toEqual(['ar', 'es', 'fr', 'he', 'ko', 'ru', 'sr', 'zh']);
    expect(namespaces).toEqual(['auth', 'common', 'files', 'messages', 'settings', 'shortcuts', 'tabs', 'welcome']);
  });

  describe.each(languages)('%s', (lang) => {
    describe.each(namespaces)('%s', (namespace) => {
      const source = flatten(readLocale(SOURCE, namespace));
      const target = flatten(readLocale(lang, namespace));

      it('has exactly the same keys as en', () => {
        const missing = [...source.keys()].filter((key) => !target.has(key));
        const extra = [...target.keys()].filter((key) => !source.has(key));
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      });

      it('has a non-empty string for every key', () => {
        const bad = [...target.entries()]
          .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
          .map(([key]) => key);
        expect(bad).toEqual([]);
      });

      // Same placeholder set as en, both ways: none dropped, none invented (e.g. a typo such as
      // {{kye}} beside the real one). placeholders() trims spaces, so {{ key }} == {{key}}.
      it('has exactly the placeholders en has', () => {
        const mismatched: string[] = [];
        for (const [key, enValue] of source) {
          const value = target.get(key);
          if (typeof enValue !== 'string' || typeof value !== 'string') continue;
          const expected = [...new Set(placeholders(enValue))].sort();
          const actual = [...new Set(placeholders(value))].sort();
          if (JSON.stringify(expected) !== JSON.stringify(actual)) {
            mismatched.push(`${key}: en ${expected.join(' ') || '(none)'} vs ${actual.join(' ') || '(none)'}`);
          }
        }
        expect(mismatched).toEqual([]);
      });
    });
  });
});
