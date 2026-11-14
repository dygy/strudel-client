/**
 * @spec: 026-eq-listening-tools (functional §2.1, tech §2.1)
 * A/B slots: load, save (the active slot also under the legacy key), migration from legacy settings,
 * validation fallback per slot, switch, edit of the active slot only, and copy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EQ_SLOTS_STORAGE_KEY,
  copyActiveEqualizerSlot,
  loadEqualizerSlots,
  otherEqualizerSlot,
  saveEqualizerSlots,
  switchEqualizerSlot,
  updateActiveEqualizerSlot,
} from '../slots';
import { getDefaultSettings, loadEqualizerSettings, saveEqualizerSettings } from '../persistence';
import type { EqualizerSettings } from '../persistence';
import * as api from '../index';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { createMemoryStorage } from '../../mixer/test/webAudioMock.mjs';

const LEGACY_KEY = 'strudel-equalizer-settings';

const shaped = (offset: number, patch: Partial<EqualizerSettings> = {}): EqualizerSettings => ({
  ...getDefaultSettings(),
  preset: 'custom',
  bands: getDefaultSettings().bands.map((b, i) => ({ ...b, gain: i - offset })),
  ...patch,
});
const phonk = (): EqualizerSettings => ({
  ...getDefaultSettings(),
  preset: 'phonk',
  bands: getDefaultSettings().bands.map((b, i) => ({ ...b, gain: [12, 10, 3, -2, -3, 0, 4, 5, 1, -2][i] })),
  highCut: { enabled: true, frequency: 13000 },
  outputGain: -6,
});

describe('EQ A/B slots (spec 026)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('are exported from the package', () => {
    expect(api.loadEqualizerSlots).toBe(loadEqualizerSlots);
    expect(api.saveEqualizerSlots).toBe(saveEqualizerSlots);
    expect(api.copyActiveEqualizerSlot).toBe(copyActiveEqualizerSlot);
    expect(api.EQ_SLOTS_STORAGE_KEY).toBe('strudel-eq-slots');
  });

  it('with nothing saved, both slots are the defaults and A is active', () => {
    const slots = loadEqualizerSlots();
    expect(slots).toEqual({ active: 'A', A: getDefaultSettings(), B: getDefaultSettings() });
    expect(slots.A).not.toBe(slots.B);
  });

  it('settings saved before spec 026 load into A, and B starts as a copy', () => {
    const legacy = shaped(4, { isEnabled: false });
    saveEqualizerSettings(legacy);

    const slots = loadEqualizerSlots();
    expect(slots.active).toBe('A');
    expect(slots.A).toEqual(legacy);
    expect(slots.B).toEqual(legacy);
    expect(slots.B.bands).not.toBe(slots.A.bands);
  });

  it('round-trips both slots and the active one through a reload', () => {
    const slots = { active: 'B' as const, A: getDefaultSettings(), B: phonk() };
    saveEqualizerSlots(slots);
    expect(loadEqualizerSlots()).toEqual(slots);
  });

  it('saving also writes the active slot under the legacy key (mainEqualizer and PreviewEngine read it)', () => {
    saveEqualizerSlots({ active: 'B', A: getDefaultSettings(), B: phonk() });
    expect(loadEqualizerSettings()).toEqual(phonk());

    saveEqualizerSlots({ active: 'A', A: shaped(2), B: phonk() });
    expect(loadEqualizerSettings()).toEqual(shaped(2));
  });

  it('a damaged slot becomes a copy of the good one; the active slot is kept', () => {
    const bad = { ...shaped(0), bands: [{ frequency: 31, gain: 99, Q: 1 }] };
    localStorage.setItem(EQ_SLOTS_STORAGE_KEY, JSON.stringify({ active: 'B', A: phonk(), B: bad }));
    expect(loadEqualizerSlots()).toEqual({ active: 'B', A: phonk(), B: phonk() });

    localStorage.setItem(EQ_SLOTS_STORAGE_KEY, JSON.stringify({ active: 'A', A: 'loud', B: shaped(3) }));
    expect(loadEqualizerSlots()).toEqual({ active: 'A', A: shaped(3), B: shaped(3) });
  });

  it('both slots damaged: both are the defaults', () => {
    localStorage.setItem(EQ_SLOTS_STORAGE_KEY, JSON.stringify({ active: 'B', A: null, B: { isEnabled: 'yes' } }));
    expect(loadEqualizerSlots()).toEqual({ active: 'B', A: getDefaultSettings(), B: getDefaultSettings() });
  });

  it('an unreadable record or an unknown active slot falls back (legacy settings; A active)', () => {
    saveEqualizerSettings(shaped(1));
    localStorage.setItem(EQ_SLOTS_STORAGE_KEY, '{not json');
    expect(loadEqualizerSlots()).toEqual({ active: 'A', A: shaped(1), B: shaped(1) });

    localStorage.setItem(EQ_SLOTS_STORAGE_KEY, JSON.stringify({ active: 'C', A: phonk(), B: shaped(1) }));
    expect(loadEqualizerSlots().active).toBe('A');
  });

  it('an unknown preset name in a slot loads as custom (the settings validator)', () => {
    localStorage.setItem(
      EQ_SLOTS_STORAGE_KEY,
      JSON.stringify({ active: 'A', A: { ...phonk(), preset: 'nope' }, B: phonk() }),
    );
    expect(loadEqualizerSlots().A.preset).toBe('custom');
  });

  it('switching changes only which slot is active', () => {
    const slots = { active: 'A' as const, A: getDefaultSettings(), B: phonk() };
    const next = switchEqualizerSlot(slots, 'B');
    expect(next).toEqual({ ...slots, active: 'B' });
    expect(switchEqualizerSlot(next, 'A')).toEqual(slots);
    expect(otherEqualizerSlot('A')).toBe('B');
    expect(otherEqualizerSlot('B')).toBe('A');
  });

  it('an edit goes to the active slot only', () => {
    const slots = { active: 'B' as const, A: getDefaultSettings(), B: phonk() };
    const edited = updateActiveEqualizerSlot(slots, shaped(5));
    expect(edited.B).toEqual(shaped(5));
    expect(edited.A).toEqual(getDefaultSettings());
    expect(slots.B).toEqual(phonk()); // the input is not mutated
  });

  it('copy writes the active slot into the other one (A→B while A is active, B→A while B is)', () => {
    const slots = { active: 'A' as const, A: phonk(), B: getDefaultSettings() };
    const copied = copyActiveEqualizerSlot(slots);
    expect(copied).toEqual({ active: 'A', A: phonk(), B: phonk() });
    expect(copied.B.bands).not.toBe(copied.A.bands);

    const back = copyActiveEqualizerSlot({ active: 'B', A: phonk(), B: shaped(2) });
    expect(back).toEqual({ active: 'B', A: shaped(2), B: shaped(2) });
  });

  it('a repaired slot is written back, and the legacy key gets the active slot (review 026)', () => {
    const bad = { ...shaped(0), bands: [{ frequency: 31, gain: 99, Q: 1 }] };
    localStorage.setItem(EQ_SLOTS_STORAGE_KEY, JSON.stringify({ active: 'B', A: phonk(), B: bad }));
    localStorage.setItem(LEGACY_KEY, JSON.stringify(bad));
    expect(loadEqualizerSettings()).toBeNull(); // what mainEqualizer / PreviewEngine read at install: flat

    loadEqualizerSlots();
    // Every reader now agrees, before any panel opens.
    expect(loadEqualizerSettings()).toEqual(phonk());
    expect(JSON.parse(localStorage.getItem(EQ_SLOTS_STORAGE_KEY)!)).toEqual({ active: 'B', A: phonk(), B: phonk() });
  });

  it('an unknown active slot or an unreadable record is written back repaired', () => {
    localStorage.setItem(EQ_SLOTS_STORAGE_KEY, JSON.stringify({ active: 'C', A: phonk(), B: shaped(1) }));
    loadEqualizerSlots();
    expect(JSON.parse(localStorage.getItem(EQ_SLOTS_STORAGE_KEY)!).active).toBe('A');
    expect(loadEqualizerSettings()).toEqual(phonk());

    saveEqualizerSettings(shaped(2));
    localStorage.setItem(EQ_SLOTS_STORAGE_KEY, '{not json');
    loadEqualizerSlots();
    expect(JSON.parse(localStorage.getItem(EQ_SLOTS_STORAGE_KEY)!)).toEqual({
      active: 'A',
      A: shaped(2),
      B: shaped(2),
    });
  });

  it('a migration from legacy settings is written as slots; nothing saved writes nothing', () => {
    loadEqualizerSlots();
    expect(localStorage.getItem(EQ_SLOTS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

    saveEqualizerSettings(shaped(4));
    loadEqualizerSlots();
    expect(JSON.parse(localStorage.getItem(EQ_SLOTS_STORAGE_KEY)!)).toEqual({
      active: 'A',
      A: shaped(4),
      B: shaped(4),
    });
  });

  it('valid slots are not rewritten on load', () => {
    saveEqualizerSlots({ active: 'B', A: getDefaultSettings(), B: phonk() });
    const setItem = vi.spyOn(localStorage, 'setItem');
    loadEqualizerSlots();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('a repair that storage refuses to save does not throw', () => {
    const bad = { ...shaped(0), bands: [] };
    const record = JSON.stringify({ active: 'B', A: phonk(), B: bad });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === EQ_SLOTS_STORAGE_KEY ? record : null),
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(loadEqualizerSlots()).toEqual({ active: 'B', A: phonk(), B: phonk() });
  });

  it('a storage that throws does not break saving or loading', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => saveEqualizerSlots({ active: 'A', A: phonk(), B: phonk() })).not.toThrow();
    expect(loadEqualizerSlots()).toEqual({ active: 'A', A: getDefaultSettings(), B: getDefaultSettings() });
  });
});
