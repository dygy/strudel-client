// @vitest-environment jsdom
/**
 * @spec: 031-midi-mapping (functional §2.1 buttons, §2.2 the MIDI panel, §2.3 soft takeover; task 5.1)
 * The REAL map engine (createMidiMap) behind the REAL hook (useMidiMap), the MIDI panel and the
 * Mixer settings sliders, with only Web MIDI faked at the boundary: `loadMidi` asks
 * `navigator.requestMIDIAccess` (a spy) before handing out a fake WebMidi, as `@strudel/midi` does.
 *
 * - §2.2: the browser is asked for MIDI only on Learn or with stored bindings; Learn through the
 *   panel's button (3 messages bind, one stray doesn't); Esc cancels and keeps the old binding; a
 *   refused Learn names the holder; Import of a malformed file changes nothing; no Web MIDI
 *   disables every Learn.
 * - §2.1: a Cue/Go pad drives the real set player: Cue, then Go; a held pad (note or CC) acts once.
 * - §2.3: an on-screen change (speakers slider, EQ panel band) drops the pickup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
// settings.ts imports repl/util, which pulls the whole tidal package.
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { atom } from 'nanostores';
import { createMidiMap, MIDI_MAP_STORAGE_KEY } from '@strudel/mixer';
import i18n from '@src/i18n/i18n';
import { useMidiMap, MidiMapContext, type UseMidiMapOptions } from '../useMidiMap';
import { activeEqSettings, resetEqStoreForTests, setEqBand } from '../../eqStore';
import { getSpeakersVolume, resetSpeakersVolumeForTests } from '../../speakersVolume';
import { resetHeadphonesVolumeForTests } from '../../headphonesVolume';
import { MidiSettings } from '../../components/panel/MidiSettings';
import { MixerLevels } from '../../components/panel/MixerLevels';
import { SetPlayerContext, type SetPlayerContextValue } from '../../sets/useSetPlayer';
import { createSetPlayerController } from '../../sets/setPlayerController';
import type { PlayerSet } from '../../sets/setPlayer';
import type { ScratchRuntime } from '../../scratch/scratchRuntime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------------------------
// Web MIDI at the boundary.

type Listener = (event: { message: { statusByte: number; dataBytes: number[] } }) => void;

function makeInput(name: string) {
  const listeners = new Set<Listener>();
  const send = (statusByte: number, dataBytes: number[]) =>
    act(() => {
      for (const fn of [...listeners]) fn({ message: { statusByte, dataBytes } });
    });
  return {
    name,
    addListener: (type: string, fn: Listener) => void (type === 'midimessage' && listeners.add(fn)),
    removeListener: (type: string, fn: Listener) => void (type === 'midimessage' && listeners.delete(fn)),
    cc: (controller: number, value: number, channel = 1) => send(0xb0 | (channel - 1), [controller, value]),
    noteOn: (note: number, velocity = 100, channel = 1) => send(0x90 | (channel - 1), [note, velocity]),
    noteOff: (note: number, channel = 1) => send(0x80 | (channel - 1), [note, 0]),
  };
}

function makeMidi() {
  const port = makeInput('Launch Control');
  const WebMidi = {
    inputs: [port],
    addListener: () => {},
    removeListener: () => {},
  };
  return { port, WebMidi, enableWebMidi: vi.fn(() => Promise.resolve(WebMidi)) };
}

let requestMIDIAccess: ReturnType<typeof vi.fn>;
let midi: ReturnType<typeof makeMidi>;
let clock = 0;

function supportMidi() {
  requestMIDIAccess = vi.fn(() => Promise.resolve({}));
  Object.defineProperty(globalThis.navigator, 'requestMIDIAccess', {
    configurable: true,
    writable: true,
    value: requestMIDIAccess,
  });
}
function dropMidiSupport() {
  delete (globalThis.navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess;
}

/** The real engine; only the `@strudel/midi` import and the Learn clock are injected. */
const realMap: UseMidiMapOptions['createMap'] = (options = {}) =>
  createMidiMap({
    ...options,
    loadMidi: async () => {
      await navigator.requestMIDIAccess();
      return midi as never;
    },
    now: () => clock,
  });

// ---------------------------------------------------------------------------------------------
// The REPL around it.

function fakeRuntime() {
  const store = atom({
    midi: { state: 'off', mapping: null, lastLearn: null },
    feelMidi: { state: 'off', learning: null, mappings: { brake: null, spinUp: null }, message: null },
  });
  return { store, midiLearn: vi.fn(), midiForget: vi.fn(), learnFeel: vi.fn(), forgetFeel: vi.fn() };
}

function Harness({ options, children }: { options: UseMidiMapOptions; children?: ReactNode }) {
  const value = useMidiMap(options);
  return <MidiMapContext.Provider value={value}>{children}</MidiMapContext.Provider>;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render({ setPlayer = null as SetPlayerContextValue | null } = {}) {
  const options: UseMidiMapOptions = {
    context: {
      handleTogglePlay: vi.fn(),
      handleEvaluate: vi.fn(),
      trackIds: () => ({ editor: 't1', playing: 't1' }),
      manualMix: {
        isPlaying: () => true,
        beginEditor: vi.fn(async () => 'ignored' as const),
        setProgress: () => false,
        handOver: () => false,
      },
    },
    mixer: null,
    setPlayer,
    createMap: realMap,
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <SetPlayerContext.Provider value={setPlayer}>
        <Harness options={options}>
          <MidiSettings runtime={fakeRuntime() as unknown as ScratchRuntime} />
          <MixerLevels mixer={null} />
        </Harness>
      </SetPlayerContext.Provider>,
    ),
  );
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
const q = <T extends Element = HTMLElement>(selector: string) => container!.querySelector<T>(selector);
const rowOf = (id: string) => q(`[data-midi-row="${id}"]`)!;
const bindingOf = (id: string) => rowOf(id).querySelector('[data-midi-binding]')!.textContent;
const noteOf = (id: string) => rowOf(id).querySelector('[data-midi-note]')?.textContent ?? null;
const storedBindings = () => JSON.parse(localStorage.getItem(MIDI_MAP_STORAGE_KEY) ?? 'null')?.bindings ?? null;
const cc = (number: number) => ({ inputName: 'Launch Control', kind: 'cc', channel: 1, number });
const note = (number: number) => ({ inputName: 'Launch Control', kind: 'note', channel: 1, number });

async function pressLearn(id: string) {
  act(() => q<HTMLButtonElement>(`[data-midi-learn="${id}"]`)!.click());
  await flush();
}
/** Three messages of one CC within 300 ms: the continuous Learn rule. */
function turn(number: number, values = [60, 61, 62]) {
  for (const value of values) {
    midi.port.cc(number, value);
    clock += 50;
  }
}
function drag(input: HTMLInputElement, to: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, to);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function pick(text: string) {
  const input = q<HTMLInputElement>('[data-midi-import-file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'map.json')] });
  const before = q('[data-midi-message]')?.textContent ?? null;
  act(() => void input.dispatchEvent(new Event('change', { bubbles: true })));
  // The file is read asynchronously: wait for the panel's message to change (a slow run takes longer).
  for (let i = 0; i < 200 && (q('[data-midi-message]')?.textContent ?? null) === before; i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings']);
  localStorage.clear();
  resetEqStoreForTests();
  resetSpeakersVolumeForTests();
  resetHeadphonesVolumeForTests();
  midi = makeMidi();
  clock = 0;
  supportMidi();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  dropMidiSupport();
  resetEqStoreForTests();
  resetSpeakersVolumeForTests();
  resetHeadphonesVolumeForTests();
  vi.restoreAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------------------------
describe('§2.2 MIDI access is asked only when needed', () => {
  it('no stored bindings: the page load does not ask the browser; pressing Learn does', async () => {
    render();
    await flush();
    expect(requestMIDIAccess).not.toHaveBeenCalled();
    expect(q('[data-midi-status]')!.textContent).toBe('Allow MIDI to start: press Learn on a row');
    await pressLearn('eq.band.1');
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
    expect(q('[data-midi-status]')!.textContent).toBe('Connected: Launch Control');
  });

  it('stored bindings: asked at load, and the binding drives Band 3 over ±24 dB with no Learn (reload)', async () => {
    localStorage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify({ version: 1, bindings: { 'eq.band.3': cc(20) } }));
    render();
    await flush();
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
    expect(bindingOf('eq.band.3')).toBe('Launch Control · ch 1 · CC 20');
    midi.port.cc(20, 64); // ~0 dB: picks the band up at its current 0 dB
    expect(activeEqSettings().bands[2].gain).toBe(0);
    midi.port.cc(20, 127);
    expect(activeEqSettings().bands[2].gain).toBe(24);
    midi.port.cc(20, 0);
    expect(activeEqSettings().bands[2].gain).toBe(-24);
  });
});

describe('§2.2 Learn through the panel', () => {
  it('three CC 21 messages within 300 ms bind Band 1, shown and stored', async () => {
    render();
    await pressLearn('eq.band.1');
    expect(noteOf('eq.band.1')).toBe('Move a control… (Esc cancels)');
    turn(21);
    expect(bindingOf('eq.band.1')).toBe('Launch Control · ch 1 · CC 21');
    expect(storedBindings()).toEqual({ 'eq.band.1': cc(21) });
  });

  it('negative: three messages from different CCs within 300 ms bind nothing (the 3 must be one CC)', async () => {
    render();
    await pressLearn('eq.band.1');
    midi.port.cc(21, 60);
    clock += 50;
    midi.port.cc(22, 60);
    clock += 50;
    midi.port.cc(21, 61);
    expect(bindingOf('eq.band.1')).toBe('—');
    expect(storedBindings()).toBeNull();
    expect(noteOf('eq.band.1')).toBe('Move a control… (Esc cancels)');
  });

  it('Esc cancels: the row says Cancelled, the old binding stays, and a later turn binds nothing', async () => {
    render();
    await pressLearn('eq.band.1');
    turn(21);
    await pressLearn('eq.band.1');
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(noteOf('eq.band.1')).toBe('Cancelled');
    turn(22);
    expect(bindingOf('eq.band.1')).toBe('Launch Control · ch 1 · CC 21');
    expect(storedBindings()).toEqual({ 'eq.band.1': cc(21) });
  });

  it('negative: without Esc the armed row binds the next control (the cancel is what kept it)', async () => {
    render();
    await pressLearn('eq.band.1');
    turn(21);
    await pressLearn('eq.band.1');
    turn(22);
    expect(bindingOf('eq.band.1')).toBe('Launch Control · ch 1 · CC 22');
  });

  it('a control bound to Band 1 is refused on Band 2 with "Already used by Band 1"; Band 1 keeps it', async () => {
    render();
    await pressLearn('eq.band.1');
    turn(21);
    await pressLearn('eq.band.2');
    turn(21);
    expect(noteOf('eq.band.2')).toBe('Already used by Band 1');
    expect(bindingOf('eq.band.2')).toBe('—');
    expect(storedBindings()).toEqual({ 'eq.band.1': cc(21) });
  });
});

describe('§2.2 Import', () => {
  it('a malformed file changes nothing: bindings, storage and the knob all stay, and it says why', async () => {
    render();
    await pressLearn('eq.band.1');
    turn(21);
    const before = localStorage.getItem(MIDI_MAP_STORAGE_KEY);
    for (const [file, message] of [
      ['{nope', "That file isn't JSON. Nothing changed."],
      [
        '{"version":1,"bindings":{"eq.band.2":{"kind":"cc"}}}',
        'A binding in that file is damaged (Band 2). Nothing changed.',
      ],
    ]) {
      await pick(file);
      expect(q('[data-midi-message="error"]')!.textContent).toBe(message);
      expect(localStorage.getItem(MIDI_MAP_STORAGE_KEY)).toBe(before);
      expect(bindingOf('eq.band.1')).toBe('Launch Control · ch 1 · CC 21');
    }
  });

  it('positive: an exported file, imported after Clear all, restores every binding', async () => {
    render();
    await pressLearn('eq.band.1');
    turn(21);
    await pressLearn('set.cueGo');
    midi.port.noteOn(36);
    const file = localStorage.getItem(MIDI_MAP_STORAGE_KEY)!;
    act(() => q<HTMLButtonElement>('[data-midi-clear-all]')!.click());
    act(() => q<HTMLButtonElement>('[data-midi-clear-all-yes]')!.click());
    expect(storedBindings()).toBeNull();
    await pick(file);
    expect(q('[data-midi-message="ok"]')!.textContent).toBe('Bindings imported');
    expect(storedBindings()).toEqual({ 'eq.band.1': cc(21), 'set.cueGo': note(36) });
  });
});

describe('§2.2 a browser without Web MIDI', () => {
  it('says so, every Learn button (scratch rows too) is disabled', async () => {
    dropMidiSupport();
    render();
    await flush();
    expect(q('[data-midi-status]')!.textContent).toBe('No MIDI support in this browser');
    const learns = [...container!.querySelectorAll<HTMLButtonElement>('[data-midi-learn]')];
    expect(learns.length).toBe(24); // 21 targets + jog + 2 feel knobs
    expect(learns.every((button) => button.disabled)).toBe(true);
  });

  it('negative: with Web MIDI every Learn button is enabled', async () => {
    render();
    await flush();
    const learns = [...container!.querySelectorAll<HTMLButtonElement>('[data-midi-learn]')];
    expect(learns.length).toBe(24);
    expect(learns.some((button) => button.disabled)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('§2.1 a Cue/Go pad drives the real set player', () => {
  function setPlayerSetup() {
    const set: PlayerSet = {
      id: 's1',
      items: [
        { id: 'a', trackId: 't1', transition: null },
        { id: 'b', trackId: 't2', transition: null },
      ],
    };
    const bridge = {
      openItem: vi.fn(async () => 'opened' as const),
      cue: vi.fn(async () => 'playing' as const),
      go: vi.fn(() => new Promise<'switched'>(() => {})), // the Go stays in flight
      stopPreview: vi.fn(),
      redirectEditorToPreview: vi.fn(() => () => {}),
      removeRedirect: vi.fn(),
      onPreviewStopped: vi.fn(() => () => {}),
      setGoHandler: vi.fn(),
    };
    const controller = createSetPlayerController({
      bridge: bridge as never,
      getSet: (id) => (id === set.id ? set : null),
      getTracks: () => ({ t1: { id: 't1', name: 'One' }, t2: { id: 't2', name: 'Two' } }) as never,
    });
    controller.start('s1', 'b');
    const setPlayer = {
      enabled: true,
      get player() {
        return controller.getState();
      },
      press: () => void controller.press(),
    } as unknown as SetPlayerContextValue;
    return { controller, bridge, setPlayer };
  }

  it('note 36: the first hit Cues, a hit while still held does nothing, the next hit Goes', async () => {
    localStorage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify({ version: 1, bindings: { 'set.cueGo': note(36) } }));
    const { controller, bridge, setPlayer } = setPlayerSetup();
    render({ setPlayer });
    await flush();
    midi.port.noteOn(36);
    await flush();
    expect(controller.getState().phase).toBe('cued');
    midi.port.noteOn(36); // held: no note-off since
    await flush();
    expect(controller.getState().phase).toBe('cued');
    expect(bridge.go).not.toHaveBeenCalled();
    midi.port.noteOff(36);
    await flush();
    expect(controller.getState().phase).toBe('cued'); // a release does nothing
    midi.port.noteOn(36);
    await flush();
    expect(controller.getState().phase).toBe('going');
    expect(bridge.go).toHaveBeenCalledTimes(1);
    expect(bridge.cue).toHaveBeenCalledTimes(1);
  });

  it('a CC pad: ≥ 64 Cues, a repeated ≥ 64 (held) does nothing, < 64 then ≥ 64 Goes', async () => {
    localStorage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify({ version: 1, bindings: { 'set.cueGo': cc(50) } }));
    const { controller, bridge, setPlayer } = setPlayerSetup();
    render({ setPlayer });
    await flush();
    midi.port.cc(50, 127);
    await flush();
    expect(controller.getState().phase).toBe('cued');
    midi.port.cc(50, 100);
    midi.port.cc(50, 127);
    await flush();
    expect(controller.getState().phase).toBe('cued');
    expect(bridge.go).not.toHaveBeenCalled();
    midi.port.cc(50, 0);
    await flush();
    expect(controller.getState().phase).toBe('cued');
    midi.port.cc(50, 127);
    await flush();
    expect(controller.getState().phase).toBe('going');
    expect(bridge.go).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe('§2.3 soft takeover end to end', () => {
  it('speakers 80 %, fader at 10 %: 20 % changes nothing, passing 80 % drives it; the row says Move to pick up', async () => {
    localStorage.setItem('strudel-volume-speakers', '0.8');
    localStorage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify({ version: 1, bindings: { 'mixer.speakers': cc(7) } }));
    render();
    await flush();
    midi.port.cc(7, 13);
    midi.port.cc(7, 25);
    expect(getSpeakersVolume()).toBe(0.8);
    expect(noteOf('mixer.speakers')).toBe('Move to pick up');
    midi.port.cc(7, 110); // crosses 0.8
    expect(getSpeakersVolume()).toBeCloseTo(110 / 127, 9);
    expect(noteOf('mixer.speakers')).toBeNull();
    expect(q('[data-mixer-level="speakers"] [data-mixer-level-value]')!.textContent).toBe('87%'); // the slider follows
  });

  it('the on-screen speakers slider drops the pickup: the fader must reach the new value again', async () => {
    localStorage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify({ version: 1, bindings: { 'mixer.speakers': cc(7) } }));
    render();
    await flush();
    midi.port.cc(7, 127); // at unity: within 2 %, picked
    midi.port.cc(7, 114); // 0.898
    expect(getSpeakersVolume()).toBeCloseTo(114 / 127, 9);
    drag(q<HTMLInputElement>('#mixer-level-speakers')!, '30');
    expect(getSpeakersVolume()).toBe(0.3);
    expect(noteOf('mixer.speakers')).toBe('Move to pick up');
    midi.port.cc(7, 110); // the fader moves on the far side of 30 %
    expect(getSpeakersVolume()).toBe(0.3);
    midi.port.cc(7, 30); // 0.236: crossed 0.3
    expect(getSpeakersVolume()).toBeCloseTo(30 / 127, 9);
  });

  it('negative: without an on-screen change a picked-up fader keeps driving at once', async () => {
    localStorage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify({ version: 1, bindings: { 'mixer.speakers': cc(7) } }));
    render();
    await flush();
    midi.port.cc(7, 127);
    midi.port.cc(7, 110);
    expect(getSpeakersVolume()).toBeCloseTo(110 / 127, 9);
    expect(noteOf('mixer.speakers')).toBeNull();
  });

  it('a band dragged on screen drops its knob’s pickup; the knob’s own writes never do', async () => {
    localStorage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify({ version: 1, bindings: { 'eq.band.3': cc(20) } }));
    render();
    await flush();
    midi.port.cc(20, 64); // picks up at 0 dB
    midi.port.cc(20, 80);
    expect(activeEqSettings().bands[2].gain).toBe(6);
    expect(noteOf('eq.band.3')).toBeNull(); // its own writes keep it picked up
    act(() => void setEqBand(2, { gain: -12 }, [], 'panel:1'));
    expect(noteOf('eq.band.3')).toBe('Move to pick up');
    midi.port.cc(20, 90);
    expect(activeEqSettings().bands[2].gain).toBe(-12);
  });
});
