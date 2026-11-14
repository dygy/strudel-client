/**
 * @spec: 028-eq-named-presets (functional §2, tech §1)
 * Named user presets: names (trimmed, 1–40), save / overwrite / rename / delete, the 50 limit,
 * sorting, damaged entries skipped, and the `user:` preset name surviving the settings loader.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  USER_PRESETS_STORAGE_KEY,
  USER_PRESET_LIMIT,
  deleteUserPreset,
  loadUserPresets,
  renameUserPreset,
  saveUserPreset,
  userPresetName,
  userPresetValue,
  validateName,
} from '../userPresets';
import { getDefaultSettings, validateEqualizerSettings } from '../persistence';
import type { EqualizerSettings } from '../persistence';
import * as api from '../index';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { createMemoryStorage } from '../../mixer/test/webAudioMock.mjs';

const tuned = (offset = 0, patch: Partial<EqualizerSettings> = {}): EqualizerSettings => ({
  ...getDefaultSettings(),
  preset: 'custom',
  bands: getDefaultSettings().bands.map((b, i) => ({ ...b, gain: i - 4 + offset, Q: 1.5 })),
  lowCut: { enabled: true, frequency: 40 },
  highCut: { enabled: true, frequency: 14000 },
  outputGain: -4.5,
  isEnabled: false,
  ...patch,
});
const stored = () => JSON.parse(localStorage.getItem(USER_PRESETS_STORAGE_KEY) ?? 'null');
const names = () => loadUserPresets().map((p) => p.name);

describe('EQ user presets (spec 028)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('are exported from the package, under the key strudel-eq-user-presets', () => {
    expect(api.loadUserPresets).toBe(loadUserPresets);
    expect(api.saveUserPreset).toBe(saveUserPreset);
    expect(api.renameUserPreset).toBe(renameUserPreset);
    expect(api.deleteUserPreset).toBe(deleteUserPreset);
    expect(api.validateName).toBe(validateName);
    expect(api.USER_PRESETS_STORAGE_KEY).toBe('strudel-eq-user-presets');
    expect(USER_PRESET_LIMIT).toBe(50);
  });

  it('names are trimmed and 1–40 characters', () => {
    expect(validateName('  Phonk car  ')).toBe('Phonk car');
    expect(validateName('')).toBeNull();
    expect(validateName('    ')).toBeNull();
    expect(validateName('x'.repeat(40))).toBe('x'.repeat(40));
    expect(validateName('x'.repeat(41))).toBeNull();
    expect(validateName(42)).toBeNull();
    // Characters, not UTF-16 units: 40 emoji fit.
    expect(validateName('🎧'.repeat(40))).toBe('🎧'.repeat(40));
  });

  it('save then load gives back exactly the settings: bands, cuts, output and on/off', () => {
    const settings = tuned();
    const result = saveUserPreset(' Phonk car ', settings);
    expect(result.ok).toBe(true);
    const [preset] = loadUserPresets();
    expect(preset.name).toBe('Phonk car');
    const { preset: presetName, ...rest } = preset.settings;
    const { preset: _ignored, ...expected } = settings;
    expect(rest).toEqual(expected);
    expect(presetName).toBe('user:Phonk car');
  });

  it('a saved preset does not share objects with the settings it was saved from', () => {
    const settings = tuned();
    saveUserPreset('A', settings);
    settings.bands[0].gain = 20;
    expect(loadUserPresets()[0].settings.bands[0].gain).toBe(-4);
  });

  it('an empty or too long name, or damaged settings, are refused', () => {
    expect(saveUserPreset('  ', tuned())).toEqual({ ok: false, reason: 'invalid' });
    expect(saveUserPreset('x'.repeat(41), tuned())).toEqual({ ok: false, reason: 'invalid' });
    expect(saveUserPreset('Bad', { ...tuned(), bands: [] })).toEqual({ ok: false, reason: 'invalid' });
    expect(stored()).toBeNull();
  });

  it('a name in use (ignoring case) is refused unless overwrite is asked for', () => {
    saveUserPreset('Phonk car', tuned(0));
    expect(saveUserPreset('phonk CAR', tuned(1))).toEqual({ ok: false, reason: 'taken' });
    expect(loadUserPresets()[0].settings.bands[0].gain).toBe(-4);

    const result = saveUserPreset('Phonk car', tuned(1), { overwrite: true });
    expect(result.ok).toBe(true);
    expect(names()).toEqual(['Phonk car']);
    expect(loadUserPresets()[0].settings.bands[0].gain).toBe(-3);
  });

  it('the 51st preset is refused; overwriting one at the limit still works', () => {
    for (let i = 0; i < USER_PRESET_LIMIT; i++) expect(saveUserPreset(`P${i}`, tuned()).ok).toBe(true);
    expect(saveUserPreset('One too many', tuned())).toEqual({ ok: false, reason: 'full' });
    expect(loadUserPresets()).toHaveLength(USER_PRESET_LIMIT);
    expect(saveUserPreset('P7', tuned(2), { overwrite: true }).ok).toBe(true);
    expect(loadUserPresets()).toHaveLength(USER_PRESET_LIMIT);
  });

  it('presets are listed sorted by name, ignoring case', () => {
    saveUserPreset('zouk', tuned());
    saveUserPreset('Bass', tuned());
    saveUserPreset('acid', tuned());
    expect(names()).toEqual(['acid', 'Bass', 'zouk']);
    const result = saveUserPreset('Mid', tuned());
    expect(result.ok && result.presets.map((p) => p.name)).toEqual(['acid', 'Bass', 'Mid', 'zouk']);
  });

  it('rename keeps the settings, survives a reload, and refuses a taken or invalid name', () => {
    saveUserPreset('Old', tuned(3));
    saveUserPreset('Other', tuned());
    expect(renameUserPreset('Old', 'other')).toEqual({ ok: false, reason: 'taken' });
    expect(renameUserPreset('Old', '   ')).toEqual({ ok: false, reason: 'invalid' });
    expect(renameUserPreset('Nope', 'X')).toEqual({ ok: false, reason: 'missing' });

    expect(renameUserPreset('Old', ' New ').ok).toBe(true);
    const presets = loadUserPresets();
    expect(presets.map((p) => p.name)).toEqual(['New', 'Other']);
    expect(presets[0].settings.bands[0].gain).toBe(-1);
    expect(presets[0].settings.preset).toBe('user:New');
  });

  it('rename can change only the case, and can overwrite another preset when asked', () => {
    saveUserPreset('phonk', tuned(1));
    saveUserPreset('Other', tuned(5));
    expect(renameUserPreset('phonk', 'Phonk').ok).toBe(true);
    expect(names()).toEqual(['Other', 'Phonk']);
    expect(renameUserPreset('Phonk', 'other', { overwrite: true }).ok).toBe(true);
    const presets = loadUserPresets();
    expect(presets.map((p) => p.name)).toEqual(['other']);
    expect(presets[0].settings.bands[0].gain).toBe(-3);
  });

  it('delete removes the preset for good', () => {
    saveUserPreset('A', tuned());
    saveUserPreset('B', tuned());
    expect(deleteUserPreset('A').ok).toBe(true);
    expect(names()).toEqual(['B']);
    expect(deleteUserPreset('A')).toEqual({ ok: false, reason: 'missing' });
  });

  it('a damaged entry is skipped and the valid ones still load', () => {
    const good = { name: 'Good', settings: tuned() };
    localStorage.setItem(
      USER_PRESETS_STORAGE_KEY,
      JSON.stringify([
        null,
        'text',
        { name: '', settings: tuned() },
        { name: 'No settings' },
        { name: 'Loud', settings: { ...tuned(), bands: tuned().bands.map((b) => ({ ...b, gain: 90 })) } },
        { name: 'Bad cut', settings: { ...tuned(), lowCut: { enabled: 'yes', frequency: 40 } } },
        good,
        { name: 'good', settings: tuned(1) },
      ]),
    );
    const presets = loadUserPresets();
    expect(presets.map((p) => p.name)).toEqual(['Good']);
    expect(presets[0].settings.bands[0].gain).toBe(-4);
  });

  it('unreadable storage loads no presets and does not throw', () => {
    localStorage.setItem(USER_PRESETS_STORAGE_KEY, '{not json');
    expect(loadUserPresets()).toEqual([]);
    localStorage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify({ name: 'x' }));
    expect(loadUserPresets()).toEqual([]);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadUserPresets()).toEqual([]);
  });

  it('more than 50 stored entries load only the first 50', () => {
    localStorage.setItem(
      USER_PRESETS_STORAGE_KEY,
      JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ name: `P${i}`, settings: tuned() }))),
    );
    expect(loadUserPresets()).toHaveLength(50);
  });

  it('picker values are prefixed user: and read back', () => {
    expect(userPresetValue('Phonk car')).toBe('user:Phonk car');
    expect(userPresetName('user:Phonk car')).toBe('Phonk car');
    expect(userPresetName('phonk')).toBeNull();
    expect(userPresetName('user:')).toBeNull();
  });

  it('a slot whose preset is a user preset keeps that name through the settings loader', () => {
    expect(validateEqualizerSettings({ ...tuned(), preset: 'user:Phonk car' })?.preset).toBe('user:Phonk car');
    expect(validateEqualizerSettings({ ...tuned(), preset: 'no-such-preset' })?.preset).toBe('custom');
  });
});
