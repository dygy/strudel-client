/**
 * @spec: 018-strudel-mcp-server (functional 2.12)
 * @regression
 * "All new text the user sees on the consent page and in the tab is in that language."
 * `localeCompleteness.test.ts` holds that every key is there. It can't see English pasted into a locale,
 * which shows as English to someone who chose Hebrew, so that's what this holds.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES = resolve(process.cwd(), 'website/src/i18n/locales');
const LANGUAGES = ['ar', 'es', 'fr', 'he', 'ko', 'ru', 'sr', 'zh'];

/** The parts of each namespace this feature added. */
const SECTIONS: Array<[namespace: string, section: string]> = [
  ['auth', 'consent'],
  ['settings', 'connectedAssistants'],
  ['settings', 'assistantControl'],
  ['files', 'trackConflict'],
];
/** A product's name reads the same in every language. */
const SAME_EVERYWHERE = new Set(['settings:connectedAssistants.claudeCodeTitle']);

type Tree = { [key: string]: string | Tree };

function strings(lang: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (tree: Tree, prefix: string) => {
    for (const [key, value] of Object.entries(tree)) {
      if (typeof value === 'string') found.set(`${prefix}.${key}`, value);
      else walk(value, `${prefix}.${key}`);
    }
  };
  for (const [namespace, section] of SECTIONS) {
    const file = JSON.parse(readFileSync(resolve(LOCALES, lang, `${namespace}.json`), 'utf8')) as Tree;
    walk(file[section] as Tree, `${namespace}:${section}`);
  }
  return found;
}

const english = strings('en');

describe("the feature's text", () => {
  it('is found, so the checks below are checking something', () => {
    expect(english.size).toBeGreaterThan(60);
    expect(english.get('auth:consent.allow')).toBeTruthy();
    expect(english.get('files:trackConflict.message')).toBe('This track was changed elsewhere');
  });

  it.each(LANGUAGES)('%s has its own words for it, not the English', (lang) => {
    const target = strings(lang);
    const copied = [...english].filter(([key, text]) => target.get(key) === text && !SAME_EVERYWHERE.has(key));
    expect(copied.map(([key]) => key)).toEqual([]);
  });

  it('has a message for every short message a tab can show', () => {
    const source = readFileSync(resolve(process.cwd(), 'website/src/repl/assistantControl/handlers.ts'), 'utf8');
    const union = /export type ControlMessage =([\s\S]*?);/.exec(source)![1];
    const messages = [...union.matchAll(/'(\w+)'/g)].map((match) => match[1]);
    expect(messages.length).toBeGreaterThan(5);
    const missing = messages.filter((message) => !english.has(`settings:assistantControl.messages.${message}`));
    expect(missing).toEqual([]);
  });
});
