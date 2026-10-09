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

  // FINDING (spec 015 §4): loadEqualizerSettings only checks "an array of 10"
  // (packages/equalizer/persistence.ts:58), so right-shaped but damaged bands are returned as-is.
  // The panel then calls band.gain on each (website/src/repl/components/panel/EqualizerUI.tsx:38):
  // a null band throws a TypeError in the mount effect, and gain "abc" reaches
  // AudioEqualizer.setBand as NaN (AudioEqualizer.ts:182-183), which a real AudioParam
  // rejects as non-finite. Criterion: damaged settings → EQ starts flat, app keeps working.
  it.fails.each([
    ['ten null bands', JSON.stringify({ isEnabled: true, preset: 'x', bands: Array(10).fill(null) })],
    [
      'ten bands with gain "abc"',
      JSON.stringify({
        isEnabled: true,
        preset: 'x',
        bands: getDefaultSettings().bands.map((b) => ({ ...b, gain: 'abc' })),
      }),
    ],
  ])('damaged saved settings with the right shape (%s) fall back to a flat EQ', (_label, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);

    expect(() => loadEqualizerSettings()).not.toThrow();
    const onLoad = settingsOnLoad();
    expect(onLoad.bands.every((b) => b !== null && typeof b === 'object' && Number.isFinite(b.gain))).toBe(true);
    expect(isFlat(onLoad)).toBe(true);
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
