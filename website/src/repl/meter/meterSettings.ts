/**
 * Loudness meter settings (spec 033 functional §2.6, §2.7; tech §2.3): what this browser remembers.
 *
 * - `strudel-loudness-meter`: `{ on, target }`. `on` (default true) installs the meter; `target` is
 *   −14 (streaming, the default), −23 (broadcast, EBU R128), −9 (club) or null (Off). Sanitised field
 *   by field on load, so a damaged save falls back to the default instead of reaching the UI.
 * - `strudel-eq-spectrum-pre`: the EQ's Before EQ spectrum layer, 'true' / 'false', off when absent
 *   (the spec 026 Spectrum toggle's pattern).
 *
 * Nothing is stored on the server; no track, editor or save path is touched.
 */

/** localStorage key of the meter's on/off and target. */
export const LOUDNESS_METER_STORAGE_KEY = 'strudel-loudness-meter';
/** localStorage key of the EQ's Before EQ spectrum toggle: 'true' / 'false', off when absent. */
export const EQ_SPECTRUM_PRE_STORAGE_KEY = 'strudel-eq-spectrum-pre';

/** The targets offered, LUFS, in display order. */
export const LOUDNESS_TARGETS = Object.freeze([-14, -23, -9] as const);
export type LoudnessTarget = (typeof LOUDNESS_TARGETS)[number];

export interface LoudnessMeterSettings {
  /** Whether the meter is installed and shown. */
  on: boolean;
  /** The loudness target, LUFS; null is Off. */
  target: LoudnessTarget | null;
}

export const LOUDNESS_METER_DEFAULTS: Readonly<LoudnessMeterSettings> = Object.freeze({ on: true, target: -14 });

type ReadStorage = Pick<Storage, 'getItem'> | null | undefined;
type WriteStorage = Pick<Storage, 'setItem'> | null | undefined;

const isTarget = (value: unknown): value is LoudnessTarget =>
  typeof value === 'number' && (LOUDNESS_TARGETS as readonly number[]).includes(value);

/** Settings from anything: each unknown or damaged field falls back to its default. */
export function sanitizeLoudnessMeterSettings(raw: unknown): LoudnessMeterSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const on = typeof source.on === 'boolean' ? source.on : LOUDNESS_METER_DEFAULTS.on;
  let target: LoudnessTarget | null = LOUDNESS_METER_DEFAULTS.target;
  if (source.target === null) target = null;
  else if (isTarget(source.target)) target = source.target;
  return { on, target };
}

/** The stored settings, sanitised; the defaults when there are none or they are damaged. */
export function readLoudnessMeterSettings(storage: ReadStorage): LoudnessMeterSettings {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(LOUDNESS_METER_STORAGE_KEY) ?? null;
  } catch (error: unknown) {
    raw = null;
  }
  if (raw === null) return sanitizeLoudnessMeterSettings(null);
  try {
    return sanitizeLoudnessMeterSettings(JSON.parse(raw));
  } catch (error: unknown) {
    return sanitizeLoudnessMeterSettings(null);
  }
}

/** Store the settings (sanitised). A full or unavailable storage is warned about, never thrown. */
export function writeLoudnessMeterSettings(storage: WriteStorage, settings: LoudnessMeterSettings): void {
  try {
    storage?.setItem(LOUDNESS_METER_STORAGE_KEY, JSON.stringify(sanitizeLoudnessMeterSettings(settings)));
  } catch (error: unknown) {
    console.warn('[loudness] could not store the settings:', error);
  }
}

/** Whether the Before EQ spectrum layer is on (off when absent or unreadable). */
export function readSpectrumPreOn(storage: ReadStorage): boolean {
  try {
    return storage?.getItem(EQ_SPECTRUM_PRE_STORAGE_KEY) === 'true';
  } catch (error: unknown) {
    return false;
  }
}

/** Remember the Before EQ toggle; an unavailable storage leaves it working for this session. */
export function writeSpectrumPreOn(storage: WriteStorage, on: boolean): void {
  try {
    storage?.setItem(EQ_SPECTRUM_PRE_STORAGE_KEY, on ? 'true' : 'false');
  } catch (error: unknown) {
    console.warn('[loudness] could not store the Before EQ toggle:', error);
  }
}

/** localStorage, or null where it is missing or blocked. */
export function browserStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (error: unknown) {
    return null;
  }
}
