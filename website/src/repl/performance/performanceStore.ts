/**
 * The performance view's state (spec 030 §2.1, §2.2; tech §2.1).
 *
 * - `performanceOpen`: whether the view is open. Not persisted: after a reload the REPL opens in its
 *   normal view.
 * - `performanceFontSize`: the code's size in the view, 16–64 px in steps of 4, default 28,
 *   remembered across reloads. The normal view's `fontSize` setting is never touched.
 */
import { atom } from 'nanostores';
import { persistentAtom } from '@nanostores/persistent';

export const PERFORMANCE_FONT_MIN = 16;
export const PERFORMANCE_FONT_MAX = 64;
export const PERFORMANCE_FONT_STEP = 4;
export const PERFORMANCE_FONT_DEFAULT = 28;
export const PERFORMANCE_FONT_STORAGE_KEY = 'strudel-performance-font-size';

export const performanceOpen = atom<boolean>(false);

export function openPerformance(): void {
  performanceOpen.set(true);
}

export function closePerformance(): void {
  performanceOpen.set(false);
}

export function togglePerformance(): void {
  performanceOpen.set(!performanceOpen.get());
}

/**
 * The stored font size, as written (a string in localStorage). Read it through readPerformanceFontSize.
 * `listen: false`: no cross-tab sync (not needed for a view size). With it on, the store adds `storage`/
 * `pageshow` listeners on window while subscribed and removes them on a 1 s unmount timer, which fired
 * after jsdom teardown in tests (`window is not defined`, an unhandled error that fails the run).
 */
export const performanceFontSize = persistentAtom<string>(
  PERFORMANCE_FONT_STORAGE_KEY,
  String(PERFORMANCE_FONT_DEFAULT),
  { listen: false },
);

/**
 * A stored value as a valid size: clamped to 16–64 and snapped to the 4 px grid. Junk, a missing
 * value or a non-finite number reads as the default (28).
 */
export function clampPerformanceFontSize(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return PERFORMANCE_FONT_DEFAULT;
  const snapped =
    PERFORMANCE_FONT_MIN + Math.round((value - PERFORMANCE_FONT_MIN) / PERFORMANCE_FONT_STEP) * PERFORMANCE_FONT_STEP;
  return Math.min(PERFORMANCE_FONT_MAX, Math.max(PERFORMANCE_FONT_MIN, snapped));
}

/** The view's font size in px. Storage that throws reads as the default. */
export function readPerformanceFontSize(): number {
  try {
    return clampPerformanceFontSize(performanceFontSize.get());
  } catch (error: unknown) {
    console.warn('[performance] font size unreadable, using the default', error);
    return PERFORMANCE_FONT_DEFAULT;
  }
}

/** A+ (+1) or A− (−1): one 4 px step, within the bounds. Returns the new size. */
export function stepPerformanceFontSize(direction: 1 | -1): number {
  const current = readPerformanceFontSize();
  const next = clampPerformanceFontSize(current + direction * PERFORMANCE_FONT_STEP);
  if (next === current) return current;
  try {
    performanceFontSize.set(String(next));
  } catch (error: unknown) {
    // Storage refused the write (private mode, quota): keep the size we had.
    console.warn('[performance] font size not saved', error);
    return current;
  }
  return next;
}
