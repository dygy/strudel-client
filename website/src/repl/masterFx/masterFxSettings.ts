/**
 * Master FX settings (spec 032 §2.2–§2.4, tech §2.5): what the panel remembers in this browser, under
 * localStorage `strudel-master-fx`. The choices, ranges, defaults and the sanitiser have one source of
 * truth, @strudel/mixer's masterfx/masterFxSettings.mjs (the stage sanitises with the same code); this
 * module re-exports them and adds what only the website needs: reading and writing the stored copy, the
 * knob's whole-step clamp and side, and fraction labels.
 *
 * An out-of-range, missing or garbage value falls back to its default, field by field, so a damaged save
 * never reaches the audio stage. The filter knob's position is not here: it is never stored (every load
 * starts centred, §2.2).
 */
import {
  MASTER_FX_DEFAULTS,
  MASTER_FX_DELAY_FRACTIONS,
  MASTER_FX_FILTER_DEAD_ZONE,
  MASTER_FX_RANGES,
  MASTER_FX_REPEAT_LENGTHS,
  MASTER_FX_STORAGE_KEY,
  nextRepeatLength,
  sanitizeMasterFxSettings,
  type MasterFxSettings,
} from '@strudel/mixer';

export {
  MASTER_FX_DEFAULTS,
  MASTER_FX_DELAY_FRACTIONS,
  MASTER_FX_FILTER_DEAD_ZONE,
  MASTER_FX_RANGES,
  MASTER_FX_REPEAT_LENGTHS,
  MASTER_FX_STORAGE_KEY,
  nextRepeatLength,
  sanitizeMasterFxSettings,
  type MasterFxSettings,
};

/** The settings stored in `storage`, sanitised; the defaults when there are none or they are damaged. */
export function readMasterFxSettings(storage: Pick<Storage, 'getItem'> | null | undefined): MasterFxSettings {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(MASTER_FX_STORAGE_KEY) ?? null;
  } catch (error: unknown) {
    raw = null;
  }
  if (raw === null) return sanitizeMasterFxSettings(null);
  try {
    return sanitizeMasterFxSettings(JSON.parse(raw));
  } catch (error: unknown) {
    return sanitizeMasterFxSettings(null);
  }
}

/** Store the settings (sanitised). A full or unavailable storage is warned about, never thrown. */
export function writeMasterFxSettings(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  settings: MasterFxSettings,
): void {
  try {
    storage?.setItem(MASTER_FX_STORAGE_KEY, JSON.stringify(sanitizeMasterFxSettings(settings)));
  } catch (error: unknown) {
    console.warn('[masterFx] could not store the settings:', error);
  }
}

/**
 * The knob position −100..100 in whole steps (the knob's own grid), from anything; non-numbers are the
 * centre. The stage's clampFilterPosition (filterCurve.mjs) clamps without rounding.
 */
export function clampFilterPosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const { min, max } = MASTER_FX_RANGES.filter;
  return Math.round(Math.max(min, Math.min(max, value)));
}

/** Which side the knob is on: 'off' in the dead zone, 'lp' left of it, 'hp' right of it. */
export function filterSide(position: number): 'off' | 'lp' | 'hp' {
  if (Math.abs(position) <= MASTER_FX_FILTER_DEAD_ZONE) return 'off';
  return position < 0 ? 'lp' : 'hp';
}

/** A fraction of a cycle as text: 3/16, 1/4, … (numbers stay left-to-right in RTL via <bdi>). */
export function fractionLabel(value: number): string {
  for (const denominator of [1, 2, 4, 8, 16]) {
    const numerator = value * denominator;
    if (Math.abs(numerator - Math.round(numerator)) < 1e-9) return `${Math.round(numerator)}/${denominator}`;
  }
  return String(value);
}
