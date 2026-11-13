/**
 * @spec: 020-eq-strong-control (functional §2.6, tech §2.3)
 * Saved EQ settings with the new optional fields: cuts and output level round-trip, ±24 dB bands
 * load, saves from before spec 020 load as they were (cuts off, output 0 dB), and a present but
 * invalid new field is damage: the EQ starts flat.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  applyEqualizerSettings,
  getDefaultSettings,
  loadEqualizerSettings,
  saveEqualizerSettings,
  type EqualizerSettings,
} from '../persistence';
import { AudioEqualizer } from '../AudioEqualizer';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext, createMemoryStorage, stubWebAudio, unstubWebAudio } from '../../mixer/test/webAudioMock.mjs';

const STORAGE_KEY = 'strudel-equalizer-settings';
const oldBands = () => getDefaultSettings().bands.map((b, i) => ({ ...b, gain: i - 4 }));
/** Exactly what the panel saved before spec 020. */
const oldSave = () => ({ isEnabled: true, preset: 'rock', bands: oldBands() });

beforeEach(() => {
  stubWebAudio();
  vi.stubGlobal('localStorage', createMemoryStorage());
});
afterEach(() => unstubWebAudio());

describe('EQ persistence with cuts and output level (spec 020)', () => {
  it('defaults are flat with both cuts off and output 0 dB', () => {
    expect(getDefaultSettings()).toMatchObject({
      lowCut: { enabled: false, frequency: 80 },
      highCut: { enabled: false, frequency: 12000 },
      outputGain: 0,
    });
  });

  it('a band at +20 dB, the low cut at 80 Hz and the output at −6 dB round-trip', () => {
    const saved: EqualizerSettings = {
      ...getDefaultSettings(),
      preset: 'custom',
      bands: getDefaultSettings().bands.map((b, i) => ({ ...b, gain: i === 0 ? 20 : -24 + i })),
      lowCut: { enabled: true, frequency: 80 },
      highCut: { enabled: true, frequency: 15000 },
      outputGain: -6,
    };
    saveEqualizerSettings(saved);

    expect(loadEqualizerSettings()).toEqual(saved);
  });

  it('a save from before spec 020 loads with the same bands, both cuts off and output 0 dB', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(oldSave()));

    const loaded = loadEqualizerSettings();

    expect(loaded).toMatchObject(oldSave());
    expect(loaded?.bands).toEqual(oldBands());
    expect(loaded).toMatchObject({
      lowCut: { enabled: false },
      highCut: { enabled: false },
      outputGain: 0,
    });
  });

  it('a save from before spec 020 sounds as before once applied (no cut, unity output)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(oldSave()));
    const eq = new AudioEqualizer(new MockAudioContext() as unknown as AudioContext);

    applyEqualizerSettings(eq, loadEqualizerSettings()!);

    const state = eq.getState();
    expect(state.bands.map((b) => b.gain)).toEqual(oldBands().map((b) => b.gain));
    expect(state).toMatchObject({ lowCut: { enabled: false }, highCut: { enabled: false }, outputGain: 0 });
  });

  it('applying settings works without the new fields (old callers), as cuts off and output 0 dB', () => {
    const eq = new AudioEqualizer(new MockAudioContext() as unknown as AudioContext);
    eq.applyPreset('driftPhonk');

    applyEqualizerSettings(eq, { isEnabled: true, bands: oldBands() });

    expect(eq.getState()).toMatchObject({ lowCut: { enabled: false }, highCut: { enabled: false }, outputGain: 0 });
  });

  it('applying settings saved as off keeps the cuts silent until switched on', () => {
    const eq = new AudioEqualizer(new MockAudioContext() as unknown as AudioContext);
    applyEqualizerSettings(eq, {
      ...getDefaultSettings(),
      isEnabled: false,
      lowCut: { enabled: true, frequency: 300 },
      outputGain: -12,
    });

    const stages = (eq as any).lowCutFilters;
    expect(stages.map((f: any) => f.frequency.value)).toEqual([10, 10]);
    eq.setEnabled(true);
    expect(stages.map((f: any) => f.frequency.value)).toEqual([300, 300]);
  });

  it.each([
    ['a band at ±24 dB', 24, true],
    ['a band at −24 dB', -24, true],
    ['a band at +24.5 dB', 24.5, false],
  ])('%s: accepted = %s', (_label, gain, accepted) => {
    const bands = oldBands().map((b, i) => (i === 0 ? { ...b, gain } : b));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...oldSave(), bands }));

    expect(loadEqualizerSettings() !== null).toBe(accepted);
  });

  it.each([
    ['a low cut below 20 Hz', { lowCut: { enabled: true, frequency: 10 } }],
    ['a low cut above 1 kHz', { lowCut: { enabled: false, frequency: 1500 } }],
    ['a high cut below 1 kHz', { highCut: { enabled: true, frequency: 500 } }],
    ['a high cut above 20 kHz', { highCut: { enabled: true, frequency: 22000 } }],
    ['a cut with a string on/off', { lowCut: { enabled: 'true', frequency: 80 } }],
    ['a cut with no frequency', { highCut: { enabled: true } }],
    ['a cut that is null', { lowCut: null }],
    ['an output level above +6 dB', { outputGain: 7 }],
    ['an output level below −24 dB', { outputGain: -30 }],
    ['an output level that is a string', { outputGain: '-6' }],
  ])('damaged new fields (%s) make the EQ start flat', (_label, patch) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...oldSave(), ...patch }));

    expect(() => loadEqualizerSettings()).not.toThrow();
    expect(loadEqualizerSettings()).toBeNull();
  });
});
