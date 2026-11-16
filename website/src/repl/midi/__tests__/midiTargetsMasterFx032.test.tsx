// @vitest-environment jsdom
/**
 * @spec: 032-master-fx (§2.7 MIDI rows; tech §2.6)
 * The Master FX group: the filter (CC 0 → −100, 127 → +100, 62–66 → centre/off; read back as 0..1),
 * Delay / Reverb / Beat-repeat / Brake as the hold kind (down → hold, up → release, holder
 * `midi:<targetId>`), and Repeat length as a button stepping 1/2 → 1/4 → 1/8 → 1/16 → 1/2.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import type { MidiMapTarget } from '@strudel/mixer';
import { MIDI_TARGETS, MIDI_TARGET_IDS, buildMidiTargets, filterToUnit, unitToFilter } from '../midiTargets';
import { createCrossfader } from '../crossfader';
import { createMasterFxRuntime } from '../../masterFx/masterFxRuntime';

function setup() {
  const fx = createMasterFxRuntime({
    createFx: () => {
      throw new Error('no audio');
    },
    storage: () => null,
    getAudioContext: () => ({}) as AudioContext,
    getController: () => ({ setMasterInsert: () => {} }),
  });
  const brake = vi.fn((down: boolean) => down);
  fx.setBrakeTarget({ brake, watchBraking: () => () => {} });
  const targets = buildMidiTargets({
    equalizers: () => [],
    previewEngine: () => null,
    crossfader: createCrossfader(),
    cueGo: vi.fn(),
    togglePlay: vi.fn(),
    update: vi.fn(),
    togglePerformance: vi.fn(),
    getTransitionType: () => 'off',
    setTransitionType: vi.fn(),
    label: (meta) => meta.id,
    masterFx: fx,
  });
  const byId = (id: string) => targets.find((target) => target.id === id) as MidiMapTarget;
  return { fx, byId, brake };
}

describe('Master FX MIDI rows', () => {
  it('the group lists the filter, four holds and the repeat length, with their kinds', () => {
    const rows = MIDI_TARGETS.filter((meta) => meta.group === 'masterFx').map((meta) => [meta.id, meta.kind]);
    expect(rows).toEqual([
      ['masterFx.filter', 'continuous'],
      ['masterFx.delay', 'hold'],
      ['masterFx.reverb', 'hold'],
      ['masterFx.repeat', 'hold'],
      ['masterFx.brake', 'hold'],
      ['masterFx.repeatLength', 'button'],
    ]);
  });

  it('filter: CC 0 → −100, 64 → centre, 127 → +100; 62–66 are the detent, 61 and 67 are not', () => {
    expect(unitToFilter(0)).toBe(-100);
    expect(unitToFilter(64 / 127)).toBe(0);
    expect(unitToFilter(1)).toBe(100);
    expect(unitToFilter(62 / 127)).toBe(0);
    expect(unitToFilter(66 / 127)).toBe(0);
    expect(unitToFilter(61 / 127)).not.toBe(0);
    expect(unitToFilter(67 / 127)).not.toBe(0);
    expect(filterToUnit(-100)).toBe(0);
    expect(filterToUnit(0)).toBe(0.5);
    expect(filterToUnit(100)).toBe(1);
  });

  it('the filter target writes the knob and reads it back (the on-screen knob follows)', () => {
    const { fx, byId } = setup();
    const filter = byId(MIDI_TARGET_IDS.masterFilter);
    filter.write!(0);
    expect(fx.filter.get()).toBe(-100);
    expect(filter.read!()).toBe(0);
    filter.write!(64 / 127);
    expect(fx.filter.get()).toBe(0);
    filter.write!(1);
    expect(fx.filter.get()).toBe(100);
  });

  it('a hold target holds while down and releases on up, as midi:<id>; other holders are kept', () => {
    const { fx, byId } = setup();
    const repeat = byId(MIDI_TARGET_IDS.masterRepeat);
    expect(repeat.kind).toBe('hold');
    repeat.down!();
    expect(fx.held.get().repeat).toBe(true);
    fx.hold('repeat', 'pointer:1');
    repeat.up!();
    expect(fx.held.get().repeat).toBe(true);
    fx.release('repeat', 'pointer:1');
    expect(fx.held.get().repeat).toBe(false);
  });

  it('Brake from a pad brakes then spins up through the scratch runtime', () => {
    const { fx, byId, brake } = setup();
    byId(MIDI_TARGET_IDS.masterBrake).down!();
    expect(fx.held.get().brake).toBe(true);
    byId(MIDI_TARGET_IDS.masterBrake).up!();
    expect(brake.mock.calls).toEqual([[true], [false]]);
    expect(fx.held.get().brake).toBe(false);
  });

  it('Repeat length steps through the lengths and wraps', () => {
    const { fx, byId } = setup();
    const press = byId(MIDI_TARGET_IDS.masterRepeatLength).press!;
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      press();
      seen.push(fx.settings.get().repeatLength);
    }
    expect(seen).toEqual([1 / 8, 1 / 16, 1 / 2, 1 / 4]);
  });
});
