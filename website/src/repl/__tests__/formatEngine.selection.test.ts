/**
 * Formatting a selection reformatted the whole document, for Strudel code. Only the selected range may change.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { FormatEngine, type PrettierOptions } from '../formatEngine';
import { formatSelection as selectInWorker } from '../../../../packages/codemirror/prettierWorker.mjs';

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

const copies = [
  [
    'main thread',
    (code: string, a: number, b: number) => FormatEngine.getInstance().formatSelection(code, a, b, options),
  ],
  ['worker', (code: string, a: number, b: number) => selectInWorker(code, a, b, options)],
] as const;

/** Formats the part between the two | marks, and returns what the result is. */
const marked = (text: string) => {
  const start = text.indexOf('|');
  const end = text.indexOf('|', start + 1) - 1;
  return { code: text.replace(/\|/g, ''), start, end };
};

describe.each(copies)('%s', (_copy, select) => {
  // setcps( in the document makes it Strudel code, whatever is selected
  const PREFIX = 'setcps(1)\n';
  const run = async (text: string) => {
    const { code, start, end } = marked(PREFIX + text);
    const r = await select(code, start, end);
    expect(r.success, r.error).toBe(true);
    expect(r.formattedCode!.startsWith(PREFIX)).toBe(true);
    return { out: r.formattedCode!.slice(PREFIX.length), cursor: r.cursorOffset! - PREFIX.length };
  };

  it('leaves everything outside the selection byte for byte', async () => {
    const { out } = await run('let a=1\n|let b=2\n|let c=3   ;d=4');
    expect(out).toBe('let a=1\nlet b = 2\nlet c=3   ;d=4');
  });

  it('puts the cursor at the end of the formatted selection', async () => {
    const { out, cursor } = await run('s("a")  ;x=1\n|let b=2|\nlet c=3');
    expect(out).toBe('s("a")  ;x=1\nlet b = 2\nlet c=3');
    expect(out.slice(0, cursor)).toBe('s("a")  ;x=1\nlet b = 2');
  });

  it('keeps the indent of the line the selection starts on', async () => {
    const { out } = await run('if (x) {\n    |let b=2\nlet c=3|\n}');
    expect(out).toBe('if (x) {\n    let b = 2\n    let c = 3\n}');
  });

  it('a selection from the start of an indented line keeps that indent', async () => {
    const { out } = await run('if (x) {\n|    let b=2|\n}');
    expect(out).toBe('if (x) {\n    let b = 2\n}');
  });

  it('a selection in the middle of a line stays in it', async () => {
    const { out, cursor } = await run('s("a") ;let   |x=1 |+   2');
    expect(out).toBe('s("a") ;let   x = 1 +   2');
    expect(out.slice(0, cursor)).toBe('s("a") ;let   x = 1 ');
  });

  it('a trailing line break and the indent after it stay', async () => {
    const { out } = await run('|let b=2\n  |let c=3');
    expect(out).toBe('let b = 2\n  let c=3');
  });

  it('a multi-line string in the selection is not indented', async () => {
    const { out } = await run('foo(\n  |n(`a\nb`)|\n)');
    expect(out).toBe('foo(\n  n(`a\nb`)\n)');
  });

  it.each([
    [`s('bd) // don't a=b)evil()`],
    [`s("bd) // the "big" one=1)x`],
    [`foo(\nx.replace(/'/g,"") // a ' b=c)evil()`],
  ])('selected in a document that will not parse, nothing changes, and it says so: %s', async (line) => {
    const code = `setcps(1)\n${line}`;
    const r = await select(code, code.indexOf(line), code.length);
    expect(r).toEqual({ success: true, formattedCode: code, cursorOffset: code.length, rejected: true });
  });

  it('a refused selection stays byte for byte, with its trailing spaces', async () => {
    const code = 'setcps(1)\nx.replace(/a=b/,"c")   \nlet y=1';
    const start = code.indexOf('x.replace');
    const end = code.indexOf('\nlet y');
    const r = await select(code, start, end);
    expect(r).toEqual({ success: true, formattedCode: code, cursorOffset: end, rejected: true });
  });

  it('a selection with its trailing spaces, formatted, keeps them once', async () => {
    const { out } = await run('|let y=1   |\nlet z=2');
    expect(out).toBe('let y = 1   \nlet z=2');
  });

  it('a selection inside a comment changes nothing', async () => {
    const code = 'setcps(1)\n// a=b c=d\nlet x=1';
    const r = await select(code, code.indexOf('a=b'), code.indexOf(' c=d'));
    expect(r.formattedCode).toBe(code);
  });

  it('a selection inside a string changes nothing', async () => {
    const code = 'setcps(1)\ns("a=b c=d")\nlet x=1';
    const r = await select(code, code.indexOf('a=b'), code.indexOf(' c=d'));
    expect(r.formattedCode).toBe(code);
  });

  it('a selection cutting a string in two changes nothing outside it', async () => {
    const code = 'setcps(1)\ns("a=b   c=d")\nlet x=1';
    const r = await select(code, code.indexOf('c=d'), code.indexOf('let x') + 3);
    expect(r.formattedCode).toBe(code);
  });
});
