/**
 * EQ settings persistence (spec 015 §2.2): reload round trip, damaged data falls back flat.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveEqualizerSettings, loadEqualizerSettings, getDefaultSettings } from '../persistence';
import type { EqualizerSettings } from '../persistence';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { createMemoryStorage } from '../../mixer/test/webAudioMock.mjs';

const STORAGE_KEY = 'strudel-equalizer-settings';

function shaped(): EqualizerSettings {
  const s = getDefaultSettings();
  s.preset = 'custom';
  s.isEnabled = false;
  s.bands = s.bands.map((b, i) => ({ ...b, gain: i - 5, Q: 1 + i / 10 }));
  return s;
}

/** The fallback the EQ panel uses on load (EqualizerUI: `loadEqualizerSettings() || getDefaultSettings()`). */
const settingsOnLoad = () => loadEqualizerSettings() ?? getDefaultSettings();
// A real, non-flat curve: damaged settings built on it must not survive the loader.
const shapedBands = () => getDefaultSettings().bands.map((b, i) => ({ ...b, gain: i - 4 }));
const withBand0 = (patch: Record<string, unknown>) => shapedBands().map((b, i) => (i === 0 ? { ...b, ...patch } : b));
const isFlat = (s: EqualizerSettings) => s.bands.length === 10 && s.bands.every((b) => b.gain === 0);

describe('EQ persistence (spec 015 §2.2)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a shaped EQ is restored with the same band values after a reload', () => {
    const saved = shaped();
    saveEqualizerSettings(saved);

    expect(loadEqualizerSettings()).toEqual(saved);
  });

  it('with nothing saved, load returns null and the EQ starts flat', () => {
    expect(loadEqualizerSettings()).toBeNull();
    expect(isFlat(settingsOnLoad())).toBe(true);
  });

  it.each([
    ['unparseable JSON', '{not json'],
    ['JSON null', 'null'],
    ['a non-object', '42'],
    ['bands missing', JSON.stringify({ isEnabled: true, preset: 'x' })],
    ['bands not an array', JSON.stringify({ isEnabled: true, preset: 'x', bands: 'loud' })],
    ['wrong band count', JSON.stringify({ isEnabled: true, preset: 'x', bands: [{ frequency: 31, gain: 9, Q: 1 }] })],
  ])('damaged saved settings (%s) fall back to a flat EQ without throwing', (_label, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);

    expect(() => loadEqualizerSettings()).not.toThrow();
    expect(loadEqualizerSettings()).toBeNull();
    expect(isFlat(settingsOnLoad())).toBe(true);
  });

  // Regression (spec 015 finding 7, fixed 2026-10-09): the loader only checked for an array of
  // 10, so right-shaped but damaged bands reached the panel (null band → TypeError on mount;
  // non-numeric gain → NaN into the audio graph).
  it.each([
    ['ten null bands', JSON.stringify({ isEnabled: true, preset: 'x', bands: Array(10).fill(null) })],
    [
      'ten bands with gain "abc"',
      JSON.stringify({
        isEnabled: true,
        preset: 'x',
        bands: getDefaultSettings().bands.map((b) => ({ ...b, gain: 'abc' })),
      }),
    ],
    [
      'a band with a non-finite Q',
      JSON.stringify({
        isEnabled: true,
        preset: 'x',
        bands: shapedBands().map((b, i) => (i === 3 ? { ...b, Q: null } : b)),
      }),
    ],
    ['a non-boolean on/off flag', JSON.stringify({ isEnabled: 'yes', preset: 'x', bands: shapedBands() })],
    [
      'a band missing its frequency',
      JSON.stringify({
        isEnabled: true,
        preset: 'x',
        bands: shapedBands().map((b, i) => (i === 2 ? { gain: b.gain, Q: b.Q } : b)),
      }),
    ],
    ['a gain beyond +12 dB', JSON.stringify({ isEnabled: true, preset: 'x', bands: withBand0({ gain: 50 }) })],
    ['a zero frequency', JSON.stringify({ isEnabled: true, preset: 'x', bands: withBand0({ frequency: 0 }) })],
    ['a Q of 0', JSON.stringify({ isEnabled: true, preset: 'x', bands: withBand0({ Q: 0 }) })],
  ])('damaged saved settings with the right shape (%s) fall back to a flat EQ', (_label, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);

    expect(() => loadEqualizerSettings()).not.toThrow();
    expect(loadEqualizerSettings()).toBeNull();
    const onLoad = settingsOnLoad();
    expect(onLoad.bands.every((b) => b !== null && typeof b === 'object' && Number.isFinite(b.gain))).toBe(true);
    expect(isFlat(onLoad)).toBe(true);
  });

  it('an unknown preset name is shown as a custom curve, and the bands are kept', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ isEnabled: true, preset: 'no-such-preset', bands: shapedBands() }),
    );

    const loaded = loadEqualizerSettings();

    expect(loaded?.preset).toBe('custom');
    expect(loaded?.bands).toEqual(shapedBands());
  });

  it('a known preset name and a saved custom curve are kept as they are', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ isEnabled: true, preset: 'rock', bands: shapedBands() }));
    expect(loadEqualizerSettings()?.preset).toBe('rock');

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ isEnabled: true, preset: 'custom', bands: shapedBands() }));
    expect(loadEqualizerSettings()?.preset).toBe('custom');
  });

  it('a localStorage that throws on read or write does not break the app', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });

    expect(() => saveEqualizerSettings(shaped())).not.toThrow();
    expect(loadEqualizerSettings()).toBeNull();
  });
});
