/**
 * @spec: 029-scratch-feel-midi-learn (functional §2, tech §1)
 * MIDI Learn for the Brake and Spin-up sliders: the ccToFeel log map, Learn (first CC, 10 s
 * timeout, cancel, a second press), the stored mappings, conflicts with the jog and the other
 * slider, a knob → setFeel, Forget, and no MIDI. WebMidi is a fake injected through `loadMidi`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ccToFeel,
  createMidiFeel,
  midiFeelConflict,
  readMidiFeelMappings,
  MIDI_FEEL_LEARN_TIMEOUT_MS,
  MIDI_FEEL_STORAGE_KEY,
} from '../scratch/midiFeel.mjs';
import { createMidiJog, MIDI_JOG_STORAGE_KEY } from '../scratch/midiJog.mjs';
import { SCRATCH_FEEL_RANGES } from '../scratch/scratchPhysics.mjs';
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
    cc(channel, controller, value) {
      for (const fn of [...this.listeners]) {
        fn({ message: { statusByte: 0xb0 | (channel - 1), dataBytes: [controller, value] } });
      }
    },
    noteOn(channel, note) {
      for (const fn of [...this.listeners]) fn({ message: { statusByte: 0x90 | (channel - 1), dataBytes: [note, 9] } });
    },
  };
}

function makeMidi(inputs = [makeInput('Knobs'), makeInput('DJ Jog')]) {
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

const BRAKE = SCRATCH_FEEL_RANGES.brakeSeconds;
const SPIN = SCRATCH_FEEL_RANGES.spinUpSeconds;
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe('ccToFeel (spec 029)', () => {
  it('Brake: 0 gives 0.02 s, 127 gives 1.0 s', () => {
    expect(ccToFeel(0, BRAKE)).toBe(0.02);
    expect(ccToFeel(127, BRAKE)).toBe(1);
    expect(ccToFeel(0, SPIN)).toBe(0.1);
    expect(ccToFeel(127, SPIN)).toBe(2);
  });

  it('follows a log curve: equal knob steps multiply the time by the same factor', () => {
    // The geometric middle of 0.02..1 s is √(0.02·1) ≈ 0.141 s, far below the linear 0.51 s.
    expect(ccToFeel(63.5, BRAKE)).toBeCloseTo(Math.sqrt(0.02), 3);
    expect(ccToFeel(64, BRAKE)).toBeCloseTo(0.02 * Math.pow(50, 64 / 127), 3);
    const quarter = ccToFeel(31.75, BRAKE);
    const half = ccToFeel(63.5, BRAKE);
    expect(half / quarter).toBeCloseTo(quarter / 0.02, 1);
    // Monotonic, and the short times get more of the knob.
    let previous = 0;
    for (let v = 0; v <= 127; v++) {
      const s = ccToFeel(v, BRAKE);
      expect(s).toBeGreaterThanOrEqual(previous);
      previous = s;
    }
    expect(ccToFeel(64, BRAKE)).toBeLessThan((BRAKE[0] + BRAKE[1]) / 2);
  });

  it('stays in range for junk input', () => {
    expect(ccToFeel(-5, BRAKE)).toBe(0.02);
    expect(ccToFeel(500, BRAKE)).toBe(1);
    expect(ccToFeel(NaN, BRAKE)).toBe(0.02);
  });
});

describe('midiFeelConflict (spec 029)', () => {
  const knob = (controller, inputName = 'Knobs', channel = 1) => ({ inputName, channel, controller });
  it('the jog control, or the other slider, conflicts; the slider itself does not', () => {
    const mappings = { brake: knob(21), spinUp: knob(22) };
    const jog = { ...knob(10, 'DJ Jog'), encoding: 'twos-complement' };
    expect(midiFeelConflict(knob(10, 'DJ Jog'), { target: 'brake', mappings, jog })).toBe('jog');
    expect(midiFeelConflict(knob(22), { target: 'brake', mappings, jog })).toBe('spinUp');
    expect(midiFeelConflict(knob(21), { target: 'spinUp', mappings, jog })).toBe('brake');
    expect(midiFeelConflict(knob(21), { target: 'brake', mappings, jog })).toBeNull();
    // Another channel or port is another control.
    expect(midiFeelConflict(knob(22, 'Knobs', 2), { target: 'brake', mappings, jog })).toBeNull();
    expect(midiFeelConflict(knob(10), { target: 'brake', mappings, jog })).toBeNull();
  });
});

describe('createMidiFeel (spec 029)', () => {
  let storage;
  let midi;
  let target;
  let feel;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve({}) });
    storage = createMemoryStorage();
    midi = makeMidi();
    target = { setFeel: vi.fn() };
  });
  afterEach(() => {
    feel?.destroy();
    feel = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const create = (options = {}) => (feel = createMidiFeel(target, { loadMidi: async () => midi, storage, ...options }));
  const knobs = () => midi.WebMidi.inputs[0];
  const jogPort = () => midi.WebMidi.inputs[1];

  it('is exported from @strudel/mixer under the key strudel-scratch-feel-midi', () => {
    expect(mixer.createMidiFeel).toBe(createMidiFeel);
    expect(mixer.ccToFeel).toBe(ccToFeel);
    expect(MIDI_FEEL_STORAGE_KEY).toBe('strudel-scratch-feel-midi');
    expect(MIDI_FEEL_LEARN_TIMEOUT_MS).toBe(10000);
  });

  it('does not load MIDI until Learn or a stored mapping', async () => {
    const loadMidi = vi.fn(async () => midi);
    create({ loadMidi });
    await flush();
    expect(loadMidi).not.toHaveBeenCalled();
    expect(feel.state).toBe('off');
  });

  it('Learn on Brake: the first CC (21) becomes its knob, is stored, and drives Brake on a log curve', async () => {
    create();
    const learned = feel.learn('brake');
    await flush();
    expect(feel.state).toBe('learning');
    expect(feel.learning).toBe('brake');
    knobs().noteOn(1, 60); // not a CC: ignored
    knobs().cc(1, 21, 0);
    await expect(learned).resolves.toEqual({
      status: 'learned',
      mapping: { inputName: 'Knobs', channel: 1, controller: 21 },
    });
    expect(feel.state).toBe('ready');
    expect(feel.learning).toBeNull();
    expect(readMidiFeelMappings(storage).brake).toEqual({ inputName: 'Knobs', channel: 1, controller: 21 });
    expect(target.setFeel).toHaveBeenLastCalledWith({ brakeSeconds: 0.02 });

    knobs().cc(1, 21, 127);
    expect(target.setFeel).toHaveBeenLastCalledWith({ brakeSeconds: 1 });
    knobs().cc(1, 21, 64);
    expect(target.setFeel).toHaveBeenLastCalledWith({ brakeSeconds: ccToFeel(64, BRAKE) });
    // Other controls do nothing.
    const calls = target.setFeel.mock.calls.length;
    knobs().cc(1, 30, 99);
    knobs().cc(2, 21, 99);
    expect(target.setFeel.mock.calls.length).toBe(calls);
  });

  it('Spin-up maps onto 0.1..2 s', async () => {
    create();
    const learned = feel.learn('spinUp');
    await flush();
    knobs().cc(3, 22, 127);
    await learned;
    expect(target.setFeel).toHaveBeenLastCalledWith({ spinUpSeconds: 2 });
    knobs().cc(3, 22, 0);
    expect(target.setFeel).toHaveBeenLastCalledWith({ spinUpSeconds: 0.1 });
  });

  it('a stored mapping survives a reload: a new instance listens and drives the slider', async () => {
    create();
    const learned = feel.learn('brake');
    await flush();
    knobs().cc(1, 21, 10);
    await learned;
    feel.destroy();
    target.setFeel.mockClear();

    create();
    expect(feel.mappings.brake).toEqual({ inputName: 'Knobs', channel: 1, controller: 21 });
    await feel.ready;
    expect(feel.state).toBe('ready');
    knobs().cc(1, 21, 127);
    expect(target.setFeel).toHaveBeenCalledWith({ brakeSeconds: 1 });
  });

  it('Forget removes the mapping and its stored copy; the knob no longer moves the slider', async () => {
    create();
    const learned = feel.learn('brake');
    await flush();
    knobs().cc(1, 21, 10);
    await learned;
    feel.forget('brake');
    expect(feel.mappings.brake).toBeNull();
    expect(storage.getItem(MIDI_FEEL_STORAGE_KEY)).toBeNull();
    expect(feel.state).toBe('off');
    target.setFeel.mockClear();
    knobs().cc(1, 21, 100);
    expect(target.setFeel).not.toHaveBeenCalled();
  });

  it('times out after 10 s and keeps the previous mapping', async () => {
    create();
    const first = feel.learn('brake');
    await flush();
    knobs().cc(1, 21, 10);
    await first;
    const again = feel.learn('brake');
    await flush();
    vi.advanceTimersByTime(MIDI_FEEL_LEARN_TIMEOUT_MS - 1);
    expect(feel.state).toBe('learning');
    vi.advanceTimersByTime(1);
    await expect(again).resolves.toEqual({ status: 'timeout' });
    expect(feel.mappings.brake.controller).toBe(21);
    expect(feel.state).toBe('ready');
  });

  it('cancel (Esc) or a second press stops Learn and keeps the previous mapping', async () => {
    create();
    const first = feel.learn('brake');
    await flush();
    knobs().cc(1, 21, 10);
    await first;

    const cancelled = feel.learn('brake');
    await flush();
    feel.cancel();
    await expect(cancelled).resolves.toEqual({ status: 'cancelled' });
    knobs().cc(1, 40, 10);
    expect(feel.mappings.brake.controller).toBe(21);

    const pressed = feel.learn('brake');
    await flush();
    await expect(feel.learn('brake')).resolves.toEqual({ status: 'cancelled' });
    await expect(pressed).resolves.toEqual({ status: 'cancelled' });
    expect(feel.state).toBe('ready');
    expect(feel.mappings.brake.controller).toBe(21);
  });

  it('Learn on the other slider replaces a Learn in progress', async () => {
    create();
    const brake = feel.learn('brake');
    await flush();
    const spin = feel.learn('spinUp');
    await expect(brake).resolves.toEqual({ status: 'cancelled' });
    await flush();
    expect(feel.learning).toBe('spinUp');
    knobs().cc(1, 22, 5);
    await expect(spin).resolves.toMatchObject({ status: 'learned' });
    expect(feel.mappings).toEqual({ brake: null, spinUp: { inputName: 'Knobs', channel: 1, controller: 22 } });
  });

  it("refuses the jog wheel's control with a conflict, keeping the previous mapping", async () => {
    storage.setItem(
      MIDI_JOG_STORAGE_KEY,
      JSON.stringify({ inputName: 'DJ Jog', channel: 1, controller: 10, encoding: 'twos-complement' }),
    );
    create();
    const learned = feel.learn('brake');
    await flush();
    jogPort().cc(1, 10, 1);
    await expect(learned).resolves.toEqual({ status: 'conflict', controller: 10, with: 'jog' });
    expect(feel.mappings.brake).toBeNull();
    expect(storage.getItem(MIDI_FEEL_STORAGE_KEY)).toBeNull();
    expect(target.setFeel).not.toHaveBeenCalled();
  });

  it("refuses the other slider's control with a conflict", async () => {
    create();
    const brake = feel.learn('brake');
    await flush();
    knobs().cc(1, 21, 10);
    await brake;
    const spin = feel.learn('spinUp');
    await flush();
    knobs().cc(1, 21, 50);
    await expect(spin).resolves.toEqual({ status: 'conflict', controller: 21, with: 'brake' });
    expect(feel.mappings.spinUp).toBeNull();
    expect(feel.mappings.brake.controller).toBe(21);
  });

  it('shares the jog wheel MIDI inputs: both work side by side on one WebMidi', async () => {
    const controller = { grab: vi.fn(() => true), moveBy: vi.fn(), autoRelease: vi.fn() };
    storage.setItem(
      MIDI_JOG_STORAGE_KEY,
      JSON.stringify({ inputName: 'DJ Jog', channel: 1, controller: 10, encoding: 'twos-complement' }),
    );
    const jog = createMidiJog(controller, { loadMidi: async () => midi, storage });
    await jog.ready;
    create();
    const learned = feel.learn('brake');
    await flush();
    knobs().cc(1, 21, 127);
    await learned;
    jogPort().cc(1, 10, 1);
    expect(controller.moveBy).toHaveBeenCalled();
    expect(target.setFeel).toHaveBeenLastCalledWith({ brakeSeconds: 1 });
    jog.destroy();
  });

  it('a damaged stored entry is dropped; the other is kept', () => {
    storage.setItem(
      MIDI_FEEL_STORAGE_KEY,
      JSON.stringify({
        brake: { inputName: 'Knobs', channel: 0, controller: 21 },
        spinUp: { inputName: 'K', channel: 2, controller: 7 },
      }),
    );
    expect(readMidiFeelMappings(storage)).toEqual({
      brake: null,
      spinUp: { inputName: 'K', channel: 2, controller: 7 },
    });
    storage.setItem(MIDI_FEEL_STORAGE_KEY, '{nope');
    expect(readMidiFeelMappings(storage)).toEqual({ brake: null, spinUp: null });
  });

  it('without Web MIDI, Learn resolves unavailable with reason unsupported', async () => {
    vi.stubGlobal('navigator', {});
    create();
    await expect(feel.learn('brake')).resolves.toEqual({ status: 'unavailable' });
    expect(feel.state).toBe('unavailable');
    expect(feel.reason).toBe('unsupported');
  });

  it('destroy removes its listeners from the inputs', async () => {
    create();
    const learned = feel.learn('brake');
    await flush();
    expect(knobs().listeners.size).toBe(1);
    feel.destroy();
    await expect(learned).resolves.toEqual({ status: 'cancelled' });
    expect(knobs().listeners.size).toBe(0);
    feel = null;
  });

  describe('review: the jog and the knobs (both directions, one Learn at a time)', () => {
    const jogController = () => ({ grab: vi.fn(() => true), moveBy: vi.fn(), autoRelease: vi.fn() });
    const createJog = () => createMidiJog(jogController(), { loadMidi: async () => midi, storage });

    it('jog Learn refuses a control a feel knob uses, with a conflict, keeping the old jog mapping', async () => {
      create();
      const knob = feel.learn('brake');
      await flush();
      knobs().cc(1, 21, 10);
      await knob;
      const jog = createJog();
      const learned = jog.learn();
      await flush();
      for (let i = 0; i < 3; i++) knobs().cc(1, 21, 11 + i);
      await expect(learned).resolves.toBeNull();
      expect(jog.mapping).toBeNull();
      expect(jog.lastLearn).toEqual({ status: 'conflict', controller: 21, with: 'brake' });
      expect(storage.getItem(MIDI_JOG_STORAGE_KEY)).toBeNull();
      jog.destroy();
    });

    it('a timeout and a successful jog Learn say so in lastLearn', async () => {
      const jog = createJog();
      const timedOut = jog.learn();
      await flush();
      vi.advanceTimersByTime(MIDI_FEEL_LEARN_TIMEOUT_MS);
      await timedOut;
      expect(jog.lastLearn).toEqual({ status: 'timeout' });
      const learned = jog.learn();
      await flush();
      expect(jog.lastLearn).toBeNull();
      for (let i = 0; i < 3; i++) jogPort().cc(1, 10, 1);
      await learned;
      expect(jog.lastLearn).toEqual({ status: 'learned' });
      jog.destroy();
    });

    it('starting a feel Learn cancels a jog Learn: one CC is never learned twice', async () => {
      const jog = createJog();
      const jogLearn = jog.learn();
      await flush();
      expect(jog.state).toBe('learning');
      create();
      const knob = feel.learn('spinUp');
      await expect(jogLearn).resolves.toBeNull();
      expect(jog.lastLearn).toEqual({ status: 'cancelled' });
      await flush();
      for (let i = 0; i < 3; i++) knobs().cc(1, 22, 5);
      await expect(knob).resolves.toMatchObject({ status: 'learned' });
      expect(jog.mapping).toBeNull();
      expect(storage.getItem(MIDI_JOG_STORAGE_KEY)).toBeNull();
      jog.destroy();
    });

    it('starting a jog Learn cancels a feel Learn', async () => {
      create();
      const knob = feel.learn('brake');
      await flush();
      const jog = createJog();
      const jogLearn = jog.learn();
      await flush();
      await expect(knob).resolves.toEqual({ status: 'cancelled' });
      expect(feel.learning).toBeNull();
      for (let i = 0; i < 3; i++) knobs().cc(1, 30, 1);
      await expect(jogLearn).resolves.toMatchObject({ controller: 30 });
      expect(feel.mappings.brake).toBeNull();
      jog.destroy();
    });
  });
});
