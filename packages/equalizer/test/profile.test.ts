/**
 * @spec: 024-track-eq-profile (functional §2.1, §2.3; tech §2.1)
 * parseEqProfile reads the first `// @eq-profile {json}` line by the producer contract: a line
 * comment at the start of a line, a JSON object with v 1, a known preset or null, exactly the 10
 * bands in range, cuts and output in range (rejected, not clamped), why/basis cut at 300 characters.
 * Anything it cannot use gives no profile and a warning, never an exception. resolveEqProfile turns
 * a profile into the settings Apply sets, and names the preset they equal.
 */
import { describe, it, expect } from 'vitest';
import {
  EQ_PROFILE_FREQUENCIES,
  EQUALIZER_PRESETS,
  getDefaultSettings,
  matchingPreset,
  parseEqProfile,
  resolveEqProfile,
  sameEqSettings,
} from '../index';

const bandsOf = (gains: number[], extra: Record<string, unknown> = {}) =>
  EQ_PROFILE_FREQUENCIES.map((frequency, i) => ({ frequency, gain: gains[i], ...extra }));
const line = (json: unknown) => `// @eq-profile ${typeof json === 'string' ? json : JSON.stringify(json)}`;
const codeWith = (json: unknown) => `setcps(0.5)\n${line(json)}\ns("bd*4")`;
const parse = (json: unknown) => parseEqProfile(codeWith(json));

const AUTOMOTIVO = EQUALIZER_PRESETS.automotivo;
const current = () => {
  const d = getDefaultSettings();
  return { bands: d.bands, lowCut: d.lowCut!, highCut: d.highCut! };
};

describe('parseEqProfile: the line', () => {
  it('uses the EQ band frequencies', () => {
    expect(EQ_PROFILE_FREQUENCIES).toEqual(getDefaultSettings().bands.map((b) => b.frequency));
  });

  it('reads a full profile from anywhere in the code', () => {
    const {
      profile,
      warning,
      line: found,
    } = parse({
      v: 1,
      preset: 'automotivo',
      bands: bandsOf([3.1, 2, 0, 0, 0, 0, 0, 0, 0, 0]),
      lowCut: null,
      highCut: { enabled: true, frequency: 14000 },
      outputGain: 0,
      basis: 'instrumental vs render',
      why: 'render is 4 dB light in the sub versus the original',
    });
    expect(warning).toBeNull();
    expect(found).toMatch(/^\/\/ @eq-profile \{/);
    expect(profile).toEqual({
      preset: 'automotivo',
      bands: bandsOf([3.1, 2, 0, 0, 0, 0, 0, 0, 0, 0]),
      lowCut: null,
      highCut: { enabled: true, frequency: 14000 },
      outputGain: 0,
      basis: 'instrumental vs render',
      why: 'render is 4 dB light in the sub versus the original',
    });
  });

  it('has no profile and no warning when there is no line', () => {
    expect(parseEqProfile('s("bd")')).toEqual({ profile: null, line: null, warning: null });
    expect(parseEqProfile('')).toEqual({ profile: null, line: null, warning: null });
    expect(parseEqProfile(undefined as unknown as string)).toEqual({ profile: null, line: null, warning: null });
  });

  it('accepts leading whitespace, no space after //, a CRLF line end', () => {
    expect(parseEqProfile('  //@eq-profile {"v":1,"preset":"phonk"}\r\ns("bd")').profile?.preset).toBe('phonk');
    expect(parseEqProfile('\t// @eq-profile   {"v":1,"preset":"phonk"}   ').profile?.preset).toBe('phonk');
  });

  it('ignores a trailing comment, a longer token and a block comment', () => {
    for (const code of [
      's("bd") // @eq-profile {"v":1,"preset":"phonk"}',
      '// @eq-profiles {"v":1,"preset":"phonk"}',
      '/* @eq-profile {"v":1,"preset":"phonk"} */',
      '// eq-profile {"v":1,"preset":"phonk"}',
    ]) {
      expect(parseEqProfile(code), code).toEqual({ profile: null, line: null, warning: null });
    }
  });

  it('reads only the first line, even when it is invalid', () => {
    const two = `${line({ v: 1, preset: 'phonk' })}\n${line({ v: 1, preset: 'trap' })}`;
    expect(parseEqProfile(two).profile?.preset).toBe('phonk');
    const brokenFirst = `${line('{oops')}\n${line({ v: 1, preset: 'trap' })}`;
    const result = parseEqProfile(brokenFirst);
    expect(result.profile).toBeNull();
    expect(result.warning).toMatch(/not valid JSON/);
  });
});

describe('parseEqProfile: malformed lines are ignored with a warning', () => {
  const cases: [string, unknown, RegExp][] = [
    ['no JSON', '', /no JSON/],
    ['broken JSON', '{"v":1,', /not valid JSON/],
    ['an array', '[1,2]', /must be an object/],
    ['null', 'null', /must be an object/],
    ['no version', { preset: 'phonk' }, /unknown version undefined/],
    ['version 2', { v: 2, preset: 'phonk' }, /unknown version 2/],
    ['version as a string', { v: '1', preset: 'phonk' }, /unknown version "1"/],
    ['nothing to apply', { v: 1 }, /nothing to apply/],
    ['unknown preset, no bands', { v: 1, preset: 'polka' }, /unknown preset "polka".*nothing to apply/],
    ['9 bands', { v: 1, bands: bandsOf([0, 0, 0, 0, 0, 0, 0, 0, 0]).slice(0, 9) }, /array of 10 bands/],
    ['11 bands', { v: 1, bands: [...bandsOf(Array(10).fill(0)), { frequency: 31, gain: 0 }] }, /array of 10/],
    ['bands not an array', { v: 1, bands: { 31: 3 } }, /array of 10/],
    ['a band not an object', { v: 1, bands: [...bandsOf(Array(9).fill(0)).slice(0, 9), 3] }, /must be an object/],
    [
      'an unknown frequency',
      { v: 1, bands: bandsOf(Array(10).fill(0)).map((b, i) => (i === 3 ? { ...b, frequency: 300 } : b)) },
      /frequency 300 is not one of/,
    ],
    [
      'a duplicate frequency',
      { v: 1, bands: bandsOf(Array(10).fill(0)).map((b, i) => (i === 3 ? { ...b, frequency: 31 } : b)) },
      /31 Hz is given twice/,
    ],
    ['a gain of +30 dB', { v: 1, bands: bandsOf([30, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }, /31 Hz: gain must be/],
    ['a gain of −24.5 dB', { v: 1, bands: bandsOf([0, 0, 0, 0, 0, 0, 0, 0, 0, -24.5]) }, /16000 Hz: gain/],
    ['a gain as a string', { v: 1, bands: bandsOf(['3', 0, 0, 0, 0, 0, 0, 0, 0, 0] as never) }, /gain must be/],
    ['a Q of 8', { v: 1, bands: bandsOf(Array(10).fill(0), { Q: 8 }) }, /Q must be/],
    [
      'a low cut at 5 Hz',
      { v: 1, bands: bandsOf(Array(10).fill(0)), lowCut: { enabled: true, frequency: 5 } },
      /"lowCut" frequency/,
    ],
    [
      'a high cut at 500 Hz',
      { v: 1, bands: bandsOf(Array(10).fill(0)), highCut: { enabled: true, frequency: 500 } },
      /"highCut" frequency/,
    ],
    [
      'a cut without enabled',
      { v: 1, bands: bandsOf(Array(10).fill(0)), lowCut: { frequency: 30 } },
      /"lowCut" must be null/,
    ],
    ['a cut as a number', { v: 1, bands: bandsOf(Array(10).fill(0)), highCut: 14000 }, /"highCut" must be null/],
    [
      'an enabled cut without frequency',
      { v: 1, bands: bandsOf(Array(10).fill(0)), lowCut: { enabled: true } },
      /"lowCut" frequency/,
    ],
    ['an output of +10 dB', { v: 1, bands: bandsOf(Array(10).fill(0)), outputGain: 10 }, /"outputGain" must be/],
    ['an output as a string', { v: 1, bands: bandsOf(Array(10).fill(0)), outputGain: '-3' }, /"outputGain" must be/],
  ];

  it.each(cases)('%s', (_name, json, warning) => {
    const result = parse(json);
    expect(result.profile).toBeNull();
    expect(result.line).not.toBeNull();
    expect(result.warning).toMatch(/^ignored: /);
    expect(result.warning).toMatch(warning);
  });
});

describe('parseEqProfile: what is kept', () => {
  it('drops an unknown preset with a warning but keeps the bands', () => {
    const result = parse({ v: 1, preset: 'polka', bands: bandsOf(Array(10).fill(1)) });
    expect(result.profile?.preset).toBeNull();
    expect(result.profile?.bands).toHaveLength(10);
    expect(result.warning).toBe('unknown preset "polka" ignored');
  });

  it('sorts bands given in any order, and keeps a Q only when given', () => {
    const bands = bandsOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).reverse();
    (bands[0] as Record<string, unknown>).Q = 2;
    const profile = parse({ v: 1, bands }).profile!;
    expect(profile.bands!.map((b) => b.frequency)).toEqual([...EQ_PROFILE_FREQUENCIES]);
    expect(profile.bands![9]).toEqual({ frequency: 16000, gain: 10, Q: 2 });
    expect(profile.bands![0]).toEqual({ frequency: 31, gain: 1 });
  });

  it('accepts the range edges', () => {
    const profile = parse({
      v: 1,
      bands: bandsOf([24, -24, 0, 0, 0, 0, 0, 0, 0, 0], { Q: 0.5 }),
      lowCut: { enabled: true, frequency: 1000 },
      highCut: { enabled: true, frequency: 20000 },
      outputGain: -24,
    }).profile!;
    expect(profile.bands![0].gain).toBe(24);
    expect(profile.lowCut).toEqual({ enabled: true, frequency: 1000 });
    expect(profile.outputGain).toBe(-24);
  });

  it('with bands: absent cuts and output are off and 0 dB; a cut may be off without a frequency', () => {
    const profile = parse({ v: 1, bands: bandsOf(Array(10).fill(0)), highCut: { enabled: false } }).profile!;
    expect(profile.lowCut).toBeNull();
    expect(profile.highCut).toEqual({ enabled: false });
    expect(profile.outputGain).toBe(0);
  });

  it('without bands: the cuts and output are not read, the preset applies', () => {
    const result = parse({ v: 1, preset: 'automotivo', lowCut: 'nonsense', outputGain: 99 });
    expect(result.warning).toBeNull();
    expect(result.profile).toMatchObject({ preset: 'automotivo', bands: null, lowCut: null, highCut: null });
    expect(result.profile!.outputGain).toBe(AUTOMOTIVO.outputGain);
  });

  it('keeps why and basis only as non-empty strings, trimmed and cut at 300 characters', () => {
    expect(parse({ v: 1, preset: 'phonk', why: '  sub light  ', basis: 42 }).profile).toMatchObject({
      why: 'sub light',
      basis: null,
    });
    expect(parse({ v: 1, preset: 'phonk', why: '   ' }).profile!.why).toBeNull();
    const why = parse({ v: 1, preset: 'phonk', why: 'x'.repeat(400) }).profile!.why!;
    expect(why).toHaveLength(300);
    expect(why.endsWith('…')).toBe(true);
  });

  it('counts why in code points: an emoji is one character and is never split', () => {
    const exact = 'x'.repeat(298) + '🔊🔊';
    expect(parse({ v: 1, preset: 'phonk', why: exact }).profile!.why).toBe(exact);
    const cut = parse({ v: 1, preset: 'phonk', why: 'x'.repeat(298) + '🔊'.repeat(5) }).profile!.why!;
    expect(Array.from(cut)).toHaveLength(300);
    expect(cut).toBe('x'.repeat(298) + '🔊…');
  });

  it('an off cut may have a null frequency', () => {
    const profile = parse({ v: 1, bands: bandsOf(Array(10).fill(0)), lowCut: { enabled: false, frequency: null } });
    expect(profile.warning).toBeNull();
    expect(profile.profile!.lowCut).toEqual({ enabled: false });
  });

  it('ignores keys it does not know', () => {
    expect(parse({ v: 1, preset: 'phonk', future: { a: 1 } }).warning).toBeNull();
  });
});

describe('resolveEqProfile and matchingPreset', () => {
  it('bands equal to Automotivo resolve to Automotivo', () => {
    const profile = parse({
      v: 1,
      preset: null,
      bands: bandsOf(AUTOMOTIVO.gains),
      lowCut: { enabled: true, frequency: AUTOMOTIVO.lowCut },
      outputGain: AUTOMOTIVO.outputGain,
    }).profile!;
    const resolved = resolveEqProfile(profile, current());
    expect(resolved.preset).toBe('automotivo');
    expect(resolved.lowCut).toEqual({ enabled: true, frequency: 25 });
    expect(resolved.highCut).toEqual({ enabled: false, frequency: 12000 });
  });

  it('bands equal to no preset resolve to custom, even when a preset is named', () => {
    const profile = parse({ v: 1, preset: 'automotivo', bands: bandsOf([3.1, 2, 0, 0, 0, 0, 0, 0, 0, 0]) }).profile!;
    expect(resolveEqProfile(profile, current()).preset).toBe('custom');
  });

  it('prefers the named preset when two presets are equal, else the first in order', () => {
    const flat = {
      bands: bandsOf(Array(10).fill(0)).map((b) => ({ ...b, Q: 1 })),
      lowCut: { enabled: false, frequency: 80 },
      highCut: { enabled: false, frequency: 12000 },
      outputGain: 0,
    };
    expect(matchingPreset(flat)).toBe('flat');
    expect(matchingPreset(flat, 'phonk')).toBe('flat');
  });

  it('a cut on at the wrong frequency, or the output off by 1 dB, is not the preset', () => {
    const base = resolveEqProfile(parse({ v: 1, preset: 'automotivo' }).profile!, current());
    expect(matchingPreset({ ...base, lowCut: { enabled: true, frequency: 30 } }, 'automotivo')).toBeNull();
    expect(matchingPreset({ ...base, outputGain: base.outputGain + 1 }, 'automotivo')).toBeNull();
  });

  it('preset only: the same settings as picking the preset (cuts off keep their frequency)', () => {
    const now = { ...current(), highCut: { enabled: true, frequency: 9000 } };
    const resolved = resolveEqProfile(parse({ v: 1, preset: 'automotivo' }).profile!, now);
    expect(resolved).toEqual({
      preset: 'automotivo',
      bands: bandsOf(AUTOMOTIVO.gains, { Q: 1 }),
      lowCut: { enabled: true, frequency: 25 },
      highCut: { enabled: false, frequency: 9000 },
      outputGain: -9,
    });
  });

  it('keeps the current Q and cut frequency where the profile gives none', () => {
    const now = current();
    now.bands = now.bands.map((b, i) => ({ ...b, Q: i === 2 ? 3 : 1 }));
    now.lowCut = { enabled: true, frequency: 40 };
    const profile = parse({ v: 1, bands: bandsOf(Array(10).fill(1)), lowCut: { enabled: false } }).profile!;
    const resolved = resolveEqProfile(profile, now);
    expect(resolved.bands[2].Q).toBe(3);
    expect(resolved.lowCut).toEqual({ enabled: false, frequency: 40 });
  });

  it('sameEqSettings: same within 0.05, different otherwise', () => {
    const a = resolveEqProfile(parse({ v: 1, preset: 'automotivo' }).profile!, current());
    expect(sameEqSettings(a, { ...a, bands: a.bands.map((b) => ({ ...b, gain: b.gain + 0.01 })) })).toBe(true);
    expect(
      sameEqSettings(a, { ...a, bands: a.bands.map((b, i) => ({ ...b, gain: b.gain + (i === 4 ? 1 : 0) })) }),
    ).toBe(false);
    expect(sameEqSettings(a, { ...a, highCut: { ...a.highCut, frequency: 5000 } })).toBe(true); // off: frequency moot
    expect(sameEqSettings(a, { ...a, lowCut: { ...a.lowCut, enabled: false } })).toBe(false);
    expect(sameEqSettings(a, { ...a, outputGain: 0 })).toBe(false);
  });
});
