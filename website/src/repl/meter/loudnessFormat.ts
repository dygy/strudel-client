/**
 * Pure display rules of the loudness meter (spec 033 functional §2.2, §2.5, §2.6): number formatting,
 * the Short-term colour against the target, bar positions and the warning text. No DOM, no audio.
 */
import type { LoudnessOverReason } from '@strudel/mixer';
import type { LoudnessWarning } from './loudnessRuntime';

/** What silence (or no reading) shows. */
export const LOUDNESS_SILENCE = '—';
/** The strips' loudness bar: −36…0 LUFS. */
export const STRIP_BAR_RANGE = Object.freeze({ min: -36, max: 0 });
/** The panel's peak / RMS bars: −60…0 dBFS. */
export const LEVEL_BAR_RANGE = Object.freeze({ min: -60, max: 0 });
/** Short-term louder than target + this (LU) is amber. */
export const LOUD_OVER_TARGET_LU = 2;
/** Short-term quieter than target − this (LU) is dimmed. */
export const QUIET_UNDER_TARGET_LU = 6;

export type ShortTermTone = 'neutral' | 'loud' | 'quiet';

/**
 * The Short-term number's colour (§2.5): amber above target + 2 LU, dimmed below target − 6 LU,
 * otherwise neutral; always neutral with the target off or no reading.
 */
export function shortTermTone(shortTerm: number | null | undefined, target: number | null | undefined): ShortTermTone {
  if (typeof target !== 'number' || typeof shortTerm !== 'number' || !Number.isFinite(shortTerm)) return 'neutral';
  if (shortTerm > target + LOUD_OVER_TARGET_LU) return 'loud';
  if (shortTerm < target - QUIET_UNDER_TARGET_LU) return 'quiet';
  return 'neutral';
}

/** A reading with one decimal in the language's digits, or "—" for silence. */
export function formatReading(value: number | null | undefined, language?: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return LOUDNESS_SILENCE;
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat(language || undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  } catch (error: unknown) {
    format = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  // −0.0 reads as 0.0.
  const rounded = Math.round(value * 10) / 10;
  return format.format(rounded === 0 ? 0 : rounded);
}

/** A value as a percentage of a bar's range, clamped; silence is 0 %. */
export function toPercent(value: number | null | undefined, range: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const pct = ((value - range.min) / (range.max - range.min)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** The translation key of each over reason. */
export const REASON_KEYS: Readonly<Record<LoudnessOverReason, string>> = Object.freeze({
  truePeak: 'meter.reasonTruePeak',
  limiter: 'meter.reasonLimiter',
  clip: 'meter.reasonClip',
});

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The true-peak limit as shown inside a sentence: "−1 dBTP" in a left-to-right isolate (U+2066 … U+2069),
 * so in Hebrew and Arabic the minus stays before the 1 and the unit after it.
 */
export const TRUE_PEAK_LIMIT_TEXT = '\u2066−1 dBTP\u2069';

/** An over reason's name, e.g. "True peak over −1 dBTP". */
export function reasonLabel(t: Translate, reason: LoudnessOverReason): string {
  return t(REASON_KEYS[reason], { limit: TRUE_PEAK_LIMIT_TEXT });
}

/**
 * The warning light's text (§2.4): the reasons seen with their counts and "click to clear" while lit,
 * e.g. "Limiter working (3×) — click to clear"; the no-warning text while dark.
 */
export function warningText(
  t: Translate,
  warning: LoudnessWarning,
  events: Partial<Record<LoudnessOverReason, number>> | null | undefined,
): string {
  if (!warning.lit) return t('meter.warningNone');
  const reasons = warning.reasons
    .map((reason) => t('meter.reasonCount', { reason: reasonLabel(t, reason), count: events?.[reason] ?? 0 }))
    .join(', ');
  return t('meter.warningTitle', { reasons });
}
