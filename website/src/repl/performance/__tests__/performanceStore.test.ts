// @vitest-environment jsdom
/**
 * @spec: 030-performance-mode (2.1 not remembered, 2.2 font size; tech §2.1)
 * The view's open state toggles and is not persisted; the font size is 16–64 px in steps of 4,
 * default 28, remembered, and junk or a storage that throws reads as 28.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage` that shadows jsdom's (see CompactLayout.test.tsx).
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import {
  clampPerformanceFontSize,
  closePerformance,
  openPerformance,
  performanceFontSize,
  performanceOpen,
  PERFORMANCE_FONT_STORAGE_KEY,
  readPerformanceFontSize,
  stepPerformanceFontSize,
  togglePerformance,
} from '../performanceStore';

afterEach(() => {
  vi.restoreAllMocks();
  performanceOpen.set(false);
  performanceFontSize.set('28');
});

describe('performanceOpen', () => {
  it('starts closed; open, close and toggle', () => {
    expect(performanceOpen.get()).toBe(false);
    openPerformance();
    expect(performanceOpen.get()).toBe(true);
    closePerformance();
    expect(performanceOpen.get()).toBe(false);
    togglePerformance();
    expect(performanceOpen.get()).toBe(true);
    togglePerformance();
    expect(performanceOpen.get()).toBe(false);
  });

  it('is never written to storage (a reload opens the normal view)', () => {
    const before = JSON.stringify({ ...localStorage });
    openPerformance();
    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });
});

describe('the font size', () => {
  it('clamps to 16–64 and snaps to steps of 4; junk and a missing value read 28', () => {
    expect(clampPerformanceFontSize('28')).toBe(28);
    expect(clampPerformanceFontSize('40')).toBe(40);
    expect(clampPerformanceFontSize('30')).toBe(32);
    expect(clampPerformanceFontSize('29')).toBe(28);
    expect(clampPerformanceFontSize('4')).toBe(16);
    expect(clampPerformanceFontSize('500')).toBe(64);
    expect(clampPerformanceFontSize(44)).toBe(44);
    for (const junk of ['junk', '', '  ', undefined, null, 'NaN', 'Infinity', {}, true]) {
      expect(clampPerformanceFontSize(junk)).toBe(28);
    }
  });

  it('defaults to 28', () => {
    expect(readPerformanceFontSize()).toBe(28);
  });

  it('A+ three times from 28 is 40, and it is remembered in storage', () => {
    stepPerformanceFontSize(1);
    stepPerformanceFontSize(1);
    expect(stepPerformanceFontSize(1)).toBe(40);
    expect(readPerformanceFontSize()).toBe(40);
    // The persistent atom holds what it wrote to storage. (Under isolate:false the storage engine is
    // whichever localStorage the module first saw, so the key is checked on the atom, not on jsdom's.)
    expect(performanceFontSize.get()).toBe('40');
    expect(PERFORMANCE_FONT_STORAGE_KEY).toBe('strudel-performance-font-size');
  });

  it('never goes above 64 or below 16', () => {
    for (let i = 0; i < 20; i++) stepPerformanceFontSize(1);
    expect(readPerformanceFontSize()).toBe(64);
    for (let i = 0; i < 20; i++) stepPerformanceFontSize(-1);
    expect(readPerformanceFontSize()).toBe(16);
  });

  it('a stored junk value reads 28 and steps from 28', () => {
    performanceFontSize.set('big');
    expect(readPerformanceFontSize()).toBe(28);
    expect(stepPerformanceFontSize(-1)).toBe(24);
  });

  it('a storage that throws reads 28, and a refused write keeps the size', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const get = vi.spyOn(performanceFontSize, 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readPerformanceFontSize()).toBe(28);
    get.mockRestore();
    vi.spyOn(performanceFontSize, 'set').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(stepPerformanceFontSize(1)).toBe(28);
  });
});
