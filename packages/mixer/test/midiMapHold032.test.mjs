/**
 * @spec: 032-master-fx (functional §2.6–2.7, tech §2.3)
 * The MIDI map's `hold` kind: down on note-on / CC press, up on note-off / CC release, no repeats,
 * Learn like a button (the binding press is not a down), and auto-release (up) when the binding is
 * cleared, replaced or imported over, when the target is unregistered, on destroy and when the
 * input disconnects. A spec 031 export (no hold rows) still imports. WebMidi is a fake.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMidiMap, MIDI_MAP_TARGET_KINDS, MIDI_MAP_STORAGE_KEY } from '../midi/midiMap.mjs';
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

function makeMidi(inputs = [makeInput('Launch Control'), makeInput('Pads')]) {
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

describe('midiMap hold kind (spec 032 tech §2.3)', () => {
  let storage;
  let midi;
  let map;
  let delay;
  let repeat;
  let cue;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.resolve({}) });
    storage = createMemoryStorage();
    midi = makeMidi();
    delay = { id: 'masterFx.delay', kind: 'hold', label: 'Delay throw', down: vi.fn(), up: vi.fn() };
    repeat = { id: 'masterFx.repeat', kind: 'hold', label: 'Beat-repeat', down: vi.fn(), up: vi.fn() };
    cue = { id: 'set.cueGo', kind: 'button', label: 'Cue/Go', press: vi.fn() };
  });
  afterEach(() => {
    map?.destroy();
    map = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const store = (bindings) => storage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify({ version: 1, bindings }));
  const create = async (bindings) => {
    if (bindings) store(bindings);
    map = createMidiMap({ storage, loadMidi: async () => midi, targets: [delay, repeat, cue] });
    await map.ready;
    await flush();
    return map;
  };
  const port = () => midi.WebMidi.inputs[0];
  const pads = () => midi.WebMidi.inputs[1];

  it('hold is a target kind, exported from @strudel/mixer', () => {
    expect(MIDI_MAP_TARGET_KINDS).toEqual(['continuous', 'button', 'hold']);
    expect(mixer.MIDI_MAP_TARGET_KINDS).toBe(MIDI_MAP_TARGET_KINDS);
  });

  it('note: note-on 40 → down, note-off 40 → up; a repeated note-on while down is ignored', async () => {
    await create({ 'masterFx.repeat': note(40) });
    port().noteOn(1, 40);
    expect(repeat.down).toHaveBeenCalledTimes(1);
    expect(repeat.up).not.toHaveBeenCalled();
    port().noteOn(1, 40);
    expect(repeat.down).toHaveBeenCalledTimes(1);
    port().noteOff(1, 40);
    expect(repeat.up).toHaveBeenCalledTimes(1);
    port().noteOn(1, 40, 0); // note-on velocity 0 = off: nothing more (already up)
    expect(repeat.up).toHaveBeenCalledTimes(1);
    port().noteOn(1, 40);
    port().noteOn(1, 40, 0);
    expect(repeat.down).toHaveBeenCalledTimes(2);
    expect(repeat.up).toHaveBeenCalledTimes(2);
  });

  it('CC: ≥ 64 → down, < 64 → up; values staying on one side do nothing', async () => {
    await create({ 'masterFx.delay': cc(20) });
    port().cc(1, 20, 10); // first message below 64: nothing
    expect(delay.down).not.toHaveBeenCalled();
    expect(delay.up).not.toHaveBeenCalled();
    port().cc(1, 20, 127);
    port().cc(1, 20, 100);
    expect(delay.down).toHaveBeenCalledTimes(1);
    port().cc(1, 20, 0);
    port().cc(1, 20, 5);
    expect(delay.up).toHaveBeenCalledTimes(1);
  });

  it('negative: other controls, channels and inputs do not drive it', async () => {
    await create({ 'masterFx.repeat': note(40) });
    port().noteOn(1, 41);
    port().noteOn(2, 40);
    pads().noteOn(1, 40);
    port().cc(1, 40, 127);
    expect(repeat.down).not.toHaveBeenCalled();
  });

  it('several holds at once act independently', async () => {
    await create({ 'masterFx.delay': note(36), 'masterFx.repeat': note(40) });
    port().noteOn(1, 36);
    port().noteOn(1, 40);
    port().noteOff(1, 36);
    expect(delay.up).toHaveBeenCalledTimes(1);
    expect(repeat.up).not.toHaveBeenCalled();
  });

  it('Learn binds on the first note-on like a button; the binding press is not a down, and its release not an up', async () => {
    await create();
    const learning = map.learn('masterFx.repeat');
    await flush();
    port().noteOn(1, 40);
    await expect(learning).resolves.toEqual({ ok: true, control: note(40) });
    expect(repeat.down).not.toHaveBeenCalled();
    port().noteOff(1, 40);
    expect(repeat.up).not.toHaveBeenCalled();
    port().noteOn(1, 40);
    expect(repeat.down).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem(MIDI_MAP_STORAGE_KEY)).bindings['masterFx.repeat']).toEqual(note(40));
  });

  it('Learn binds on a CC press (not on a CC below 64)', async () => {
    await create();
    const learning = map.learn('masterFx.delay');
    await flush();
    port().cc(1, 21, 30);
    port().cc(1, 21, 90);
    await expect(learning).resolves.toEqual({ ok: true, control: cc(21) });
  });

  describe('auto-release (nothing sticks)', () => {
    it('clearing the binding while down calls up', async () => {
      await create({ 'masterFx.delay': note(36) });
      port().noteOn(1, 36);
      map.clear('masterFx.delay');
      expect(delay.up).toHaveBeenCalledTimes(1);
      port().noteOff(1, 36); // the old control no longer drives it
      expect(delay.up).toHaveBeenCalledTimes(1);
    });

    it('negative: clearing a binding that is not down calls nothing', async () => {
      await create({ 'masterFx.delay': note(36) });
      map.clear('masterFx.delay');
      expect(delay.up).not.toHaveBeenCalled();
    });

    it('clearAll and an import over it call up', async () => {
      await create({ 'masterFx.delay': note(36), 'masterFx.repeat': note(40) });
      port().noteOn(1, 36);
      map.clearAll();
      expect(delay.up).toHaveBeenCalledTimes(1);

      map.importJson(JSON.stringify({ version: 1, bindings: { 'masterFx.repeat': note(40) } }));
      await flush();
      port().noteOn(1, 40);
      expect(repeat.down).toHaveBeenCalledTimes(1);
      expect(map.importJson(JSON.stringify({ version: 1, bindings: { 'masterFx.repeat': note(41) } }))).toEqual({
        ok: true,
      });
      expect(repeat.up).toHaveBeenCalledTimes(1);
    });

    it('re-learning (replacing) a held target’s control calls up', async () => {
      await create({ 'masterFx.repeat': note(40) });
      port().noteOn(1, 40);
      const learning = map.learn('masterFx.repeat');
      await flush();
      port().noteOn(1, 44);
      await learning;
      expect(repeat.up).toHaveBeenCalledTimes(1);
      port().noteOff(1, 40);
      expect(repeat.up).toHaveBeenCalledTimes(1);
    });

    it('destroy calls up', async () => {
      await create({ 'masterFx.delay': cc(20) });
      port().cc(1, 20, 127);
      map.destroy();
      expect(delay.up).toHaveBeenCalledTimes(1);
      map = null;
    });

    it('the input disconnecting calls up for holds on that input only', async () => {
      await create({ 'masterFx.delay': note(36), 'masterFx.repeat': note(40, 'Pads') });
      port().noteOn(1, 36);
      pads().noteOn(1, 40);
      midi.WebMidi.inputs = [port()]; // Pads unplugged
      midi.WebMidi.fire('disconnected');
      expect(repeat.up).toHaveBeenCalledTimes(1);
      expect(delay.up).not.toHaveBeenCalled();
    });

    it('a target unregistered while down gets up (its last registered closure)', async () => {
      await create({ 'masterFx.delay': note(36) });
      port().noteOn(1, 36);
      map.setTargets([repeat, cue]);
      expect(delay.up).toHaveBeenCalledTimes(1);
    });

    it('negative: re-registering a held target (fresh closures) keeps it down; the release goes to the new closure', async () => {
      await create({ 'masterFx.delay': note(36) });
      port().noteOn(1, 36);
      const fresh = { ...delay, down: vi.fn(), up: vi.fn() };
      map.setTargets([fresh, repeat, cue]);
      expect(delay.up).not.toHaveBeenCalled();
      port().noteOff(1, 36);
      expect(fresh.up).toHaveBeenCalledTimes(1);
      expect(delay.up).not.toHaveBeenCalled();
    });

    it('a throwing down/up is caught (the map keeps working)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      delay.down = vi.fn(() => {
        throw new Error('boom');
      });
      await create({ 'masterFx.delay': note(36), 'set.cueGo': note(37) });
      port().noteOn(1, 36);
      port().noteOn(1, 37);
      expect(cue.press).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  it('a spec 031 export (no hold rows) still imports, and buttons still press once', async () => {
    await create();
    const file = JSON.stringify({ version: 1, bindings: { 'set.cueGo': note(36) } });
    expect(map.importJson(file)).toEqual({ ok: true });
    await flush();
    port().noteOn(1, 36);
    port().noteOff(1, 36);
    expect(cue.press).toHaveBeenCalledTimes(1);
  });

  it('export and import carry hold bindings', async () => {
    await create({ 'masterFx.repeat': note(40), 'masterFx.delay': cc(20) });
    const exported = map.exportJson();
    map.clearAll();
    expect(map.importJson(exported)).toEqual({ ok: true });
    await flush();
    port().noteOn(1, 40);
    expect(repeat.down).toHaveBeenCalledTimes(1);
  });
});
