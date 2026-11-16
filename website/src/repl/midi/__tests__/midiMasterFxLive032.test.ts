// @vitest-environment jsdom
/**
 * @spec: 032-master-fx (functional §2.6 holding, §2.7 MIDI, §2.8 All FX off; task 5.1)
 * The REAL map engine (createMidiMap) driving the REAL website targets (buildMidiTargets) and the
 * REAL Master FX runtime, with only Web MIDI and the audio stage faked at the boundary:
 *
 * - §2.6: Beat-repeat bound to note 40 starts on note-on 40 and stops on note-off 40 (to the stage).
 * - §2.6 "no stuck effects": a binding cleared, imported over, or whose input disconnects while held
 *   releases the effect in the runtime (the button goes dark, the stage stops), not just in the engine.
 * - §2.7: Filter bound to CC 50 and picked up: 0 → −100, 64 → centre, 127 → +100; before the pickup a
 *   far CC does not move the knob (soft takeover).
 * - §2.7: an export with Master FX bindings, imported on a cleared panel, works again.
 * - §2.8: All FX off releases a MIDI hold; the pad's own release afterwards changes nothing, and the
 *   next press holds again (the engine is not left thinking the pad is down).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import { createMidiMap, type MidiMap } from '@strudel/mixer';
import { MIDI_TARGET_IDS, buildMidiTargets } from '../midiTargets';
import { createCrossfader } from '../crossfader';
import { createMasterFxRuntime, type MasterFxRuntime } from '../../masterFx/masterFxRuntime';
import type { MasterFxLike } from '../../masterFx/masterFxEngine';

type Listener = (event: { message: { statusByte: number; dataBytes: number[] } }) => void;

function makeInput(name: string) {
  const listeners = new Set<Listener>();
  const send = (statusByte: number, dataBytes: number[]) => {
    for (const fn of [...listeners]) fn({ message: { statusByte, dataBytes } });
  };
  return {
    name,
    addListener: (type: string, fn: Listener) => void (type === 'midimessage' && listeners.add(fn)),
    removeListener: (type: string, fn: Listener) => void (type === 'midimessage' && listeners.delete(fn)),
    cc: (controller: number, value: number) => send(0xb0, [controller, value]),
    noteOn: (note: number, velocity = 100) => send(0x90, [note, velocity]),
    noteOff: (note: number) => send(0x80, [note, 0]),
  };
}

function makeMidi() {
  const port = makeInput('Launch Control');
  const handlers: Record<string, Set<() => void>> = {};
  const WebMidi = {
    inputs: [port] as Array<ReturnType<typeof makeInput>>,
    addListener: (type: string, fn: () => void) => void (handlers[type] ??= new Set()).add(fn),
    removeListener: (type: string, fn: () => void) => void handlers[type]?.delete(fn),
    fire: (type: string) => {
      for (const fn of [...(handlers[type] ?? [])]) fn();
    },
  };
  return { port, WebMidi, enableWebMidi: vi.fn(() => Promise.resolve(WebMidi)) };
}

function fakeStage() {
  const calls: Array<[string, unknown]> = [];
  const record =
    (name: string) =>
    (arg?: unknown): void => {
      calls.push([name, arg]);
    };
  const fx = {
    input: {} as AudioNode,
    output: {} as AudioNode,
    setFilter: record('setFilter'),
    setResonance: record('setResonance'),
    setDelay: record('setDelay'),
    setReverb: record('setReverb'),
    setCps: record('setCps'),
    throwDelay: record('throwDelay'),
    throwReverb: record('throwReverb'),
    roll: record('roll'),
    setRollLength: record('setRollLength'),
    stopTails: record('stopTails'),
    setChannelCount: record('setChannelCount'),
    destroy: record('destroy'),
  } satisfies MasterFxLike;
  return { fx, of: (name: string) => calls.filter(([n]) => n === name).map(([, arg]) => arg) };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage;
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const note = (number: number) => ({ inputName: 'Launch Control', kind: 'note', channel: 1, number });
const cc = (number: number) => ({ inputName: 'Launch Control', kind: 'cc', channel: 1, number });

describe('Master FX through the real MIDI map (spec 032 §2.6–2.8)', () => {
  let midi: ReturnType<typeof makeMidi>;
  let stage: ReturnType<typeof fakeStage>;
  let runtime: MasterFxRuntime;
  let map: MidiMap | null;
  let storage: Storage;

  beforeEach(() => {
    Object.defineProperty(globalThis.navigator, 'requestMIDIAccess', {
      configurable: true,
      writable: true,
      value: vi.fn(() => Promise.resolve({})),
    });
    midi = makeMidi();
    stage = fakeStage();
    storage = memoryStorage();
    runtime = createMasterFxRuntime({
      createFx: () => stage.fx,
      storage: () => null,
      getAudioContext: () => ({ currentTime: 10, destination: { channelCount: 2 } }) as unknown as AudioContext,
      getController: () => ({ setMasterInsert: () => {} }),
      setInterval: () => 0,
      clearInterval: () => {},
    });
    runtime.init();
    runtime.setBrakeTarget({ brake: (down) => down, watchBraking: () => () => {} });
    map = null;
  });
  afterEach(() => {
    map?.destroy();
    runtime.destroy();
    delete (globalThis.navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess;
  });

  async function createMap(bindings?: Record<string, unknown>) {
    if (bindings) storage.setItem('strudel-midi-map', JSON.stringify({ version: 1, bindings }));
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
      masterFx: runtime,
    });
    map = createMidiMap({ storage, loadMidi: async () => midi, targets });
    await map.ready;
    await flush();
    return map;
  }

  it('§2.6: Beat-repeat on note 40 — note-on 40 starts the roll, note-off 40 stops it', async () => {
    await createMap({ [MIDI_TARGET_IDS.masterRepeat]: note(40) });
    midi.port.noteOn(40);
    expect(runtime.held.get().repeat).toBe(true);
    expect(stage.of('roll')).toHaveLength(1);
    expect(stage.of('roll')[0]).not.toBeNull();
    midi.port.noteOff(40);
    expect(runtime.held.get().repeat).toBe(false);
    expect(stage.of('roll').at(-1)).toBeNull();
  });

  it('§2.6 negative: another note (41) neither starts nor stops it', async () => {
    await createMap({ [MIDI_TARGET_IDS.masterRepeat]: note(40) });
    midi.port.noteOn(41);
    expect(runtime.held.get().repeat).toBe(false);
    expect(stage.of('roll')).toHaveLength(0);
    midi.port.noteOn(40);
    midi.port.noteOff(41);
    expect(runtime.held.get().repeat).toBe(true);
  });

  it('§2.6: clearing the binding while the pad holds Delay releases it in the runtime', async () => {
    const m = await createMap({ [MIDI_TARGET_IDS.masterDelay]: note(36) });
    midi.port.noteOn(36);
    expect(runtime.held.get().delay).toBe(true);
    m.clear(MIDI_TARGET_IDS.masterDelay);
    expect(runtime.held.get().delay).toBe(false);
    expect(stage.of('throwDelay')).toEqual([true, false]);
  });

  it('§2.6 negative: clearing a binding that is not held leaves a screen hold of the same effect alone', async () => {
    const m = await createMap({ [MIDI_TARGET_IDS.masterDelay]: note(36) });
    runtime.hold('delay', 'pointer:1');
    m.clear(MIDI_TARGET_IDS.masterDelay);
    expect(runtime.held.get().delay).toBe(true);
    expect(stage.of('throwDelay')).toEqual([true]);
  });

  it('§2.6: an import over a held Reverb releases it in the runtime', async () => {
    const m = await createMap({ [MIDI_TARGET_IDS.masterReverb]: note(37) });
    midi.port.noteOn(37);
    expect(runtime.held.get().reverb).toBe(true);
    expect(
      m.importJson(JSON.stringify({ version: 1, bindings: { [MIDI_TARGET_IDS.masterReverb]: note(38) } })),
    ).toMatchObject({ ok: true });
    expect(runtime.held.get().reverb).toBe(false);
    expect(stage.of('throwReverb')).toEqual([true, false]);
  });

  it('§2.6: the controller disconnecting under a held Brake (CC pad) releases it in the runtime', async () => {
    await createMap({ [MIDI_TARGET_IDS.masterBrake]: cc(20) });
    midi.port.cc(20, 127);
    expect(runtime.held.get().brake).toBe(true);
    midi.WebMidi.fire('connected'); // negative: an inputs change that keeps the controller releases nothing
    expect(runtime.held.get().brake).toBe(true);
    midi.WebMidi.inputs = [];
    midi.WebMidi.fire('disconnected');
    expect(runtime.held.get().brake).toBe(false);
  });

  it('§2.7: Filter on CC 50, once picked up: 0 → −100, 64 → centre, 127 → +100 (the knob follows)', async () => {
    await createMap({ [MIDI_TARGET_IDS.masterFilter]: cc(50) });
    midi.port.cc(50, 64); // at the knob's centre: picked up
    midi.port.cc(50, 0);
    expect(runtime.filter.get()).toBe(-100);
    midi.port.cc(50, 64);
    expect(runtime.filter.get()).toBe(0);
    midi.port.cc(50, 127);
    expect(runtime.filter.get()).toBe(100);
    expect(stage.of('setFilter').slice(-3)).toEqual([-100, 0, 100]);
  });

  it('§2.7 negative: before the pickup a far CC does not move the knob (soft takeover)', async () => {
    await createMap({ [MIDI_TARGET_IDS.masterFilter]: cc(50) });
    midi.port.cc(50, 0);
    expect(runtime.filter.get()).toBe(0);
    expect(stage.of('setFilter').filter((pos) => pos !== 0)).toEqual([]);
  });

  it('§2.7: an export with Master FX bindings, imported on a cleared panel, works again', async () => {
    const m = await createMap({ [MIDI_TARGET_IDS.masterDelay]: note(36), [MIDI_TARGET_IDS.masterFilter]: cc(50) });
    const exported = m.exportJson();
    m.clearAll();
    midi.port.noteOn(36);
    expect(runtime.held.get().delay).toBe(false); // negative: cleared panel, nothing bound
    midi.port.noteOff(36);

    expect(m.importJson(exported)).toMatchObject({ ok: true });
    await flush();
    midi.port.noteOn(36);
    expect(runtime.held.get().delay).toBe(true);
    midi.port.noteOff(36);
    expect(runtime.held.get().delay).toBe(false);
    midi.port.cc(50, 64);
    midi.port.cc(50, 0);
    expect(runtime.filter.get()).toBe(-100);
  });

  it('§2.8: All FX off releases a MIDI hold; the pad’s release then changes nothing; the next press holds again', async () => {
    await createMap({ [MIDI_TARGET_IDS.masterDelay]: note(36) });
    midi.port.noteOn(36);
    runtime.allOff();
    expect(runtime.held.get().delay).toBe(false);
    expect(stage.of('throwDelay')).toEqual([true, false]);
    midi.port.noteOff(36);
    expect(stage.of('throwDelay')).toEqual([true, false]); // negative: no second close
    midi.port.noteOn(36);
    expect(runtime.held.get().delay).toBe(true);
    expect(stage.of('throwDelay')).toEqual([true, false, true]);
  });
});
