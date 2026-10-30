/**
 * Locale files stay clean: no key is written twice (JSON.parse silently keeps the last one, so a
 * later edit to the first copy does nothing), and Serbian stays in Cyrillic, as the rest of `sr` is.
 *
 * Regression (2026-10-30): `ko` and `zh` `files.json` had `noTracksToExport` twice, and
 * `sr/auth.json` was in Latin script.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES_DIR = resolve(process.cwd(), 'website/src/i18n/locales');
const LANGUAGES = readdirSync(LOCALES_DIR);

/** Keys that appear twice in the same object, as "path.key". */
export function duplicateKeys(json: string): string[] {
  const found: string[] = [];
  const stack: Array<{ path: string; keys: Set<string> }> = [];
  // Tokens: strings, braces and brackets; a string followed by ':' is a key.
  const token = /"(?:[^"\\]|\\.)*"\s*:|"(?:[^"\\]|\\.)*"|[{}[\]]/g;
  let pendingKey = '';
  for (const [t] of json.matchAll(token)) {
    if (t === '{') {
      const parent = stack[stack.length - 1];
      stack.push({ path: parent ? `${parent.path}${pendingKey}.` : '', keys: new Set() });
    } else if (t === '}') stack.pop();
    else if (t.endsWith(':')) {
      const key = JSON.parse(t.slice(0, -1).trim()) as string;
      const top = stack[stack.length - 1];
      if (top.keys.has(key)) found.push(`${top.path}${key}`);
      top.keys.add(key);
      pendingKey = key;
    }
  }
  return found;
}

/** Latin-script words in a value, ignoring placeholders, file names and the names kept as is. */
export function latinWords(value: string): string[] {
  const stripped = value
    .replace(/\{\{\w+\}\}/g, '')
    .replace(/\S*\.(sql|js|txt|zip|json)\b/g, '')
    .replace(/\b(Google|Strudel|Supabase|Dashboard|MIDI|OSC|EQ|URL|ZIP|Tidal|Hydra|Prettier|JavaScript)\b/g, '');
  return stripped.match(/[A-Za-zČĆŽŠĐčćžšđ]{2,}/g) ?? [];
}

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

describe('locale hygiene', () => {
  for (const lang of LANGUAGES) {
    for (const file of readdirSync(resolve(LOCALES_DIR, lang)).filter((f) => f.endsWith('.json'))) {
      it(`${lang}/${file} has no duplicate keys`, () => {
        expect(duplicateKeys(readFileSync(resolve(LOCALES_DIR, lang, file), 'utf8'))).toEqual([]);
      });
    }
  }

  it('sr/auth.json is in Cyrillic', () => {
    const auth = JSON.parse(readFileSync(resolve(LOCALES_DIR, 'sr', 'auth.json'), 'utf8'));
    expect(strings(auth).flatMap(latinWords)).toEqual([]);
  });

  it('negative: a duplicate key and Latin Serbian are caught', () => {
    expect(duplicateKeys('{"a": 1, "b": {"c": 1, "c": 2}, "a": 3}')).toEqual(['b.c', 'a']);
    expect(duplicateKeys('{"a": {"x": 1}, "b": {"x": 1}}')).toEqual([]);
    expect(latinWords('Prijavite se sa Google')).toEqual(['Prijavite', 'se', 'sa']);
    expect(latinWords('Пријавите се са Google, {{count}} supabase_schema.sql')).toEqual([]);
  });
});
