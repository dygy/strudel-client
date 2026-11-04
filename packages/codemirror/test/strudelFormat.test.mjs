/**
 * The check on what the Strudel formatter returns. The formatter's rules only touch whitespace, so nothing known reaches
 * the first two checks from real code: they are tested here with a made-up output, and the parse and token checks with
 * real code as well in `website/src/repl/__tests__/formatEngine.oneFormatter.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { changesOnlyWhitespace, isStrudelCode } from '../strudelFormat.mjs';

describe('changesOnlyWhitespace', () => {
  it('whitespace between tokens may change', () => {
    expect(changesOnlyWhitespace('let a=1;\nfoo( x )', 'let a = 1;\n\nfoo(x)')).toBe(true);
  });

  it.each([
    ['a character', 'let a=1', 'let a=2'],
    ['a dropped trailing comma', 'foo(a, b,)', 'foo(a, b)'],
    ['a line separator turned into a space', 'a()\u2028b()', 'a() b()'],
    ['and so does code that does not parse', 'foo(\nlet a', 'foo(\nlet b'],
  ])('%s is more than whitespace', (_name, input, output) => {
    expect(changesOnlyWhitespace(input, output)).toBe(false);
  });

  it.each([
    ['whitespace in a string', 's("a  b")', 's("a b")'],
    ['whitespace in a comment', 'x // a  b', 'x // a b'],
    ['whitespace in a block comment', '/* a\n  b */ x', '/* a\n b */ x'],
    ['the order of strings', 'f("a b", "c d"', 'f("c d", "a b"'],
  ])('%s, even if the code does not parse', (_name, input, output) => {
    expect(changesOnlyWhitespace(`(${input}`, `(${output}`)).toBe(false);
  });

  it('code that parsed must still parse', () => {
    expect(changesOnlyWhitespace('let r=/\\)x/', 'let r=/\\)\nx/')).toBe(false);
  });

  it('code that parsed must keep its tokens', () => {
    expect(changesOnlyWhitespace('x=/a=b/', 'x=/a = b/')).toBe(false);
  });

  it('the output must parse, whatever the input did', () => {
    expect(changesOnlyWhitespace('foo()let x', 'foo()\nlet x')).toBe(true);
    expect(changesOnlyWhitespace('foo(let x', 'foo(\nlet x')).toBe(false);
  });

  it('unchanged code is fine, parsing or not', () => {
    expect(changesOnlyWhitespace('foo(let x', 'foo(let x')).toBe(true);
  });

  it('a track parses: labels, top-level await, import and return do not switch the check off', () => {
    const track = 'import z from "z"\n$: s("a")\nawait x;\n$: s("b")\nlet r=/\\)x/\nreturn 1';
    expect(changesOnlyWhitespace(track, track.replace('\\)x', '\\)\nx'))).toBe(false);
  });
});

describe('isStrudelCode', () => {
  it.each([['s("bd")'], ['stack(a)'], ['arrange(a)'], ['x.stack(a)'], ['setcps(1)'], ['$: x'], ['x.lpf(1)']])(
    '%s is',
    (code) => {
      expect(isStrudelCode(code)).toBe(true);
    },
  );

  it('plain code is not', () => {
    expect(isStrudelCode('let a = 1')).toBe(false);
  });
});
