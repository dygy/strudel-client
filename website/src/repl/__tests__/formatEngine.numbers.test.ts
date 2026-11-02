/**
 * The Strudel preprocessing before Prettier split every digit followed by a letter onto a new line, which broke
 * numeric literals and identifiers holding a digit: `getTime() + 1e-4` became `1\ne-4` (a syntax error), `bass2hit`
 * became `bass2\nhit`. Only a glued statement like `175let` may be split.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { FormatEngine, type PrettierOptions } from '../formatEngine';
import { splitGluedAfterNumbers } from '../../../../packages/codemirror/splitGlued.mjs';

const options: PrettierOptions = {
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'es5',
  bracketSpacing: true,
  arrowParens: 'always',
  printWidth: 120,
};

// setcps( marks the code as Strudel: it then takes formatStrudelCode's preprocessing instead of plain Prettier
async function format(code: string): Promise<string> {
  const r = await FormatEngine.getInstance().formatCode('setcps(0.5)\n' + code, options);
  expect(r.success, r.error).toBe(true);
  return r.formattedCode!;
}

describe('formatting keeps numeric literals and identifiers with digits whole', () => {
  it.each([
    // MIDI-grep visuals block, 2026-11-02
    [
      'exponent',
      'const chordDepth = () => visChords.queryArc(getTime(), getTime() + 1e-4).length / visChordMax',
      '1e-4',
    ],
    ['exponent without sign', 'const big = 1e5 * 2', '1e5'],
    ['exponent in a ternary', 'const x = cond ? 1e5 : 2', '1e5'],
    ['hex', 'const mask = 0xff & 0x1f', '0x1f'],
    ['bigint', 'const n = 10n', '10n'],
    ['identifier with a digit', 'const bass2hit = 1; const y = bass2hit + 1', 'bass2hit + 1'],
    ['Hydra outputs', 'src(s0).modulate(o1, 0.1).out(o0)', 'out(o0)'],
  ])('%s', async (_name, code, kept) => {
    const out = await format(code);
    expect(out).toContain(kept);
    expect(() => new Function(out.replace(/\bawait\b/g, ''))).not.toThrow();
  });

  it('still splits a statement glued after a number', async () => {
    const out = await format('setcps(0.5);const a = 175let b = 2');
    expect(out).toMatch(/175;?\s*\n\s*let b = 2/);
  });
});

// the shared step both formatter copies run (the main thread and the worker for files over 5000 characters)
describe('splitGluedAfterNumbers', () => {
  it.each([
    ['getTime() + 1e-4', 'getTime() + 1e-4'],
    ['x = 1E+5', 'x = 1E+5'],
    ['0x1F | 0b101 | 0o17 | 1_000 | 10n | .5', '0x1F | 0b101 | 0o17 | 1_000 | 10n | .5'],
    ['bass2hit + o0 + s1e', 'bass2hit + o0 + s1e'],
    ['a = 175let b = 2', 'a = 175\nlet b = 2'],
    ['a = 0.5const b', 'a = 0.5\nconst b'],
    ['x = 1e5foo:', 'x = 1e5\nfoo:'],
  ])('%s', (code, expected) => {
    expect(splitGluedAfterNumbers(code)).toBe(expected);
  });
});
