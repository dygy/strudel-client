/**
 * Regression (2026-10-10): the store keeps at most 5 toasts. Toasts trimmed off that list never
 * went through removeToast, so their de-duplication key stayed "active" forever and any later
 * toast with the same key (custom id, or type + title) was silently blocked for the session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toastActions, toastsStore } from '../toastStore';

const titles = () => toastsStore.get().map((t) => t.title);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  toastActions.clearAllToasts();
});

afterEach(() => {
  toastActions.clearAllToasts();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('toasts pushed off the visible list', () => {
  it('a toast with a custom id can show again after it was trimmed off by 5 newer toasts', () => {
    toastActions.warning('Transition failed', undefined, undefined, 'smooth-transition-error');
    for (let i = 1; i <= 5; i++) toastActions.info(`Other ${i}`);
    expect(titles()).not.toContain('Transition failed');

    vi.advanceTimersByTime(4000); // past the 3 s "recent duplicate" window
    toastActions.warning('Transition failed', undefined, undefined, 'smooth-transition-error');

    expect(titles()).toContain('Transition failed');
  });

  it('a toast without a custom id (same type and title) can show again after being trimmed', () => {
    toastActions.error('Import failed');
    for (let i = 1; i <= 5; i++) toastActions.info(`Other ${i}`);
    expect(titles()).not.toContain('Import failed');

    vi.advanceTimersByTime(4000);
    toastActions.error('Import failed');

    expect(titles()).toContain('Import failed');
  });

  it('never shows more than 5 toasts at once', () => {
    for (let i = 1; i <= 8; i++) toastActions.info(`Toast ${i}`);

    expect(titles()).toEqual(['Toast 4', 'Toast 5', 'Toast 6', 'Toast 7', 'Toast 8']);
  });
});

describe('de-duplication still works for toasts that are on screen', () => {
  it('a duplicate of a visible toast is not shown twice, even after the 3 s window', () => {
    toastActions.warning('Transition failed', undefined, undefined, 'smooth-transition-error');
    vi.advanceTimersByTime(4000);

    toastActions.warning('Transition failed', undefined, undefined, 'smooth-transition-error');

    expect(titles().filter((t) => t === 'Transition failed')).toHaveLength(1);
  });

  it('after a visible toast is dismissed, the same toast can show again', () => {
    const id = toastActions.warning('Transition failed', undefined, undefined, 'smooth-transition-error');
    toastActions.removeToast(id as string);
    vi.advanceTimersByTime(4000);

    toastActions.warning('Transition failed', undefined, undefined, 'smooth-transition-error');

    expect(titles()).toEqual(['Transition failed']);
  });
});
