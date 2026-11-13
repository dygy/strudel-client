/**
 * A track's listening-EQ recommendation (spec 024): one `// @eq-profile {json}` comment line in the
 * track's code, written by a generator (MIDI-grep) that measured how the track is best heard. Being a
 * comment, it never changes the sound. This module reads and validates it; the website shows it with
 * an Apply button. The reading rules are the contract with the producer (technical spec 024 §2.1).
 */

import { EQUALIZER_PRESETS } from './presets.js';
import { EQ_GAIN_LIMIT, EQ_Q_RANGE, HIGH_CUT_RANGE, LOW_CUT_RANGE, OUTPUT_GAIN_RANGE } from './AudioEqualizer.js';
import type { CutSettings } from './response.js';

/** The profile format version this reader understands. */
export const EQ_PROFILE_VERSION = 1;

/** The 10 band frequencies (Hz) a profile's bands must name, low to high (the EQ's own bands). */
export const EQ_PROFILE_FREQUENCIES: readonly number[] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** `why` and `basis` longer than this (characters) are cut and end in "…". */
export const EQ_PROFILE_TEXT_LIMIT = 300;

/** Two gains (or Q values, or output levels) closer than this count as the same setting. */
const SAME_TOLERANCE = 0.05;

/** A line comment at the start of a line: `// @eq-profile`, then whitespace or the end of the line. */
const PROFILE_LINE = /^\s*\/\/\s*@eq-profile(?:\s+(.*))?$/;

export interface EqProfileBand {
  frequency: number;
  gain: number;
  /** Only when the profile gives it; otherwise the band keeps its current Q. */
  Q?: number;
}

/** A validated recommendation. */
export interface EqProfile {
  /** A key of EQUALIZER_PRESETS, or null. */
  preset: string | null;
  /** The 10 bands, low to high, or null: then the preset is the whole recommendation. */
  bands: EqProfileBand[] | null;
  /** With bands: the low cut, or null for off. Without bands: null (the preset's own cut applies). */
  lowCut: (Partial<CutSettings> & { enabled: boolean }) | null;
  /** With bands: the high cut, or null for off. Without bands: null (the preset's own cut applies). */
  highCut: (Partial<CutSettings> & { enabled: boolean }) | null;
  /** With bands: dB (−24…+6). Without bands: the preset's output level. */
  outputGain: number;
  /** Why the generator recommends it, as written in the code. */
  why: string | null;
  /** What the generator measured, as written in the code. */
  basis: string | null;
}

export interface EqProfileParseResult {
  /** The recommendation, or null when there is none or it cannot be used. */
  profile: EqProfile | null;
  /** The profile line as found (null when the code has none): equal lines parse equally. */
  line: string | null;
  /** Why a profile line was ignored (or a part of it dropped); null when all is well. */
  warning: string | null;
}

/** The settings a recommendation applies (the shape the EQ panel saves). */
export interface ResolvedEqProfile {
  /** The preset the settings equal (the named one first), or 'custom'. */
  preset: string;
  bands: { frequency: number; gain: number; Q: number }[];
  lowCut: CutSettings;
  highCut: CutSettings;
  outputGain: number;
}

/** What resolveEqProfile needs from the EQ as it is now (cut frequencies and Q kept when unset). */
export interface CurrentEqSettings {
  bands: readonly { frequency: number; gain: number; Q: number }[];
  lowCut: CutSettings;
  highCut: CutSettings;
}

class ProfileError extends Error {}

const fail = (message: string): never => {
  throw new ProfileError(message);
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNumberIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const isPresetKey = (key: unknown): key is string =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(EQUALIZER_PRESETS, key);

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  // Counted in code points (as Python's len() counts), so an emoji is one character and is never split.
  const chars = Array.from(text);
  return chars.length > EQ_PROFILE_TEXT_LIMIT
    ? `${chars
        .slice(0, EQ_PROFILE_TEXT_LIMIT - 1)
        .join('')
        .trimEnd()}…`
    : text;
}

function readBands(value: unknown): EqProfileBand[] {
  if (!Array.isArray(value) || value.length !== EQ_PROFILE_FREQUENCIES.length) {
    return fail(`"bands" must be an array of ${EQ_PROFILE_FREQUENCIES.length} bands`);
  }
  const byFrequency = new Map<number, EqProfileBand>();
  for (const entry of value) {
    if (!isPlainObject(entry)) return fail('every band must be an object');
    const { frequency, gain, Q } = entry;
    if (typeof frequency !== 'number' || !EQ_PROFILE_FREQUENCIES.includes(frequency)) {
      return fail(`band frequency ${JSON.stringify(frequency)} is not one of ${EQ_PROFILE_FREQUENCIES.join(', ')}`);
    }
    if (byFrequency.has(frequency)) return fail(`band ${frequency} Hz is given twice`);
    if (!isNumberIn(gain, -EQ_GAIN_LIMIT, EQ_GAIN_LIMIT)) {
      return fail(`band ${frequency} Hz: gain must be a number from -${EQ_GAIN_LIMIT} to ${EQ_GAIN_LIMIT} dB`);
    }
    if (Q !== undefined && !isNumberIn(Q, EQ_Q_RANGE.min, EQ_Q_RANGE.max)) {
      return fail(`band ${frequency} Hz: Q must be a number from ${EQ_Q_RANGE.min} to ${EQ_Q_RANGE.max}`);
    }
    byFrequency.set(frequency, Q === undefined ? { frequency, gain } : { frequency, gain, Q: Q as number });
  }
  return EQ_PROFILE_FREQUENCIES.map((frequency) => byFrequency.get(frequency)!);
}

function readCut(value: unknown, name: 'lowCut' | 'highCut', range: { min: number; max: number }): EqProfile['lowCut'] {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value) || typeof value.enabled !== 'boolean') {
    return fail(`"${name}" must be null or {"enabled": true|false, "frequency": Hz}`);
  }
  const { enabled, frequency } = value;
  if ((frequency === undefined || frequency === null) && !enabled) return { enabled: false };
  if (!isNumberIn(frequency, range.min, range.max)) {
    return fail(`"${name}" frequency must be a number from ${range.min} to ${range.max} Hz`);
  }
  return { enabled, frequency };
}

/**
 * Reads the first `// @eq-profile {json}` line of `code` (spec 024). Rules, in order:
 * the first line that is a line comment starting with the token `@eq-profile` (only whitespace before
 * the `//`, whitespace or the line end after the token) is read, even if invalid; its rest must be
 * a JSON object with `"v": 1`; `preset` is null or a known preset key (an unknown one is dropped
 * with a warning); `bands`, when given, are exactly the 10 EQ bands (31 Hz … 16 kHz, each once, any
 * order) with gains in ±24 dB and an optional Q in 0.5–4; with bands, `lowCut`/`highCut` are null
 * or `{enabled, frequency}` in 20–1000 / 1000–20000 Hz and `outputGain` is in −24…+6 dB (absent =
 * off / 0 dB); without bands they are not read, the preset applies as picked; no bands and no known
 * preset is nothing to apply; `why`/`basis` are optional strings cut at 300 characters; other keys
 * are ignored. Out-of-range values are rejected, not clamped. Never throws.
 * @param code - A track's code
 * @returns The profile (or null), the line found, and a warning when the line was ignored or trimmed
 * @example
 * parseEqProfile('// @eq-profile {"v":1,"preset":"phonk"}\ns("bd")').profile?.preset // → 'phonk'
 */
export function parseEqProfile(code: string): EqProfileParseResult {
  if (typeof code !== 'string') return { profile: null, line: null, warning: null };
  let line: string | null = null;
  let payload = '';
  for (const raw of code.split('\n')) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const match = PROFILE_LINE.exec(text);
    if (match) {
      line = text;
      payload = (match[1] ?? '').trim();
      break;
    }
  }
  if (line === null) return { profile: null, line: null, warning: null };

  const warnings: string[] = [];
  try {
    if (payload === '') fail('no JSON after @eq-profile');
    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch (err) {
      fail(`not valid JSON (${(err as Error).message})`);
    }
    if (!isPlainObject(data)) fail('the JSON must be an object');
    const json = data as Record<string, unknown>;
    if (json.v !== EQ_PROFILE_VERSION) fail(`unknown version ${JSON.stringify(json.v)} (this reader knows v: 1)`);

    let preset: string | null = null;
    if (json.preset !== undefined && json.preset !== null) {
      if (isPresetKey(json.preset)) preset = json.preset;
      else warnings.push(`unknown preset ${JSON.stringify(json.preset)} ignored`);
    }

    const bands = json.bands === undefined || json.bands === null ? null : readBands(json.bands);
    if (!bands && !preset) fail('no bands and no known preset: nothing to apply');

    const profile: EqProfile = {
      preset,
      bands,
      lowCut: null,
      highCut: null,
      outputGain: preset && !bands ? (EQUALIZER_PRESETS[preset].outputGain ?? 0) : 0,
      why: readText(json.why),
      basis: readText(json.basis),
    };
    if (bands) {
      profile.lowCut = readCut(json.lowCut, 'lowCut', LOW_CUT_RANGE);
      profile.highCut = readCut(json.highCut, 'highCut', HIGH_CUT_RANGE);
      if (json.outputGain !== undefined && json.outputGain !== null) {
        if (!isNumberIn(json.outputGain, OUTPUT_GAIN_RANGE.min, OUTPUT_GAIN_RANGE.max)) {
          fail(`"outputGain" must be a number from ${OUTPUT_GAIN_RANGE.min} to ${OUTPUT_GAIN_RANGE.max} dB`);
        }
        profile.outputGain = json.outputGain as number;
      }
    }
    return { profile, line, warning: warnings.length ? warnings.join('; ') : null };
  } catch (err) {
    if (!(err instanceof ProfileError)) throw err;
    return { profile: null, line, warning: `ignored: ${[...warnings, err.message].join('; ')}` };
  }
}

const close = (a: number, b: number) => Math.abs(a - b) < SAME_TOLERANCE;

/** Whether `settings` equal preset `key`: its 10 gains, its cuts (on at its frequency, or off) and its output level. */
function equalsPreset(settings: Omit<ResolvedEqProfile, 'preset'>, key: string): boolean {
  const preset = EQUALIZER_PRESETS[key];
  if (!preset || preset.gains.length !== settings.bands.length) return false;
  if (!preset.gains.every((gain, i) => close(gain, settings.bands[i].gain))) return false;
  const cutMatches = (cut: CutSettings, frequency: number | null | undefined) =>
    frequency != null ? cut.enabled && close(cut.frequency, frequency) : !cut.enabled;
  return (
    cutMatches(settings.lowCut, preset.lowCut) &&
    cutMatches(settings.highCut, preset.highCut) &&
    close(settings.outputGain, preset.outputGain ?? 0)
  );
}

/**
 * The preset that EQ settings equal (gains within 0.05 dB, the same cuts on or off, the same output),
 * trying `preferred` first and then every preset in EQUALIZER_PRESETS order.
 * @param settings - Bands (low to high), cuts and output level
 * @param preferred - A preset key to try first (the one a profile names), or null
 * @returns The matching preset key, or null
 */
export function matchingPreset(
  settings: Omit<ResolvedEqProfile, 'preset'>,
  preferred: string | null = null,
): string | null {
  if (preferred && equalsPreset(settings, preferred)) return preferred;
  return Object.keys(EQUALIZER_PRESETS).find((key) => equalsPreset(settings, key)) ?? null;
}

/**
 * The settings a profile applies, from the EQ's current ones. With bands: the profile's gains (its Q,
 * else the band's current Q), its cuts (absent = off at the current frequency) and output (absent =
 * 0 dB). Without bands: the preset's values, exactly as picking it does (a preset without cuts turns
 * them off at their current frequency). `preset` is the preset they equal, or 'custom'.
 * @param profile - From parseEqProfile
 * @param current - The EQ's bands and cuts now
 */
export function resolveEqProfile(profile: EqProfile, current: CurrentEqSettings): ResolvedEqProfile {
  const currentQ = (i: number) => current.bands[i]?.Q ?? 1;
  let settings: Omit<ResolvedEqProfile, 'preset'>;
  if (profile.bands) {
    const cut = (value: EqProfile['lowCut'], now: CutSettings): CutSettings =>
      value ? { enabled: value.enabled, frequency: value.frequency ?? now.frequency } : { ...now, enabled: false };
    settings = {
      bands: profile.bands.map((band, i) => ({ frequency: band.frequency, gain: band.gain, Q: band.Q ?? currentQ(i) })),
      lowCut: cut(profile.lowCut, current.lowCut),
      highCut: cut(profile.highCut, current.highCut),
      outputGain: profile.outputGain,
    };
  } else {
    const preset = EQUALIZER_PRESETS[profile.preset!];
    settings = {
      bands: EQ_PROFILE_FREQUENCIES.map((frequency, i) => ({ frequency, gain: preset.gains[i], Q: currentQ(i) })),
      lowCut:
        preset.lowCut != null ? { enabled: true, frequency: preset.lowCut } : { ...current.lowCut, enabled: false },
      highCut:
        preset.highCut != null ? { enabled: true, frequency: preset.highCut } : { ...current.highCut, enabled: false },
      outputGain: preset.outputGain ?? 0,
    };
  }
  return { ...settings, preset: matchingPreset(settings, profile.preset) ?? 'custom' };
}

/**
 * Whether two EQ settings sound the same: gains and Q within 0.05, each cut on or off alike (and at the
 * same frequency when on), the same output level. The preset name is not compared.
 */
export function sameEqSettings(a: Omit<ResolvedEqProfile, 'preset'>, b: Omit<ResolvedEqProfile, 'preset'>): boolean {
  if (a.bands.length !== b.bands.length) return false;
  const bandsSame = a.bands.every((band, i) => close(band.gain, b.bands[i].gain) && close(band.Q, b.bands[i].Q));
  const cutSame = (x: CutSettings, y: CutSettings) =>
    x.enabled === y.enabled && (!x.enabled || close(x.frequency, y.frequency));
  return bandsSame && cutSame(a.lowCut, b.lowCut) && cutSame(a.highCut, b.highCut) && close(a.outputGain, b.outputGain);
}
