// @vitest-environment jsdom
/**
 * @spec: 032-master-fx (§2.7 Filter soft takeover, §2.8 All FX off; review 032 #2)
 * All FX off centres the filter AND makes its bound MIDI knob pick up again: a knob that was at −40
 * can't drag the filter back to −39 with its next CC; it must come to the centre first. The real map
 * engine (createMidiMap), the real targets and the real Master FX runtime; only Web MIDI is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import { createMidiMap, type MidiMap } from '@strudel/mixer';
import { MIDI_TARGET_IDS, buildMidiTargets, filterToUnit, watchFilterPickup } from '../midiTargets';
import { createCrossfader } from '../crossfader';
import { createMasterFxRuntime, type MasterFxRuntime } from '../../masterFx/masterFxRuntime';

type Listener = (event: { message: { statusByte: number; dataBytes: number[] } }) => void;

function fakeMidi() {
  const listeners = new Set<Listener>();
  const port = {
    name: 'Launch Control',
    addListener: (type: string, fn: Listener) => void (type === 'midimessage' && listeners.add(fn)),
    removeListener: (type: string, fn: Listener) => void (type === 'midimessage' && listeners.delete(fn)),
  };
  const WebMidi = { inputs: [port], addListener: () => {}, removeListener: () => {} };
  const cc = (controller: number, value: number) => {
    for (const fn of [...listeners]) fn({ message: { statusByte: 0xb0, dataBytes: [controller, value] } });
  };
  return { midi: { WebMidi, enableWebMidi: () => Promise.resolve(WebMidi) }, cc };
}

/** The CC value whose filter position is `position` (CC = round((pos + 100) / 200 × 127)). */
const ccFor = (position: number) => Math.round(filterToUnit(position) * 127);

describe('All FX off resets the filter knob pickup (review 032 #2)', () => {
  let runtime: MasterFxRuntime;
  let map: MidiMap;
  let unwatch: () => void;
  let send: (value: number) => void;

  beforeEach(async () => {
    Object.defineProperty(globalThis.navigator, 'requestMIDIAccess', {
      configurable: true,
      writable: true,
      value: vi.fn(() => Promise.resolve({})),
    });
    runtime = createMasterFxRuntime({
      createFx: () => {
        throw new Error('no audio');
      },
      storage: () => null,
      getAudioContext: () => ({}) as AudioContext,
      getController: () => ({ setMasterInsert: () => {} }),
    });
    const { midi, cc } = fakeMidi();
    const storage = new Map<string, string>([
      [
        'strudel-midi-map',
        JSON.stringify({
          version: 1,
          bindings: {
            [MIDI_TARGET_IDS.masterFilter]: { inputName: 'Launch Control', kind: 'cc', channel: 1, number: 50 },
          },
        }),
      ],
    ]);
    map = createMidiMap({
      storage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
        removeItem: (k: string) => void storage.delete(k),
      } as unknown as Storage,
      loadMidi: async () => midi,
      targets: buildMidiTargets({
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
        masterFx: runtime,
      }),
    });
    unwatch = watchFilterPickup(runtime, map);
    await map.ready;
    for (let i = 0; i < 8; i++) await Promise.resolve();
    send = (value) => cc(50, value);
    // Pick the knob up at the centre, then turn it to −40.
    send(64);
    send(ccFor(-40));
    expect(runtime.filter.get()).toBeLessThan(-35);
  });

  afterEach(() => {
    unwatch();
    map.destroy();
    runtime.destroy();
    delete (globalThis.navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess;
  });

  it('negative: after All FX off, the knob one step from where it was does not move the filter', () => {
    runtime.allOff();
    expect(runtime.filter.get()).toBe(0);
    send(ccFor(-40) + 1); // ≈ −39
    expect(runtime.filter.get()).toBe(0);
    expect(map.getState().awaitingPickup).toContain(MIDI_TARGET_IDS.masterFilter);
  });

  it('positive pair: brought back to the centre, the knob takes over again', () => {
    runtime.allOff();
    send(64);
    send(ccFor(-20));
    expect(runtime.filter.get()).toBeLessThan(-15);
  });

  it('the knob own moves do not reset its pickup (no stutter while turning)', () => {
    send(ccFor(-30));
    expect(map.getState().awaitingPickup).not.toContain(MIDI_TARGET_IDS.masterFilter);
  });
});
