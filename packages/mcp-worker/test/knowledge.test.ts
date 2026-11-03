/**
 * @spec: 018-strudel-mcp-server (slice 6)
 * Looking things up and checking code. Nothing here reaches the network, and nothing is ever run.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { checkCode, closestNames, distance } from '../src/check';
import { CHECK_MAX_BYTES } from '../src/knowledge';
import known from '../src/generated/known.json';
import { tunes } from './tunesFixture';
import { fakeLibrary, toolCaller } from './fakeLibrary';

const NAMES = new Set(known as string[]);
let tools: ReturnType<typeof toolCaller>;

beforeEach(() => {
  const library = fakeLibrary();
  // Nothing reaches the library or the site from these tools.
  library.upstream = ((url: string) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user-1', email: 'a@b.test' }));
    throw new Error(`reached ${url}`);
  }) as typeof library.upstream;
  tools = toolCaller(library);
});

describe('lookup_function', () => {
  it("answers with what the site's reference says", async () => {
    const { structured } = await tools.call('lookup_function', { name: 'lpf' });
    expect(structured.name).toBe('lpf');
    expect(structured.synonyms).toContain('cutoff');
    expect(structured.description).toBeTruthy();
    expect((structured.examples as string[]).length).toBeGreaterThan(0);
  });

  it('holds no markup in descriptions', async () => {
    const { structured } = await tools.call('lookup_function', { name: 'lpf' });
    expect(structured.description).not.toMatch(/<[a-z]/i);
  });

  it('answers a name it does not have with the closest ones', async () => {
    const { error } = await tools.call('lookup_function', { name: 'lowpas' });
    expect(error.code).toBe('not_found');
    expect(error.closest).toContain('lpf');
  });
});

describe('search_functions', () => {
  it('finds by a word in the description, with names first and a summary', async () => {
    const { structured } = await tools.call('search_functions', { query: 'filter' });
    const list = structured.functions as Array<{ name: string; summary: string }>;
    expect(list.length).toBeGreaterThan(1);
    expect(list[0].name.toLowerCase()).toContain('filter');
    expect(list[0].summary).toBeTruthy();
  });

  it('pages to the end with each function once', async () => {
    const seen: string[] = [];
    let offset: number | null = 0;
    do {
      const { structured }: { structured: Record<string, never> } = await tools.call('search_functions', {
        query: 'a',
        offset,
      });
      seen.push(...(structured.functions as Array<{ name: string }>).map((doc) => doc.name));
      offset = structured.nextOffset;
    } while (offset !== null);
    expect(seen.length).toBeGreaterThan(50);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('holds no code samples in a list', async () => {
    const { structured } = await tools.call('search_functions', { query: 'filter' });
    expect(structured.functions[0]).not.toHaveProperty('examples');
  });
});

describe('list_sounds', () => {
  const names = async (args: Record<string, unknown>) =>
    ((await tools.call('list_sounds', args)).structured.sounds as Array<{ name: string }>).map((s) => s.name);

  it('has the synths, including the noises', async () => {
    expect(await names({ kind: 'synths' })).toEqual(expect.arrayContaining(['sawtooth', 'sine', 'white', 'pink']));
  });

  it('has the sample names and the drum machines', async () => {
    expect(await names({ kind: 'samples', query: 'piano' })).toContain('piano');
    expect((await names({ kind: 'drumMachines' })).length).toBeGreaterThan(20);
  });

  it('pages to the end with each sound once', async () => {
    const seen: string[] = [];
    let offset: number | null = 0;
    do {
      const { structured }: { structured: Record<string, never> } = await tools.call('list_sounds', { offset });
      seen.push(...(structured.sounds as Array<{ name: string; kind: string }>).map((s) => `${s.kind}:${s.name}`));
      offset = structured.nextOffset;
    } while (offset !== null);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(200);
  });
});

describe('the check', () => {
  it('passes good code', () => {
    expect(checkCode('s("bd [sd cp]*2 <hh rim>").lpf(200).room(0.5)', NAMES)).toEqual({
      ok: true,
      errors: [],
      warnings: [],
    });
  });

  it('finds a syntax mistake, with line and column', () => {
    const { ok, errors } = checkCode('s("bd")\n  .lpf(200', NAMES);
    expect(ok).toBe(false);
    expect(errors[0]).toMatchObject({ kind: 'syntax', line: 2 });
    expect(errors[0].column).toBeGreaterThan(1);
    expect(errors[0].message).not.toMatch(/\(\d+:\d+\)$/);
  });

  it.each(['s("bd [sd")', 's("bd sd]")', 's("<bd sd")', 's(`bd [sd`)'])('finds unbalanced brackets in %s', (code) => {
    const { ok, errors } = checkCode(code, NAMES);
    expect(ok).toBe(false);
    expect(errors[0]).toMatchObject({ kind: 'mini', line: 1 });
  });

  it('places a mini-notation mistake on the line of the string', () => {
    const { errors } = checkCode('note("c e")\n  .s("bd [sd")', NAMES);
    expect(errors[0]).toMatchObject({ kind: 'mini', line: 2 });
    expect(errors[0].column).toBeGreaterThan(5);
  });

  it('leaves alone what the transpiler leaves alone', () => {
    const code = [
      `const a = 'single [ quote'`,
      'const b = String.raw`tagged [ template`',
      'samples("https://x.test/[a].json")',
      'const c = {"key [": 1}',
    ].join('\n');
    expect(checkCode(code, NAMES).errors).toEqual([]);
  });

  it('warns about a name that does not exist, and suggests the real one', () => {
    const { ok, warnings } = checkCode('s("bd").lpff(200)', NAMES);
    expect(ok).toBe(true);
    expect(warnings[0]).toMatchObject({ kind: 'unknown_function', suggestion: 'lpf', line: 1, column: 9 });
  });

  it.each([
    ['lowpas', 'lpf'],
    ['lowpass', 'lpf'],
    ['highpass', 'hpf'],
  ])('sends .%s( to the real name, %s', (name, suggestion) => {
    expect(checkCode(`s("bd").${name}(200)`, NAMES).warnings[0].suggestion).toBe(suggestion);
  });

  it('warns about bare calls too, and each name once', () => {
    const { warnings } = checkCode('nott("c")\nnott("d")', NAMES);
    expect(warnings.map((warning) => warning.line)).toEqual([1]);
  });

  it('offers no suggestion when nothing is close', () => {
    const { warnings } = checkCode('s("bd").qqqqqqqqqqq()', NAMES);
    expect(warnings[0].suggestion).toBeUndefined();
  });

  it('knows names the code gives itself: declared, registered, parameters and assigned', () => {
    const code = [
      'const mine = (x) => x',
      'function other(f) { return f(1) }',
      "register('custom', (a, pat) => pat)",
      'Pattern.prototype.extra = function () { return this }',
      'const box = { held() {} }',
      'mine(1); other(mine); s("bd").custom(1).extra(); box.held()',
    ].join('\n');
    expect(checkCode(code, NAMES).warnings).toEqual([]);
  });

  it('knows setcps, the JS built-ins and the methods on them', () => {
    const code = 'setcps(1); const a = [1, 2].map((x) => Math.floor(x)).join(" "); console.log(a.toString())';
    expect(checkCode(code, NAMES).warnings).toEqual([]);
  });

  it('never runs anything', () => {
    (globalThis as { ran?: boolean }).ran = false;
    const result = checkCode('globalThis.ran = true; (() => { globalThis.ran = true })()', NAMES);
    expect((globalThis as { ran?: boolean }).ran).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('caps warnings, however many names are wrong', () => {
    const code = Array.from({ length: 100 }, (_, i) => `q${i}x${i}x()`).join(';');
    expect(checkCode(code, NAMES).warnings.length).toBeLessThanOrEqual(25);
  });

  it("finds nothing wrong in the site's own example tunes", () => {
    const entries = Object.entries(tunes);
    expect(entries.length).toBeGreaterThan(20);
    const problems = entries.flatMap(([name, code]) => {
      const { errors, warnings } = checkCode(code, NAMES);
      return [...errors, ...warnings].map((p) => `${name}:${p.line}: ${p.message}`);
    });
    expect(problems).toEqual([]);
  });
});

describe('distance', () => {
  it('counts edits, and stops counting past the limit', () => {
    expect(distance('lpf', 'lpf')).toBe(0);
    expect(distance('lpff', 'lpf')).toBe(1);
    expect(distance('abcdefgh', 'zzzzzzzz')).toBe(3);
  });

  it('puts the nearest name first', () => {
    expect(closestNames('lpff', ['hpf', 'lpf', 'lpq'], 1)).toEqual(['lpf']);
  });
});

describe('check_code', () => {
  it('answers with the check', async () => {
    const { structured } = await tools.call('check_code', { code: 's("bd [sd")' });
    expect(structured.ok).toBe(false);
  });

  it('takes code of exactly the limit, and answers one byte more with use_local_helper', async () => {
    const atLimit = `s("bd")//${'x'.repeat(CHECK_MAX_BYTES - 9)}`;
    expect((await tools.call('check_code', { code: atLimit })).isError).toBeUndefined();
    const { error } = await tools.call('check_code', { code: `${atLimit}x` });
    expect(error.code).toBe('use_local_helper');
    expect(error.next).toContain('@dygy/strudel-mcp');
  });
});
