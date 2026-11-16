/**
 * @spec: 031-midi-mapping (functional §2.1–2.3, tech §2.1–2.3)
 * Note input in createMidiInputs and the shared hub; the app-wide control registry (identity with
 * kind, midiControlHolder, the jog's and the feel knobs' Learn refusing a control bound in the map);
 * the map engine (CC → unit, soft takeover, button edges, Learn rules, conflicts, storage, lazy
 * access, export/import, status, subscribe). WebMidi is a fake injected through `loadMidi`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMidiInputs,
  createMidiJog,
  createSharedMidiInputs,
  parseNote,
  MIDI_JOG_STORAGE_KEY,
} from '../scratch/midiJog.mjs';
import { createMidiFeel, midiFeelConflict, MIDI_FEEL_STORAGE_KEY } from '../scratch/midiFeel.mjs';
import {
  MIDI_MAP_STORAGE_KEY,
  claimMidiLearn,
  cleanMidiControl,
  midiControlHolder,
  parseMidiMap,
  sameMidiControl,
} from '../scratch/midiLearnShared.mjs';
import {
  buttonEdge,
  ccToUnit,
  createMidiMap,
  pickup,
  MIDI_MAP_LEARN_TIMEOUT_MS,
  MIDI_MAP_PICKUP_TOLERANCE,
} from '../midi/midiMap.mjs';
import * as mixer from '../index.mjs';
import { createMemoryStorage } from './webAudioMock.mjs';

function makeInput(name) {
  return {
    name,
    listeners: new Set(),
    addListener(type, fn) {
      if (type === 'midimessage') this.listeners.add(fn);
    },
    removeListener(type, fn) {
      if (type === 'midimessage') this.listeners.delete(fn);
    },
    send(statusByte, dataBytes) {
      for (const fn of [...this.listeners]) fn({ message: { statusByte, dataBytes } });
    },
    cc(channel, controller, value) {
      this.send(0xb0 | (channel - 1), [controller, value]);
    },
    noteOn(channel, note, velocity = 100) {
      this.send(0x90 | (channel - 1), [note, velocity]);
    },
    noteOff(channel, note) {
      this.send(0x80 | (channel - 1), [note, 0]);
    },
  };
}

function makeMidi(inputs = [makeInput('Launch Control'), makeInput('DJ Jog')]) {
  const WebMidi = {
    inputs,
    handlers: {},
    addListener(type, fn) {
      (this.handlers[type] ??= new Set()).add(fn);
    },
    removeListener(type, fn) {
      this.handlers[type]?.delete(fn);
    },
    fire(type) {
      for (const fn of [...(this.handlers[type] ?? [])]) fn();
    },
  };
  return { WebMidi, enableWebMidi: vi.fn(() => Promise.resolve(WebMidi)) };
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const cc = (number, inputName = 'Launch Control', channel = 1) => ({ inputName, kind: 'cc', channel, number });
const note = (number, inputName = 'Launch Control', channel = 1) => ({ inputName, kind: 'note', channel, number });
/** A feel knob as spec 029 stores it (no kind, the CC number as `controller`). */
const knob = (controller, inputName = 'Launch Control', channel = 1) => ({ inputName, channel, controller });

// ---------------------------------------------------------------------------------------------
describe('note input (tech §2.1)', () => {
  it('parseNote: note-on, note-off, and note-on with velocity 0 as note-off; CCs are not notes', () => {
    expect(parseNote({ message: { statusByte: 0x92, dataBytes: [36, 100] } })).toEqual({
      channel: 3,
      note: 36,
      velocity: 100,
      on: true,
    });
    expect(parseNote({ message: { statusByte: 0x90, dataBytes: [36, 0] } })).toMatchObject({ on: false, velocity: 0 });
    expect(parseNote({ message: { statusByte: 0x80, dataBytes: [36, 64] } })).toMatchObject({ on: false });
    expect(parseNote({ data: [0x91, 40, 7] })).toEqual({ channel: 2, note: 40, velocity: 7, on: true });
    expect(parseNote({ message: { statusByte: 0xb0, dataBytes: [1, 2] } })).toBeNull();
    expect(parseNote(null)).toBeNull();
  });

  describe('createMidiInputs', () => {
    beforeEach(() => vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve({}) }));
    afterEach(() => vi.unstubAllGlobals());

    it('hands notes to onNote and CCs to onControlChange', async () => {
      const midi = makeMidi();
      const onNote = vi.fn();
      const onControlChange = vi.fn();
      const inputs = createMidiInputs({ loadMidi: async () => midi, onControlChange, onNote });
      await inputs.ensure();
      const port = midi.WebMidi.inputs[0];
      port.noteOn(1, 36);
      port.noteOn(1, 36, 0);
      port.cc(1, 20, 5);
      expect(onNote.mock.calls).toEqual([
        ['Launch Control', { channel: 1, note: 36, velocity: 100, on: true }],
        ['Launch Control', { channel: 1, note: 36, velocity: 0, on: false }],
      ]);
      expect(onControlChange).toHaveBeenCalledExactlyOnceWith('Launch Control', {
        channel: 1,
        controller: 20,
        value: 5,
      });
      expect(inputs.inputNames()).toEqual(['Launch Control', 'DJ Jog']);
      inputs.destroy();
    });

    it('without onNote (the jog and feel callers) notes are ignored and no disconnect listener is added', async () => {
      const midi = makeMidi();
      const onControlChange = vi.fn();
      const inputs = createMidiInputs({ loadMidi: async () => midi, onControlChange });
      await inputs.ensure();
      midi.WebMidi.inputs[0].noteOn(1, 36);
      expect(onControlChange).not.toHaveBeenCalled();
      expect(midi.WebMidi.handlers.disconnected).toBeUndefined();
      inputs.destroy();
    });

    it('onInputsChange hears the inputs at start, on connect and on disconnect', async () => {
      const midi = makeMidi([makeInput('A')]);
      const onInputsChange = vi.fn();
      const inputs = createMidiInputs({ loadMidi: async () => midi, onInputsChange });
      await inputs.ensure();
      expect(onInputsChange).toHaveBeenLastCalledWith(['A']);
      midi.WebMidi.inputs.push(makeInput('B'));
      midi.WebMidi.fire('connected');
      expect(onInputsChange).toHaveBeenLastCalledWith(['A', 'B']);
      midi.WebMidi.inputs.shift();
      midi.WebMidi.fire('disconnected');
      expect(onInputsChange).toHaveBeenLastCalledWith(['B']);
      inputs.destroy();
      expect(midi.WebMidi.handlers.disconnected.size).toBe(0);
    });
  });

  describe('createSharedMidiInputs (ref-counted hub)', () => {
    beforeEach(() => vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve({}) }));
    afterEach(() => vi.unstubAllGlobals());

    it('one listener per port for every subscriber; removed with the last subscription only', async () => {
      const midi = makeMidi();
      const hub = createSharedMidiInputs({ loadMidi: async () => midi });
      const a = vi.fn();
      const b = vi.fn();
      const subA = hub.subscribe({ onControlChange: a });
      const subB = hub.subscribe({ onNote: b });
      await subA.ensure();
      await subB.ensure();
      const port = midi.WebMidi.inputs[0];
      expect(port.listeners.size).toBe(1);
      expect(midi.enableWebMidi).toHaveBeenCalledTimes(1);
      port.cc(1, 1, 1);
      port.noteOn(1, 2);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);

      subA.destroy();
      subA.destroy(); // idempotent: does not drop B's reference
      expect(hub.size).toBe(1);
      expect(port.listeners.size).toBe(1);
      subB.destroy();
      expect(hub.size).toBe(0);
      expect(port.listeners.size).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('the shared control registry (tech §2.2)', () => {
  it('sameMidiControl: a stored 019/029 CC mapping (no kind) equals a map CC binding of the same CC', () => {
    const legacy = { inputName: 'Launch Control', channel: 1, controller: 20 };
    expect(sameMidiControl(legacy, cc(20))).toBe(true);
    expect(sameMidiControl(cc(20), legacy)).toBe(true);
    expect(sameMidiControl(legacy, { ...legacy })).toBe(true);
  });

  it('sameMidiControl: a note and a CC of the same number differ; so do port, channel and number', () => {
    expect(sameMidiControl(note(20), cc(20))).toBe(false);
    expect(sameMidiControl(cc(20), cc(21))).toBe(false);
    expect(sameMidiControl(cc(20), cc(20, 'Other'))).toBe(false);
    expect(sameMidiControl(cc(20), cc(20, 'Launch Control', 2))).toBe(false);
    expect(sameMidiControl(cc(20), null)).toBe(false);
  });

  it('cleanMidiControl keeps valid controls (old CC form too) and refuses damaged ones', () => {
    expect(cleanMidiControl({ inputName: 'X', channel: 1, controller: 7 })).toEqual(cc(7, 'X'));
    expect(cleanMidiControl(note(36))).toEqual(note(36));
    expect(cleanMidiControl({ ...note(36), kind: 'pitchbend' })).toBeNull();
    expect(cleanMidiControl({ ...cc(1), channel: 17 })).toBeNull();
    expect(cleanMidiControl({ ...cc(1), number: 128 })).toBeNull();
    expect(cleanMidiControl({ channel: 1, number: 1 })).toBeNull();
  });

  it('parseMidiMap drops damaged entries, keeps the rest and unknown target ids', () => {
    const raw = JSON.stringify({
      version: 1,
      bindings: { 'eq.band1': cc(21), 'future.thing': note(40), broken: { kind: 'cc' }, 'eq.band2': 'x' },
    });
    expect(parseMidiMap(raw).bindings).toEqual({ 'eq.band1': cc(21), 'future.thing': note(40) });
    expect(parseMidiMap('{not json').bindings).toEqual({});
    expect(parseMidiMap(null).bindings).toEqual({});
    expect(parseMidiMap({ bindings: [] }).bindings).toEqual({});
  });

  describe('midiControlHolder', () => {
    let storage;
    beforeEach(() => {
      storage = createMemoryStorage();
      storage.setItem(
        MIDI_JOG_STORAGE_KEY,
        JSON.stringify({ inputName: 'DJ Jog', channel: 1, controller: 30, encoding: 'twos-complement' }),
      );
      storage.setItem(MIDI_FEEL_STORAGE_KEY, JSON.stringify({ brake: knob(22), spinUp: null }));
      storage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify({ version: 1, bindings: { 'eq.band1': cc(21) } }));
    });

    it('names the jog, a feel knob or a map target holding the control', () => {
      expect(midiControlHolder(cc(30, 'DJ Jog'), { storage })).toEqual({ owner: 'jog', label: 'Jog' });
      expect(midiControlHolder(cc(22), { storage })).toEqual({ owner: 'feel:brake', label: 'Brake' });
      expect(
        midiControlHolder(cc(21), { storage, labelOf: (o) => (o === 'map:eq.band1' ? 'Band 1' : undefined) }),
      ).toEqual({ owner: 'map:eq.band1', label: 'Band 1' });
    });

    it('a free control, an excluded owner, or a note on a held CC number: nobody', () => {
      expect(midiControlHolder(cc(99), { storage })).toBeNull();
      expect(midiControlHolder(cc(21), { storage, exclude: 'map:eq.band1' })).toBeNull();
      expect(midiControlHolder(note(21), { storage })).toBeNull();
      // A jog mapping with an unknown encoding is no mapping (the jog ignores it too).
      storage.setItem(
        MIDI_JOG_STORAGE_KEY,
        JSON.stringify({ inputName: 'DJ Jog', channel: 1, controller: 30, encoding: 'x' }),
      );
      expect(midiControlHolder(cc(30, 'DJ Jog'), { storage })).toBeNull();
    });
  });

  it('midiFeelConflict names a map target as map:<id>; the 029 answers are unchanged', () => {
    const mappings = { brake: cc(22), spinUp: null };
    expect(midiFeelConflict(cc(21), { target: 'brake', mappings, jog: null, map: { 'eq.band1': cc(21) } })).toBe(
      'map:eq.band1',
    );
    expect(
      midiFeelConflict(cc(21), { target: 'brake', mappings, jog: null, map: { 'eq.band1': note(21) } }),
    ).toBeNull();
    expect(midiFeelConflict(cc(22), { target: 'spinUp', mappings, jog: null })).toBe('brake');
  });
});

// ---------------------------------------------------------------------------------------------
describe('map engine pure helpers (tech §2.3)', () => {
  it('ccToUnit: 0 → 0, 127 → 1, 64 ≈ 0.5, clamped', () => {
    expect(ccToUnit(0)).toBe(0);
    expect(ccToUnit(127)).toBe(1);
    expect(ccToUnit(64)).toBeCloseTo(0.504, 3);
    expect(ccToUnit(200)).toBe(1);
    expect(ccToUnit(-3)).toBe(0);
    expect(ccToUnit(NaN)).toBe(0);
  });

  it('pickup: a control far below the value does not pick up while it stays below', () => {
    let st = { picked: false, last: null };
    st = pickup(st, 0.1, 0.8);
    expect(st.picked).toBe(false);
    st = pickup(st, 0.2, 0.8);
    expect(st.picked).toBe(false);
  });

  it('pickup: it picks up once it crosses the value, or comes within 2 %', () => {
    expect(pickup({ picked: false, last: 0.7 }, 0.85, 0.8).picked).toBe(true); // crossed
    expect(pickup({ picked: false, last: 0.9 }, 0.75, 0.8).picked).toBe(true); // crossed downwards
    expect(pickup({ picked: false, last: null }, 0.8 - MIDI_MAP_PICKUP_TOLERANCE, 0.8).picked).toBe(true);
    expect(pickup({ picked: false, last: null }, 0.75, 0.8).picked).toBe(false); // 5 % away, first message
    expect(pickup({ picked: true, last: 0.1 }, 0.0, 0.8).picked).toBe(true); // stays picked
  });

  it('buttonEdge: press on note-on and on a CC ≥ 64; no repeat while held; release on off / < 64', () => {
    let r = buttonEdge(undefined, { kind: 'note', on: true, velocity: 100 });
    expect(r.press).toBe(true);
    r = buttonEdge(r.state, { kind: 'note', on: true, velocity: 100 });
    expect(r.press).toBe(false); // held
    r = buttonEdge(r.state, { kind: 'note', on: false, velocity: 0 });
    expect(r.press).toBe(false);
    expect(buttonEdge(r.state, { kind: 'note', on: true, velocity: 90 }).press).toBe(true);

    let c = buttonEdge(undefined, { kind: 'cc', value: 127 });
    expect(c.press).toBe(true);
    c = buttonEdge(c.state, { kind: 'cc', value: 100 });
    expect(c.press).toBe(false);
    c = buttonEdge(c.state, { kind: 'cc', value: 0 });
    expect(c.press).toBe(false);
    expect(buttonEdge(c.state, { kind: 'cc', value: 64 }).press).toBe(true);
    expect(buttonEdge({ held: false }, { kind: 'cc', value: 63 }).press).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('createMidiMap (tech §2.3)', () => {
  let storage;
  let midi;
  let map;
  let clock;
  let band;
  let volume;
  let cue;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve({}) });
    storage = createMemoryStorage();
    midi = makeMidi();
    clock = 0;
    band = { id: 'eq.band1', kind: 'continuous', label: 'Band 1', value: 0.5 };
    band.read = vi.fn(() => band.value);
    band.write = vi.fn((v) => (band.value = v));
    volume = { id: 'mixer.speakers', kind: 'continuous', label: 'Speakers volume', value: 0.8 };
    volume.read = () => volume.value;
    volume.write = vi.fn((v) => (volume.value = v));
    cue = { id: 'set.cueGo', kind: 'button', label: 'Cue/Go', press: vi.fn() };
  });
  afterEach(() => {
    map?.destroy();
    map = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const create = (options = {}) =>
    (map = createMidiMap({
      storage,
      loadMidi: async () => midi,
      now: () => clock,
      targets: [band, volume, cue],
      ...options,
    }));
  const port = () => midi.WebMidi.inputs[0];
  const jogPort = () => midi.WebMidi.inputs[1];
  const stored = () => JSON.parse(storage.getItem(MIDI_MAP_STORAGE_KEY) ?? 'null');
  /** Three CC messages within 300 ms (the continuous Learn rule). */
  const turn = (number, values = [60, 61, 62], p = port(), step = 50) => {
    for (const v of values) {
      p.cc(1, number, v);
      clock += step;
    }
  };
  async function bind(targetId, act) {
    const learning = map.learn(targetId);
    await flush();
    act();
    return learning;
  }

  it('is exported from @strudel/mixer with the strudel-midi-map key', () => {
    expect(mixer.createMidiMap).toBe(createMidiMap);
    expect(mixer.pickup).toBe(pickup);
    expect(mixer.MIDI_MAP_STORAGE_KEY).toBe('strudel-midi-map');
    expect(MIDI_MAP_LEARN_TIMEOUT_MS).toBe(10000);
  });

  it('lazy: no stored bindings → MIDI is not requested at load; Learn requests it', async () => {
    const loadMidi = vi.fn(async () => midi);
    create({ loadMidi });
    await flush();
    expect(loadMidi).not.toHaveBeenCalled();
    expect(map.status()).toEqual({ status: 'idle', inputs: [] });
    map.learn('eq.band1');
    await flush();
    expect(loadMidi).toHaveBeenCalledTimes(1);
    expect(map.status()).toEqual({ status: 'ready', inputs: ['Launch Control', 'DJ Jog'] });
  });

  it('stored bindings start listening at once: a reload drives the target with no Learn', async () => {
    storage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify({ version: 1, bindings: { 'set.cueGo': note(36) } }));
    create();
    await map.ready;
    port().noteOn(1, 36);
    expect(cue.press).toHaveBeenCalledTimes(1);
  });

  it('no Web MIDI: status unsupported, Learn resolves unsupported, MIDI never loaded', async () => {
    vi.stubGlobal('navigator', {});
    const loadMidi = vi.fn(async () => midi);
    create({ loadMidi });
    expect(map.status().status).toBe('unsupported');
    await expect(map.learn('eq.band1')).resolves.toEqual({ ok: false, reason: 'unsupported' });
    expect(loadMidi).not.toHaveBeenCalled();
  });

  it('permission denied: status denied, Learn resolves denied', async () => {
    const denied = Object.assign(new Error('no'), { name: 'SecurityError' });
    create({ loadMidi: async () => ({ ...midi, enableWebMidi: () => Promise.reject(denied) }) });
    await expect(map.learn('eq.band1')).resolves.toEqual({ ok: false, reason: 'denied' });
    expect(map.status().status).toBe('denied');
  });

  describe('Learn', () => {
    it('continuous: 3 messages of one CC within 300 ms bind it, and it is stored', async () => {
      create();
      const result = await bind('eq.band1', () => turn(21));
      expect(result).toEqual({ ok: true, control: cc(21) });
      expect(map.bindings()).toEqual({ 'eq.band1': cc(21) });
      expect(stored()).toEqual({ version: 1, bindings: { 'eq.band1': cc(21) } });
      expect(map.getState()).toMatchObject({ learning: null, lastLearn: { targetId: 'eq.band1', ok: true } });
    });

    it('continuous: one stray message binds nothing; messages wider apart than 300 ms neither', async () => {
      create();
      const learning = map.learn('eq.band1');
      await flush();
      port().cc(1, 21, 60);
      clock += 400;
      port().cc(1, 21, 61);
      clock += 400;
      port().cc(1, 21, 62);
      port().noteOn(1, 36); // a note never binds a continuous target
      expect(map.bindings()).toEqual({});
      expect(map.getState().learning).toBe('eq.band1');
      map.cancelLearn();
      await expect(learning).resolves.toEqual({ ok: false, reason: 'cancelled' });
    });

    it('button: the first note-on binds it; the press that bound it does not press the target', async () => {
      create();
      const result = await bind('set.cueGo', () => port().noteOn(1, 36));
      expect(result).toEqual({ ok: true, control: note(36) });
      expect(cue.press).not.toHaveBeenCalled();
      port().noteOff(1, 36);
      port().noteOn(1, 36);
      expect(cue.press).toHaveBeenCalledTimes(1);
    });

    it('button: a CC press binds it; a note-off or a CC below 64 does not', async () => {
      create();
      const learning = map.learn('set.cueGo');
      await flush();
      port().noteOff(1, 40);
      port().cc(1, 50, 10);
      expect(map.bindings()).toEqual({});
      port().cc(1, 50, 127);
      await expect(learning).resolves.toEqual({ ok: true, control: cc(50) });
    });

    it('gives up after 10 s keeping the previous binding', async () => {
      create();
      await bind('eq.band1', () => turn(21));
      const again = map.learn('eq.band1');
      await flush();
      vi.advanceTimersByTime(MIDI_MAP_LEARN_TIMEOUT_MS - 1);
      expect(map.getState().learning).toBe('eq.band1');
      vi.advanceTimersByTime(1);
      await expect(again).resolves.toEqual({ ok: false, reason: 'timeout' });
      expect(map.bindings()).toEqual({ 'eq.band1': cc(21) });
      expect(map.getState().lastLearn).toEqual({ targetId: 'eq.band1', ok: false, reason: 'timeout' });
    });

    it('cancel (Esc) keeps the previous binding; Learn pressed again on the same row cancels too', async () => {
      create();
      await bind('eq.band1', () => turn(21));
      const a = map.learn('eq.band1');
      await flush();
      map.cancelLearn();
      await expect(a).resolves.toEqual({ ok: false, reason: 'cancelled' });
      const b = map.learn('eq.band1');
      await flush();
      await expect(map.learn('eq.band1')).resolves.toEqual({ ok: false, reason: 'cancelled' });
      await expect(b).resolves.toEqual({ ok: false, reason: 'cancelled' });
      expect(map.bindings()).toEqual({ 'eq.band1': cc(21) });
    });

    it('refuses a control another target holds, naming it; the holder keeps it', async () => {
      create();
      await bind('eq.band1', () => turn(21));
      const result = await bind('mixer.speakers', () => turn(21, [10, 11, 12]));
      expect(result).toEqual({ ok: false, reason: 'conflict', holder: { owner: 'map:eq.band1', label: 'Band 1' } });
      expect(map.bindings()).toEqual({ 'eq.band1': cc(21) });
    });

    it('re-learning a target on its own control is not a conflict', async () => {
      create();
      await bind('eq.band1', () => turn(21));
      await expect(bind('eq.band1', () => turn(21))).resolves.toEqual({ ok: true, control: cc(21) });
    });

    it('refuses the jog’s control, naming the jog (and a feel knob’s)', async () => {
      storage.setItem(
        MIDI_JOG_STORAGE_KEY,
        JSON.stringify({ inputName: 'DJ Jog', channel: 1, controller: 30, encoding: 'twos-complement' }),
      );
      storage.setItem(MIDI_FEEL_STORAGE_KEY, JSON.stringify({ brake: knob(22), spinUp: null }));
      create();
      await expect(bind('eq.band1', () => turn(30, [1, 1, 1], jogPort()))).resolves.toEqual({
        ok: false,
        reason: 'conflict',
        holder: { owner: 'jog', label: 'Jog' },
      });
      await expect(bind('eq.band1', () => turn(22))).resolves.toMatchObject({
        reason: 'conflict',
        holder: { owner: 'feel:brake' },
      });
      expect(map.bindings()).toEqual({});
    });

    it('takes the one-Learn lock: a jog Learn running on the same storage is cancelled', async () => {
      create();
      const other = vi.fn();
      claimMidiLearn(other, storage);
      map.learn('eq.band1');
      await flush();
      expect(other).toHaveBeenCalledTimes(1);
      map.cancelLearn();
    });
  });

  describe('soft takeover (functional §2.3)', () => {
    it('volume 80 % and the fader at 10 %: moving to 20 % changes nothing; passing 80 % drives it from there', async () => {
      create();
      await bind('mixer.speakers', () => turn(7, [10, 11, 12]));
      expect(map.getState().awaitingPickup).toEqual(['mixer.speakers']);
      port().cc(1, 7, Math.round(0.1 * 127));
      port().cc(1, 7, Math.round(0.2 * 127));
      expect(volume.write).not.toHaveBeenCalled();
      expect(volume.value).toBe(0.8);
      port().cc(1, 7, 105); // 0.827: crossed 0.8
      expect(volume.write).toHaveBeenCalledExactlyOnceWith(105 / 127);
      expect(map.isPickedUp('mixer.speakers')).toBe(true);
      expect(map.getState().awaitingPickup).toEqual([]);
      port().cc(1, 7, 64);
      expect(volume.value).toBeCloseTo(64 / 127, 6);
    });

    it('an on-screen change drops the pickup: the knob must reach the new value again', async () => {
      create();
      await bind('eq.band1', () => turn(21));
      port().cc(1, 21, 64); // within 2 % of 0.5: picked
      expect(map.isPickedUp('eq.band1')).toBe(true);
      band.value = 0.9; // dragged on screen
      map.notifyExternalChange('eq.band1');
      expect(map.isPickedUp('eq.band1')).toBe(false);
      band.write.mockClear();
      port().cc(1, 21, 70);
      expect(band.write).not.toHaveBeenCalled();
      expect(band.value).toBe(0.9);
      port().cc(1, 21, 127); // crosses 0.9
      expect(band.write).toHaveBeenCalledWith(1);
    });

    it('a continuous target ignores notes on its number', async () => {
      create();
      await bind('eq.band1', () => turn(21));
      port().noteOn(1, 21);
      expect(band.write).not.toHaveBeenCalled();
    });
  });

  describe('buttons', () => {
    it('a held pad acts once; note-off does nothing', async () => {
      create();
      await bind('set.cueGo', () => port().noteOn(1, 36));
      port().noteOff(1, 36);
      port().noteOn(1, 36);
      port().noteOn(1, 36); // still held (no note-off between)
      port().noteOff(1, 36);
      expect(cue.press).toHaveBeenCalledTimes(1);
    });

    it('a CC button presses on ≥ 64 after < 64, not on the release', async () => {
      create();
      await bind('set.cueGo', () => port().cc(1, 50, 127));
      port().cc(1, 50, 0);
      expect(cue.press).not.toHaveBeenCalled();
      port().cc(1, 50, 127);
      port().cc(1, 50, 127);
      expect(cue.press).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear, export, import', () => {
    it('Clear removes one binding; Clear all removes the map’s only (the jog keeps its own)', async () => {
      const jog = { inputName: 'DJ Jog', channel: 1, controller: 30, encoding: 'twos-complement' };
      storage.setItem(MIDI_JOG_STORAGE_KEY, JSON.stringify(jog));
      create();
      await bind('eq.band1', () => turn(21));
      await bind('set.cueGo', () => port().noteOn(1, 36));
      map.clear('eq.band1');
      expect(map.bindings()).toEqual({ 'set.cueGo': note(36) });
      map.clearAll();
      expect(map.bindings()).toEqual({});
      expect(storage.getItem(MIDI_MAP_STORAGE_KEY)).toBeNull();
      expect(JSON.parse(storage.getItem(MIDI_JOG_STORAGE_KEY))).toEqual(jog);
    });

    it('Export, Clear all, Import of that file restores every binding', async () => {
      create();
      await bind('eq.band1', () => turn(21));
      await bind('set.cueGo', () => port().noteOn(1, 36));
      const file = map.exportJson();
      expect(JSON.parse(file)).toEqual({ version: 1, bindings: { 'eq.band1': cc(21), 'set.cueGo': note(36) } });
      map.clearAll();
      expect(map.importJson(file)).toEqual({ ok: true });
      expect(map.bindings()).toEqual({ 'eq.band1': cc(21), 'set.cueGo': note(36) });
      port().noteOn(1, 36);
      expect(cue.press).toHaveBeenCalledTimes(1);
    });

    it('an invalid file changes nothing and says why', async () => {
      create();
      await bind('eq.band1', () => turn(21));
      const before = map.bindings();
      expect(map.importJson('{nope')).toEqual({ ok: false, error: 'not-json' });
      expect(map.importJson('[]')).toEqual({ ok: false, error: 'not-a-map' });
      expect(map.importJson(JSON.stringify({ version: 2, bindings: {} }))).toEqual({
        ok: false,
        error: 'unsupported-version',
      });
      expect(map.importJson(JSON.stringify({ version: 1, bindings: { a: cc(1), b: { kind: 'cc' } } }))).toMatchObject({
        ok: false,
        error: 'invalid-binding',
      });
      expect(map.importJson(JSON.stringify({ version: 1, bindings: { a: cc(1), b: cc(1) } }))).toMatchObject({
        ok: false,
        error: 'duplicate-control',
      });
      storage.setItem(MIDI_FEEL_STORAGE_KEY, JSON.stringify({ brake: knob(22), spinUp: null }));
      expect(map.importJson(JSON.stringify({ version: 1, bindings: { a: cc(22) } }))).toMatchObject({
        ok: false,
        error: 'conflict',
      });
      expect(map.bindings()).toEqual(before);
    });

    it('unknown target ids are kept through storage and export, and ignored', async () => {
      storage.setItem(
        MIDI_MAP_STORAGE_KEY,
        JSON.stringify({ version: 1, bindings: { 'future.thing': cc(90), broken: 5, 'eq.band1': cc(21) } }),
      );
      create();
      await map.ready;
      expect(map.bindings()).toEqual({ 'future.thing': cc(90), 'eq.band1': cc(21) });
      port().cc(1, 90, 127); // nothing registered for it: ignored, no throw
      expect(JSON.parse(map.exportJson()).bindings['future.thing']).toEqual(cc(90));
    });
  });

  it('subscribe hears learning, bindings and pickup changes; unsubscribe stops it', async () => {
    create();
    const states = [];
    const off = map.subscribe((s) => states.push(s));
    await bind('eq.band1', () => turn(21));
    expect(states.some((s) => s.learning === 'eq.band1')).toBe(true);
    expect(states.at(-1)).toMatchObject({ learning: null, bindings: { 'eq.band1': cc(21) } });
    off();
    const n = states.length;
    map.clear('eq.band1');
    expect(states.length).toBe(n);
  });

  it('a hub subscription is released on destroy', async () => {
    const hub = createSharedMidiInputs({ loadMidi: async () => midi });
    create({ hub });
    await bind('eq.band1', () => turn(21));
    expect(hub.size).toBe(1);
    map.destroy();
    expect(hub.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the jog and feel Learns refuse a control bound in the map (tech §2.2, both directions)', () => {
  let storage;
  let midi;
  let jog;
  let feel;
  let clock;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve({}) });
    storage = createMemoryStorage();
    midi = makeMidi();
    clock = 0;
  });
  afterEach(() => {
    jog?.destroy();
    feel?.destroy();
    jog = feel = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const controller = () => ({ grab: vi.fn(), moveBy: vi.fn(), autoRelease: vi.fn() });
  const bindInMap = (number) =>
    storage.setItem(
      MIDI_MAP_STORAGE_KEY,
      JSON.stringify({ version: 1, bindings: { 'eq.band3': cc(number, 'DJ Jog') } }),
    );

  it('jog Learn on a CC bound in the map: conflict naming the map target, no mapping', async () => {
    bindInMap(30);
    jog = createMidiJog(controller(), { loadMidi: async () => midi, storage, now: () => clock });
    const learning = jog.learn();
    await flush();
    for (let i = 0; i < 3; i++) {
      midi.WebMidi.inputs[1].cc(1, 30, 1);
      clock += 20;
    }
    await expect(learning).resolves.toBeNull();
    expect(jog.lastLearn).toEqual({
      status: 'conflict',
      controller: 30,
      with: 'map',
      target: 'eq.band3',
      label: 'eq.band3',
    });
    expect(jog.mapping).toBeNull();
    expect(storage.getItem(MIDI_JOG_STORAGE_KEY)).toBeNull();
  });

  it('jog Learn on a free CC still learns (019 behaviour unchanged)', async () => {
    bindInMap(31);
    jog = createMidiJog(controller(), { loadMidi: async () => midi, storage, now: () => clock });
    const learning = jog.learn();
    await flush();
    for (let i = 0; i < 3; i++) {
      midi.WebMidi.inputs[1].cc(1, 30, 1);
      clock += 20;
    }
    await expect(learning).resolves.toMatchObject({ inputName: 'DJ Jog', controller: 30 });
  });

  it('feel Learn on a CC bound in the map: conflict naming the map target, no mapping', async () => {
    bindInMap(30);
    feel = createMidiFeel({ setFeel: vi.fn() }, { loadMidi: async () => midi, storage });
    const learning = feel.learn('brake');
    await flush();
    midi.WebMidi.inputs[1].cc(1, 30, 64);
    await expect(learning).resolves.toEqual({
      status: 'conflict',
      controller: 30,
      with: 'map',
      target: 'eq.band3',
      label: 'eq.band3',
    });
    expect(feel.mappings.brake).toBeNull();
  });

  it('feel Learn on a free CC still learns (029 behaviour unchanged)', async () => {
    bindInMap(31);
    feel = createMidiFeel({ setFeel: vi.fn() }, { loadMidi: async () => midi, storage });
    const learning = feel.learn('brake');
    await flush();
    midi.WebMidi.inputs[1].cc(1, 30, 64);
    await expect(learning).resolves.toMatchObject({ status: 'learned' });
  });
});
