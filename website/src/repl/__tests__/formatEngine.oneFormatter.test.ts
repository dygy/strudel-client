/**
 * One formatter, whatever the size of the file: the main thread and the worker (files over 5000 characters) each had a
 * copy, and they disagreed. The worker flattened every indent to one space, missed `s(`, `stack(` and `arrange(` and
 * had no composition step. The main thread ran its spacing rules inside multi-line template literals, which changed
 * the pattern in them.
 *
 * Also here: what the formatter may never do to code, in both paths.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { FormatEngine, type PrettierOptions } from '../formatEngine';
import { formatCode as formatInWorker } from '../../../../packages/codemirror/prettierWorker.mjs';

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

const long = 'x'.repeat(130);
const copies = [
  ['main thread', (code: string, o = options) => FormatEngine.getInstance().formatCode(code, o)],
  ['worker', (code: string, o = options) => formatInWorker(code, o)],
] as const;

describe.each(copies)('%s', (_copy, formatCode) => {
  const format = async (code: string, o = options) => {
    const r = await formatCode(code, o);
    expect(r.success, r.error).toBe(true);
    return r.formattedCode!;
  };

  describe('A: the same output', () => {
    it.each([
      ['indentation', 'foo(\ns("bd"),\nbar(\nx\n)\n)', 'foo(\n  s("bd"),\n  bar(\n    x\n  )\n)'],
      ['s( alone marks Strudel', 's("bd")   ;x=1', 's("bd");x = 1'],
      ['stack( alone, composition step', 'stack(a,  b)', 'stack(\n  a,\n  b\n)'],
      ['arrange( alone, composition step', 'arrange(a, b)', 'arrange(\n  a,\n  b\n)'],
      ['a chained stack', 's("a").stack(b, c)', 's("a").stack(\n  b,\n  c\n)'],
      ['one short argument stays', 'stack(s("x"))', 'stack(s("x"))'],
      [
        'one argument over the print width expands, by the real string',
        `stack(s("${long}"))`,
        `stack(\n  s("${long}")\n)`,
      ],
      ['a call with a multi-line string stays', 'stack(a, `x\ny`)', 'stack(a, `x\ny`)'],
      ['chained lines', 's("bd")\n.gain(1)\n.room(.5)', 's("bd")\n  .gain(1)\n  .room(.5)'],
    ])('%s', async (_name, code, expected) => {
      expect(await format(code)).toBe(expected);
    });

    it('tabs', async () => {
      expect(await format('foo(\ns("bd")\n)', { ...options, useTabs: true })).toBe('foo(\n\ts("bd")\n)');
    });

    it('calls in strings stay, with the outer call expanded', async () => {
      expect(await format('arrange("stack(a,b)", s("hh"))')).toBe('arrange(\n  "stack(a,b)",\n  s("hh")\n)');
      expect(await format('s("stack(a,b)")')).toBe('s("stack(a,b)")');
    });
  });

  describe('A: multi-line template literals keep their bytes', () => {
    it.each([
      ['a pattern', 'n(`0-1  x=y\n  2`)', 'n(`0-1  x=y\n  2`)'],
      ['inside a level', 'foo(\nn(`a  b\n      c`)\n)', 'foo(\n  n(`a  b\n      c`)\n)'],
      ['with brackets at the end of a line', 'n(`a (\n  b`)\nlet x=1', 'n(`a (\n  b`)\nlet x = 1'],
      ['with a line starting with a dot', 'n(`a\n.b  c`)', 'n(`a\n.b  c`)'],
    ])('%s', async (_name, code, expected) => {
      expect(await format(`setcps(1)\n${code}`)).toBe(`setcps(1)\n${expected}`);
    });
  });

  describe('B: what the formatter must not do', () => {
    it.each([
      ['a line break inside a regex', 'let r=/\\)x/'],
      ['spaces inside a regex', 'x.replace(/a=b/g, "")'],
      ['a quote in a regex, pairing up with one in a comment', `x.replace(/'/g, "") // a ' b=c,d)e`],
    ])('%s: the original comes back', async (_name, code) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await format(`setcps(1)\n${code}`)).toBe(`setcps(1)\n${code}`);
    });

    it.each([['a%=2'], ['a&=2'], ['a|=2'], ['a^=2'], ['a??=2'], ['a||=2'], ['a&&=2']])(
      'a compound assignment is not split, and the rest is formatted: %s',
      async (code) => {
        expect(await format(`setcps(1)\nlet x=1\n${code}`)).toBe(`setcps(1)\nlet x = 1\n${code}`);
      },
    );

    it.each([
      ['a stray quote and a comment', `s('bd) // don't a=b)evil()`],
      ['a stray double quote and a comment', `s("bd) // the "big" one=1)x`],
      ['an open backtick and a comment', 'let a=`abc\n// it`s a=b)evil()'],
      ['a quote in a regex, in code that does not parse', `foo(\nx.replace(/'/g,"") // a ' b=c)evil()`],
      ['an open call', 's("bd"\nlet a=1'],
    ])('code that will not parse afterwards stays as it is, and says so: %s', async (_name, code) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const input = `setcps(1)\n${code}`;
      await expect(formatCode(input)).resolves.toEqual({ success: true, formattedCode: input, rejected: true });
    });

    it('code that parses only once formatted is formatted: glued statements', async () => {
      await expect(formatCode('setcps(1)let x=1')).resolves.toEqual({
        success: true,
        formattedCode: 'setcps(1)\nlet x = 1',
      });
    });

    it('code already formatted is a success, not a refusal', async () => {
      const input = 'setcps(1)\nlet x = 1';
      await expect(formatCode(input)).resolves.toEqual({ success: true, formattedCode: input });
    });

    it('a refusal of parsing code says so too', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const input = 'setcps(1)\nx.replace(/a=b/g, "")';
      await expect(formatCode(input)).resolves.toEqual({ success: true, formattedCode: input, rejected: true });
    });
  });

  describe('C: whitespace', () => {
    it.each([
      ['a line separator', 'foo()\u2028bar()'],
      ['a paragraph separator', 'foo()\u2029bar()'],
      ['after spaces', 'foo();  \u2028bar()'],
    ])('%s stays, and the rest is formatted', async (_name, code) => {
      expect(await format(`setcps(1)\nlet x=1\n${code}`)).toBe(`setcps(1)\nlet x = 1\n${code}`);
    });

    it('a comment opening an argument has no space in front of it', async () => {
      const once = await format('stack(a, /* x */ b)');
      expect(once).toBe('stack(\n  a,\n  /* x */ b\n)');
      expect(await format(once)).toBe(once);
    });

    it('a trailing comma stays', async () => {
      expect(await format('stack(a, b,)')).toBe('stack(\n  a,\n  b,\n)');
    });
  });
});

it('A: a whole track comes out the same from both', async () => {
  const track = `// a(b)c, d=e  f (
let chords = arrange([16, "<Cm7!4 [Bb7 Ab^7 G7b9!2]@4>"],
[32, "<Dm!4 Em7b5!2 A7b9!2>"]).chord()
setcpm(70)
stack(
stack(
// pad
chords.dict('ireal-ext').set.mix(offset("<0!3 [1 2 1 4]>")).voicing()
.s("<gm_fx_goblins gm_accordion gm_bagpipe>*2").color("pink")
.clip(.9).delay(.6).attack(.3).add(note("0,.1")) // don't
,
n(\`0-1  x=y
    2\`).gain(1)
),
s("bd"),s("hh")).out()
let t=setcps(1)let u=175let v=2
`;
  const main = await FormatEngine.getInstance().formatCode(track, options);
  const worker = await formatInWorker(track, options);
  expect(main.formattedCode).toBe(worker.formattedCode);
  expect(main.formattedCode).toContain('n(`0-1  x=y\n    2`)');
});
