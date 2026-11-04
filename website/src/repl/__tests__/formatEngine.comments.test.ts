/**
 * Formatting ran over comment text: a comment was rewritten, and its tail could land outside it as live code, a syntax
 * error in the user's track. Comments stay byte for byte, in both formatter copies: the main thread and the worker for
 * files over 5000 characters.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { FormatEngine, type PrettierOptions } from '../formatEngine';
import { formatCode as formatInWorker } from '../../../../packages/codemirror/prettierWorker.mjs';
import { protectTokens, withoutTrailingComments } from '../../../../packages/codemirror/protectTokens.mjs';

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

// setcps( marks the code as Strudel in both copies: it then takes formatStrudelCode instead of plain Prettier
const STRUDEL = 'setcps(0.5)\n';

const copies = [
  ['main thread', (code: string) => FormatEngine.getInstance().formatCode(code, options)],
  ['worker', (code: string) => formatInWorker(code, options)],
] as const;

describe.each(copies)('comments, %s', (_copy, formatCode) => {
  async function format(code: string): Promise<string> {
    const r = await formatCode(STRUDEL + code);
    expect(r.success, r.error).toBe(true);
    expect(r.formattedCode!.startsWith(STRUDEL)).toBe(true);
    return r.formattedCode!.slice(STRUDEL.length);
  }

  it.each([
    [
      'the line that broke a track',
      '// │ painted by stabilityai/sd-turbo (seed 7, 2 step(s), 640x384); chain by mistral-small (validated)',
    ],
    ['a call followed by text, then odd spacing', '// a(b)c, d=e  f ('],
    ['composition call', '// stack(a, b)'],
    ['a block comment that split in two', '/* 640x384);x\n   keep   this */'],
    ['a multi-line block comment with odd spacing', '/* 640x384);x\n   keep   this,a=b\n\n\t)y   */'],
    ['replacement patterns', '// costs $1, $& and $` and $$'],
    ['an unterminated block comment', '/* never closed)x\n  a=b'],
  ])('keeps %s verbatim', async (_name, comment) => {
    expect(await format(comment)).toBe(comment);
  });

  it('a following line stays code at its own indent', async () => {
    expect(await format('// a(b)c, d=e  f (\ns("bd")')).toBe('// a(b)c, d=e  f (\ns("bd")');
  });

  it('a call and its trailing comment stay on one line', async () => {
    expect(await format('s("bd")// kick')).toBe('s("bd")// kick');
  });

  it('the spacing before a trailing comment survives the semicolon rule', async () => {
    expect(await format('foo();  // c')).toBe('foo();  // c');
  });

  it('apostrophes in comments do not pair up over the code between them', async () => {
    expect(await format("// don't\nlet a=1\n// it's")).toBe("// don't\nlet a = 1\n// it's");
  });

  it('a URL in a string is not a comment, and the code after it is still formatted', async () => {
    expect(await format('samples("http://x.y/z");let a=1')).toBe('samples("http://x.y/z");\nlet a = 1');
  });

  it('a comment marker after a string with one is still a comment', async () => {
    expect(await format('let a="http://x.y"  // a=b,c')).toBe('let a = "http://x.y"  // a=b,c');
  });

  it('a trailing comment does not hide the opening bracket', async () => {
    expect(await format('foo( // drums\ns("bd")\n)')).toBe('foo( // drums\n  s("bd")\n)');
  });

  it('a stack with a trailing comment opens a level', async () => {
    expect(await format('stack( // drums\ns("bd"),\ns("hh")\n)')).toBe('stack( // drums\n  s("bd"),\n  s("hh")\n)');
  });

  it('a comment ending in a bracket opens no level', async () => {
    expect(await format('// foo (\ns("bd")')).toBe('// foo (\ns("bd")');
  });

  it('a comment alone on its line is still re-indented', async () => {
    expect(await format('foo(\n        // c  d\ns("bd")\n)')).toBe('foo(\n  // c  d\n  s("bd")\n)');
  });

  it('code outside comments still gets its glued-statement split and its spacing', async () => {
    expect(await format('foo()let x=1 // a=b')).toBe('foo()\nlet x = 1 // a=b');
  });

  it('a number glued to a statement is still split, a comment after it left alone', async () => {
    expect(await format('let a = 175let b = 2 // 175let')).toBe('let a = 175\nlet b = 2 // 175let');
  });

  it.each([
    ['after a comma', 's("a"),   // kick\ns("b")'],
    ['after a comma, inline', 'foo(a, /* x */ b)'],
    ['after an equals sign', 'let a = // c\n1'],
  ])('its spacing stays put and does not grow with each save: %s', async (_name, code) => {
    const once = await format(code);
    expect(once).toBe(code);
    expect(await format(once)).toBe(once);
  });

  it.each([
    ['in single quotes', `s('bd)\n// don't a=b)evil()\ns("hh")`, `s('bd)\n// don't a=b)evil()\ns("hh")`],
    ['in single quotes, CRLF', `s('bd)\r\n// don't a=b)evil()\r\ns("hh")`, `s('bd)\r\n// don't a=b)evil()\r\ns("hh")`],
    ['after an escaped newline', 'let a="x\\\ny" // say "hi)there a=b', 'let a = "x\\\ny" // say "hi)there a=b'],
    [
      'after an escaped newline, CRLF',
      'let a="x\\\r\ny" // say "hi)there a=b',
      'let a = "x\\\r\ny" // say "hi)there a=b',
    ],
  ])('a stray quote does not pair up with a quote in a later comment: %s', async (_name, code, expected) => {
    expect(await format(code)).toBe(expected);
  });

  it('a backtick string still spans lines, so a comment marker in it is no comment', async () => {
    expect(await format('let t=`x\n// y`;let u=1')).toBe('let t = `x\n// y`;\nlet u = 1');
  });

  it('CRLF: comment text keeps its bytes, the line ending is not part of a line comment', async () => {
    expect(await format('s("a")\r\n// b)c  d=e\r\n/* f)g\r\n   h=i */\r\nlet x=1')).toBe(
      's("a")\n// b)c  d=e\n/* f)g\r\n   h=i */\nlet x = 1',
    );
  });

  it.each([
    ['of a comment', 'let a=\uE0000\uE001 // c'],
    ['of a string', 'let a=\uE0029\uE003 // c'],
  ])('a placeholder lookalike %s in live code: the original comes back', async (_name, code) => {
    expect(await format(code)).toBe(code);
  });

  it('a placeholder lookalike in a string or a comment keeps its bytes, and the code is formatted', async () => {
    expect(await format('let a="\uE0000\uE001" // \uE0020\uE003')).toBe('let a = "\uE0000\uE001" // \uE0020\uE003');
  });

  it('the markers the old placeholders used are ordinary text', async () => {
    expect(await format('let a="XSTRX __LOCAL_STRING_0__" // XSTRUDELSTRINGX __STRING_9__')).toBe(
      'let a = "XSTRX __LOCAL_STRING_0__" // XSTRUDELSTRINGX __STRING_9__',
    );
  });

  describe('a long run of spaces', () => {
    const spaces = ' '.repeat(200_000);

    it('between code collapses to one', async () => {
      expect(await format(`a+${spaces}b`)).toBe('a+ b');
    });

    it('before a trailing comment stays', async () => {
      expect(await format(`a${spaces}// c`)).toBe(`a${spaces}// c`);
    });

    it('before a comment alone on its line goes', async () => {
      expect(await format(`${spaces}// c`)).toBe('// c');
    });
  });

  it.each([
    ['$$', 's("a$$b")', 's("a$$b")'],
    ['$&', 's("a$&b")', 's("a$&b")'],
    ["$'", `s("a$'b");let tail=1`, `s("a$'b");\nlet tail = 1`],
    ['$`', 's("a$`b");let tail=1', 's("a$`b");\nlet tail = 1'],
    ['$$ before a template expression', 'let p=`$$${x}`', 'let p = `$$${x}`'],
    ['$$ and a comment', 's("a$$b") // c', 's("a$$b") // c'],
  ])('a string keeps its bytes with %s in it', async (_name, code, expected) => {
    expect(await format(code)).toBe(expected);
  });

  it('more comments than one digit of placeholder holds', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `// ${i}x)y`).join('\n');
    expect(await format(lines)).toBe(lines);
  });
});

it('a composition call in a comment is not expanded, one in code still is', async () => {
  const r = await FormatEngine.getInstance().formatCode('// stack(a, b)\nstack(a, b)', options);
  expect(r.formattedCode).toBe('// stack(a, b)\nstack(\n  a,\n  b\n)');
});

describe.each(copies)('composition calls and strings, %s', (_copy, formatCode) => {
  const format = async (code: string) => {
    const r = await formatCode(STRUDEL + code);
    return r.formattedCode!.slice(STRUDEL.length);
  };

  it.each([
    ['in a double-quoted string', 's("stack(a,b)")', 's("stack(a,b)")'],
    ['in a template literal', 'let t=`stack(a, b)`', 'let t = `stack(a, b)`'],
    ['as a method, in a string', 's(".stack(a,b)")', 's(".stack(a,b)")'],
    ['arrange, in a string', 's("arrange(a,b)")', 's("arrange(a,b)")'],
  ])('a call %s stays as it is', async (_name, code, expected) => {
    expect(await format(code)).toBe(expected);
  });

  it('the outer call still expands, the string in it stays', async () => {
    expect(await format('arrange("stack(a,b)", s("hh"))')).toBe('arrange(\n  "stack(a,b)",\n  s("hh")\n)');
  });

  it.each([
    ['a string holding the same call', 's("stack(");\nstack(a, b)', 's("stack(");\nstack(\n  a,\n  b\n)'],
    ['a string with an escaped quote', 's("a\\"b");\nstack(a, b)', 's("a\\"b");\nstack(\n  a,\n  b\n)'],
  ])('a real call after %s still expands', async (_name, code, expected) => {
    expect(await format(code)).toBe(expected);
  });
});

describe('protectTokens', () => {
  it('restores exactly what it hid', () => {
    const code = 'a() /* x\n y */ // z\n  // alone\n"// str" // $1';
    const { code: hidden, restore, intact } = protectTokens(code);
    expect(hidden).not.toContain('x\n');
    expect(hidden).not.toContain('alone');
    expect(hidden).not.toContain('str');
    expect(intact(hidden)).toBe(true);
    expect(restore(hidden)).toBe(code);
  });

  it('a placeholder must not read as an identifier or a number', () => {
    expect(protectTokens('s("bd")// kick').code).not.toMatch(/\)[\w$]/);
  });

  it('notices a placeholder that was lost, broken or reordered', () => {
    const { code, intact } = protectTokens('// a\n// b');
    const [first, second] = code.split('\n');
    expect(intact(first)).toBe(false);
    expect(intact(`${second}\n${first}`)).toBe(false);
    expect(intact(code.replace('0', '0\n'))).toBe(false);
  });

  it('text that looks like a placeholder in live code is not taken for one', () => {
    const { code, intact } = protectTokens('let a = \uE0000\uE001 // c');
    expect(intact(code)).toBe(false);
  });

  it('text that looks like a placeholder in a comment comes back as it was', () => {
    const source = '// \uE0009\uE001';
    const { code, restore } = protectTokens(source);
    expect(restore(code)).toBe(source);
  });

  it('withoutTrailingComments keeps the code in front and everything else', () => {
    const { code } = protectTokens('stack( // drums /* more */');
    expect(withoutTrailingComments(code)).toBe('stack(');
    expect(withoutTrailingComments(protectTokens('// foo (').code)).toBe('');
    expect(withoutTrailingComments('stack(')).toBe('stack(');
  });
});
