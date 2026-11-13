/**
 * Spec 019 tech §2.5 / §4: the MIDI jog adapter: relative-CC decoding, Learn (assignment and
 * timeout), the stored mapping, jog → grab/move/autoRelease, and the unavailable states.
 * WebMidi is a fake injected through `loadMidi`; timers are faked and advanced explicitly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMidiJog,
  decodeRelativeCC,
  detectRelativeEncoding,
  MIDI_JOG_STORAGE_KEY,
  MIDI_JOG_SECONDS_PER_TICK,
} from '../scratch/midiJog.mjs';
import { ScratchController } from '../scratch/ScratchController.mjs';
import { ScratchDeck } from '../scratch/ScratchDeck.mjs';
import { createMemoryStorage, stubWebAudio, unstubWebAudio } from './webAudioMock.mjs';

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
    /** Send a CC on a 1-based channel. */
    cc(channel, controller, value) {
      for (const fn of [...this.listeners]) {
        fn({ message: { statusByte: 0xb0 | (channel - 1), dataBytes: [controller, value] } });
      }
    },
    noteOn(channel, note) {
      for (const fn of [...this.listeners]) {
        fn({ message: { statusByte: 0x90 | (channel - 1), dataBytes: [note, 100] } });
      }
    },
  };
}

function makeMidi(inputs = [makeInput('DJ Jog'), makeInput('Keys')]) {
  const WebMidi = {
    inputs,
    handlers: {},
    addListener(type, fn) {
      (this.handlers[type] ??= new Set()).add(fn);
    },
    removeListener(type, fn) {
      this.handlers[type]?.delete(fn);
    },
  };
  return { WebMidi, enableWebMidi: vi.fn(() => Promise.resolve(WebMidi)) };
}

function fakeController() {
  return { grab: vi.fn(() => true), moveBy: vi.fn(), autoRelease: vi.fn() };
}

describe('decodeRelativeCC', () => {
  it("two's complement (default): 1..63 forwards, 65..127 backwards", () => {
    expect(decodeRelativeCC(1)).toBe(1);
    expect(decodeRelativeCC(63)).toBe(63);
    expect(decodeRelativeCC(127)).toBe(-1);
    expect(decodeRelativeCC(65)).toBe(-63);
    expect(decodeRelativeCC(64)).toBe(-64);
    expect(decodeRelativeCC(0)).toBe(0);
    expect(decodeRelativeCC(3, 'twos-complement')).toBe(3);
  });

  it('binary offset: 64 is zero', () => {
    expect(decodeRelativeCC(64, 'binary-offset')).toBe(0);
    expect(decodeRelativeCC(65, 'binary-offset')).toBe(1);
    expect(decodeRelativeCC(63, 'binary-offset')).toBe(-1);
    expect(decodeRelativeCC(0, 'binary-offset')).toBe(-64);
    expect(decodeRelativeCC(127, 'binary-offset')).toBe(63);
  });

  it('decodes junk to 0', () => {
    for (const v of [-1, 128, 1.5, NaN, '3', null, undefined]) expect(decodeRelativeCC(v)).toBe(0);
  });

  it('detects the encoding from learned values', () => {
    expect(detectRelativeEncoding([1, 1, 2, 127, 126])).toBe('twos-complement');
    expect(detectRelativeEncoding([65, 65, 66, 63, 62])).toBe('binary-offset');
    expect(detectRelativeEncoding([])).toBe('twos-complement');
  });
});

describe('createMidiJog', () => {
  let storage;
  let midi;
  let loadMidi;
  let t;
  let warn;

  const make = (controller, extra = {}) => createMidiJog(controller, { loadMidi, storage, now: () => t, ...extra });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve({}) });
    storage = createMemoryStorage();
    midi = makeMidi();
    loadMidi = vi.fn(() => Promise.resolve(midi));
    t = 1000;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('without a stored mapping it is off and does not load MIDI (lazy)', () => {
    const jog = make(fakeController());
    expect(jog.state).toBe('off');
    expect(jog.mapping).toBeNull();
    expect(loadMidi).not.toHaveBeenCalled();
  });

  it('Learn assigns the first control that sends ≥3 messages within 300 ms, and stores it', async () => {
    const controller = fakeController();
    const jog = make(controller);
    const states = [];
    jog.on('change', (j) => states.push(j.state));
    const learned = jog.learn();
    await flush();
    expect(jog.state).toBe('learning');
    const [dj, keys] = midi.WebMidi.inputs;

    keys.noteOn(1, 60); // not a CC
    keys.cc(1, 7, 100); // a single fader nudge is not enough
    dj.cc(2, 22, 1);
    t += 100;
    dj.cc(2, 22, 1);
    t += 100;
    dj.cc(2, 22, 2);

    const mapping = await learned;
    expect(mapping).toEqual({ inputName: 'DJ Jog', channel: 2, controller: 22, encoding: 'twos-complement' });
    expect(jog.mapping).toEqual(mapping);
    expect(jog.state).toBe('ready');
    expect(states).toEqual(['learning', 'ready']);
    expect(JSON.parse(storage.getItem(MIDI_JOG_STORAGE_KEY))).toEqual(mapping);
    // Learning moved nothing.
    expect(controller.grab).not.toHaveBeenCalled();
  });

  it('messages spread wider than 300 ms do not assign', async () => {
    const jog = make(fakeController());
    const learned = jog.learn();
    await flush();
    const [dj] = midi.WebMidi.inputs;
    dj.cc(1, 10, 1);
    t += 200;
    dj.cc(1, 10, 1);
    t += 200; // the first one is now 400 ms old
    dj.cc(1, 10, 1);
    expect(jog.state).toBe('learning');
    t += 50;
    dj.cc(1, 10, 1); // three within 300 ms now
    await expect(learned).resolves.toMatchObject({ controller: 10 });
  });

  it('detects binary-offset encoding during Learn and decodes with it', async () => {
    const controller = fakeController();
    const jog = make(controller);
    const learned = jog.learn();
    await flush();
    const [dj] = midi.WebMidi.inputs;
    dj.cc(1, 5, 65);
    dj.cc(1, 5, 65);
    dj.cc(1, 5, 66);
    await expect(learned).resolves.toMatchObject({ encoding: 'binary-offset' });
    dj.cc(1, 5, 62); // −2 ticks
    expect(controller.moveBy).toHaveBeenCalledWith(-2 * MIDI_JOG_SECONDS_PER_TICK, 'midi');
    dj.cc(1, 5, 64); // zero: nothing
    expect(controller.moveBy).toHaveBeenCalledTimes(1);
  });

  it('Learn gives up after 10 s and keeps the previous mapping', async () => {
    const old = { inputName: 'DJ Jog', channel: 1, controller: 3, encoding: 'twos-complement' };
    storage.setItem(MIDI_JOG_STORAGE_KEY, JSON.stringify(old));
    const jog = make(fakeController());
    await jog.ready;
    expect(jog.state).toBe('ready');
    const learned = jog.learn();
    await flush();
    expect(jog.state).toBe('learning');
    vi.advanceTimersByTime(9999);
    expect(jog.state).toBe('learning');
    vi.advanceTimersByTime(1);
    await expect(learned).resolves.toBeNull();
    expect(jog.mapping).toEqual(old);
    expect(jog.state).toBe('ready');
    expect(JSON.parse(storage.getItem(MIDI_JOG_STORAGE_KEY))).toEqual(old);
  });

  it('Learn timeout with no previous mapping goes back to off', async () => {
    const jog = make(fakeController());
    const learned = jog.learn();
    await flush();
    vi.advanceTimersByTime(10000);
    await expect(learned).resolves.toBeNull();
    expect(jog.state).toBe('off');
    expect(jog.mapping).toBeNull();
  });

  it('a second learn() while learning returns the same attempt', async () => {
    const jog = make(fakeController());
    const a = jog.learn();
    const b = jog.learn();
    expect(a).toBe(b);
    await flush();
    vi.advanceTimersByTime(10000);
    await a;
  });

  it('the stored mapping round-trips: a reload starts listening without Learn', async () => {
    const mapping = { inputName: 'DJ Jog', channel: 1, controller: 16, encoding: 'twos-complement' };
    storage.setItem(MIDI_JOG_STORAGE_KEY, JSON.stringify(mapping));
    const controller = fakeController();
    const jog = make(controller);
    expect(jog.mapping).toEqual(mapping);
    await jog.ready;
    expect(loadMidi).toHaveBeenCalledTimes(1);
    expect(jog.state).toBe('ready');

    const [dj, keys] = midi.WebMidi.inputs;
    dj.cc(1, 16, 125); // −3 ticks: backwards
    // All as the 'midi' source, so the jog's idle release never drops a pointer or key hold.
    expect(controller.grab).toHaveBeenCalledTimes(1);
    expect(controller.grab).toHaveBeenCalledWith('midi');
    expect(controller.moveBy).toHaveBeenCalledWith(-3 * MIDI_JOG_SECONDS_PER_TICK, 'midi');
    expect(controller.autoRelease).toHaveBeenCalledWith(250, 'midi');

    // Negative pairs: another controller, channel or input does nothing.
    dj.cc(1, 17, 1);
    dj.cc(2, 16, 1);
    keys.cc(1, 16, 1);
    expect(controller.moveBy).toHaveBeenCalledTimes(1);
  });

  it('ignores a damaged stored mapping', () => {
    storage.setItem(MIDI_JOG_STORAGE_KEY, '{not json');
    expect(make(fakeController()).mapping).toBeNull();
    storage.setItem(
      MIDI_JOG_STORAGE_KEY,
      JSON.stringify({ inputName: 'x', channel: 99, controller: 1, encoding: 'twos-complement' }),
    );
    expect(make(fakeController()).mapping).toBeNull();
    storage.setItem(
      MIDI_JOG_STORAGE_KEY,
      JSON.stringify({ inputName: 'x', channel: 1, controller: 1, encoding: 'weird' }),
    );
    expect(make(fakeController()).mapping).toBeNull();
  });

  it('survives a storage that throws', async () => {
    const throwing = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    const jog = createMidiJog(fakeController(), { loadMidi, storage: throwing, now: () => t });
    expect(jog.mapping).toBeNull();
    const learned = jog.learn();
    await flush();
    const [dj] = midi.WebMidi.inputs;
    dj.cc(1, 1, 1);
    dj.cc(1, 1, 1);
    dj.cc(1, 1, 1);
    await expect(learned).resolves.toMatchObject({ controller: 1 });
    expect(() => jog.forget()).not.toThrow();
  });

  it('Forget removes the mapping and its stored copy', async () => {
    const mapping = { inputName: 'DJ Jog', channel: 1, controller: 16, encoding: 'twos-complement' };
    storage.setItem(MIDI_JOG_STORAGE_KEY, JSON.stringify(mapping));
    const controller = fakeController();
    const jog = make(controller);
    await jog.ready;
    jog.forget();
    expect(jog.mapping).toBeNull();
    expect(jog.state).toBe('off');
    expect(storage.getItem(MIDI_JOG_STORAGE_KEY)).toBeNull();
    midi.WebMidi.inputs[0].cc(1, 16, 1);
    expect(controller.grab).not.toHaveBeenCalled();
  });

  it('binds inputs that connect later', async () => {
    const mapping = { inputName: 'Late Jog', channel: 1, controller: 16, encoding: 'twos-complement' };
    storage.setItem(MIDI_JOG_STORAGE_KEY, JSON.stringify(mapping));
    const controller = fakeController();
    const jog = make(controller);
    await jog.ready;
    const late = makeInput('Late Jog');
    midi.WebMidi.inputs.push(late);
    for (const fn of midi.WebMidi.handlers.connected) fn();
    late.cc(1, 16, 1);
    expect(controller.moveBy).toHaveBeenCalledWith(MIDI_JOG_SECONDS_PER_TICK, 'midi');
  });

  it('destroy stops listening', async () => {
    const mapping = { inputName: 'DJ Jog', channel: 1, controller: 16, encoding: 'twos-complement' };
    storage.setItem(MIDI_JOG_STORAGE_KEY, JSON.stringify(mapping));
    const controller = fakeController();
    const jog = make(controller);
    await jog.ready;
    jog.destroy();
    expect(midi.WebMidi.inputs[0].listeners.size).toBe(0);
    expect(midi.WebMidi.handlers.connected.size).toBe(0);
    midi.WebMidi.inputs[0].cc(1, 16, 1);
    expect(controller.grab).not.toHaveBeenCalled();
  });

  describe('unavailable', () => {
    it('no Web MIDI in the browser: Learn resolves null, state unavailable/unsupported, MIDI never loaded', async () => {
      vi.stubGlobal('navigator', {});
      const jog = make(fakeController());
      await expect(jog.learn()).resolves.toBeNull();
      expect(jog.state).toBe('unavailable');
      expect(jog.reason).toBe('unsupported');
      expect(loadMidi).not.toHaveBeenCalled();
    });

    it('access denied: state unavailable/denied, and a later Learn may retry', async () => {
      const denied = Object.assign(new Error('Permission denied'), { name: 'SecurityError' });
      midi.enableWebMidi.mockImplementationOnce(() => Promise.reject(denied));
      const jog = make(fakeController());
      await expect(jog.learn()).resolves.toBeNull();
      expect(jog.state).toBe('unavailable');
      expect(jog.reason).toBe('denied');
      expect(jog.detail).toBe('Permission denied');
      const again = jog.learn();
      await flush();
      expect(jog.state).toBe('learning');
      expect(jog.reason).toBeUndefined();
      vi.advanceTimersByTime(10000);
      await again;
    });

    it('a stored mapping with MIDI failing reports unavailable/failed', async () => {
      storage.setItem(
        MIDI_JOG_STORAGE_KEY,
        JSON.stringify({ inputName: 'DJ Jog', channel: 1, controller: 1, encoding: 'twos-complement' }),
      );
      midi.enableWebMidi.mockImplementationOnce(() => Promise.reject(new Error('boom')));
      const jog = make(fakeController());
      await jog.ready;
      expect(jog.state).toBe('unavailable');
      expect(jog.reason).toBe('failed');
    });
  });

  it('end to end: the jog scratches the selected deck and lets go 250 ms after it stops', async () => {
    stubWebAudio();
    vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve({}) });
    const ac = new AudioContext();
    const slot = { insert: null, setPreGainInsert: (n) => (slot.insert = n) };
    const deck = new ScratchDeck(ac, slot);
    await deck.attach();
    const scratch = new ScratchController();
    scratch.setDeck('main', deck);
    storage.setItem(
      MIDI_JOG_STORAGE_KEY,
      JSON.stringify({ inputName: 'DJ Jog', channel: 1, controller: 16, encoding: 'twos-complement' }),
    );
    const jog = make(scratch);
    await jog.ready;
    const [dj] = midi.WebMidi.inputs;
    dj.cc(1, 16, 127);
    vi.advanceTimersByTime(100);
    dj.cc(1, 16, 126);
    vi.advanceTimersByTime(249);
    expect(deck.isGrabbed).toBe(true);
    vi.advanceTimersByTime(1);
    expect(deck.isGrabbed).toBe(false);
    expect(deck.node.port.posted).toEqual([
      { type: 'grab' },
      { type: 'move', delta: -MIDI_JOG_SECONDS_PER_TICK },
      { type: 'move', delta: -2 * MIDI_JOG_SECONDS_PER_TICK },
      { type: 'release', id: 1, beatSeconds: 0 }, // spec 023: id + snap beat (no tempo source: snap has no beat)
    ]);
    unstubWebAudio();
  });

  it('end to end: the jog stopping does not let go of a record the mouse still holds', async () => {
    stubWebAudio();
    vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve({}) });
    const ac = new AudioContext();
    const slot = { insert: null, setPreGainInsert: (n) => (slot.insert = n) };
    const deck = new ScratchDeck(ac, slot);
    await deck.attach();
    const scratch = new ScratchController();
    scratch.setDeck('main', deck);
    storage.setItem(
      MIDI_JOG_STORAGE_KEY,
      JSON.stringify({ inputName: 'DJ Jog', channel: 1, controller: 16, encoding: 'twos-complement' }),
    );
    const jog = make(scratch);
    await jog.ready;
    midi.WebMidi.inputs[0].cc(1, 16, 127);
    scratch.grab('pointer');
    vi.advanceTimersByTime(1000);
    expect(deck.isGrabbed).toBe(true);
    scratch.release('pointer');
    expect(deck.isGrabbed).toBe(false);
    unstubWebAudio();
  });
});
