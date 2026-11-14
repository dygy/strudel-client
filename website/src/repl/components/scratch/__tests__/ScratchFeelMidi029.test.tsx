// @vitest-environment jsdom
/**
 * @spec: 029-scratch-feel-midi-learn (functional §2; tech: runtime and UI)
 * The runtime's learnFeel / forgetFeel / cancelFeelLearn and its feelMidi state, wired to the real
 * createMidiFeel with a fake WebMidi; the Learn / Forget buttons next to Brake and Spin-up (a CC
 * moves the slider through setFeel, Esc cancels, timeout and conflict messages), hidden without
 * Web MIDI; a stored knob reconnects on restoreMidi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@src/i18n/i18n';
import { settingsMap } from '@src/settings';
import {
  MIDI_FEEL_LEARN_TIMEOUT_MS,
  MIDI_FEEL_STORAGE_KEY,
  MIDI_JOG_STORAGE_KEY,
  ScratchController,
  createMidiFeel,
  createMidiJog,
} from '@strudel/mixer';
import { ScratchSection } from '../ScratchSection';
import {
  createScratchRuntime,
  readScratchFeel,
  writeScratchFeel,
  SCRATCH_FEEL_STORAGE_KEY,
  type ScratchRuntimeDeps,
} from '../../../scratch/scratchRuntime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeInput(name: string) {
  const listeners = new Set<(e: unknown) => void>();
  return {
    name,
    listeners,
    addListener: (type: string, fn: (e: unknown) => void) => type === 'midimessage' && listeners.add(fn),
    removeListener: (type: string, fn: (e: unknown) => void) => type === 'midimessage' && listeners.delete(fn),
    cc(channel: number, controller: number, value: number) {
      for (const fn of [...listeners])
        fn({ message: { statusByte: 0xb0 | (channel - 1), dataBytes: [controller, value] } });
    },
  };
}

let input: ReturnType<typeof makeInput>;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

const flush = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

function pageLoad({ midi = true }: { midi?: boolean } = {}) {
  const WebMidi = { inputs: [input], addListener: () => {}, removeListener: () => {} };
  const loadMidi = async () => ({ WebMidi, enableWebMidi: async () => WebMidi });
  const deps: ScratchRuntimeDeps = {
    createController: () => new ScratchController(),
    createDeck: () => {
      throw new Error('not used');
    },
    loadMidiJog: async (target) => createMidiJog(target as never, { loadMidi, storage: localStorage }),
    readSelected: () => 'main',
    writeSelected: () => {},
    midiSupported: () => midi,
    hasStoredMidiMapping: () => false,
    readFeel: readScratchFeel,
    writeFeel: writeScratchFeel,
    loadMidiFeel: async (target) => createMidiFeel(target, { loadMidi, storage: localStorage }),
    hasStoredFeelMidiMapping: () => localStorage.getItem(MIDI_FEEL_STORAGE_KEY) !== null,
    eventTarget: new EventTarget(),
  };
  return createScratchRuntime(deps);
}

function mount(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}
const q = (sel: string) => container!.querySelector<HTMLElement>(sel);
const click = (el: HTMLElement) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  if (settingsMap.get().language !== 'en') settingsMap.setKey('language', 'en');
  localStorage.clear();
  vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: () => Promise.resolve({}) });
  input = makeInput('Knobs');
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('runtime (spec 029)', () => {
  it('learnFeel: CC 21 drives Brake through setFeel (stored like a slider move): 0 → 0.02 s, 127 → 1 s', async () => {
    const runtime = pageLoad();
    const learned = runtime.learnFeel('brake');
    await flush();
    expect(runtime.store.get().feelMidi.learning).toBe('brake');
    input.cc(1, 21, 0);
    await expect(learned).resolves.toMatchObject({ status: 'learned' });
    expect(runtime.store.get().feelMidi.mappings.brake).toEqual({ inputName: 'Knobs', channel: 1, controller: 21 });
    expect(runtime.store.get().feel.brakeSeconds).toBe(0.02);
    input.cc(1, 21, 127);
    expect(runtime.store.get().feel.brakeSeconds).toBe(1);
    expect(JSON.parse(localStorage.getItem(SCRATCH_FEEL_STORAGE_KEY)!).brakeSeconds).toBe(1);
  });

  it('a stored knob reconnects on restoreMidi after a reload; forgetFeel removes it', async () => {
    const first = pageLoad();
    const learned = first.learnFeel('spinUp');
    await flush();
    input.cc(1, 22, 64);
    await learned;

    input = makeInput('Knobs');
    const runtime = pageLoad();
    await runtime.restoreMidi();
    await flush();
    expect(runtime.store.get().feelMidi.mappings.spinUp?.controller).toBe(22);
    input.cc(1, 22, 127);
    expect(runtime.store.get().feel.spinUpSeconds).toBe(2);

    runtime.forgetFeel('spinUp');
    expect(runtime.store.get().feelMidi.mappings.spinUp).toBeNull();
    expect(localStorage.getItem(MIDI_FEEL_STORAGE_KEY)).toBeNull();
    input.cc(1, 22, 0);
    expect(runtime.store.get().feel.spinUpSeconds).toBe(2);
  });

  it('a timeout or a jog conflict leaves a message and keeps the previous knob', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.setItem(
      MIDI_JOG_STORAGE_KEY,
      JSON.stringify({ inputName: 'Knobs', channel: 1, controller: 10, encoding: 'twos-complement' }),
    );
    const runtime = pageLoad();
    const timedOut = runtime.learnFeel('brake');
    await flush();
    vi.advanceTimersByTime(MIDI_FEEL_LEARN_TIMEOUT_MS);
    await expect(timedOut).resolves.toEqual({ status: 'timeout' });
    expect(runtime.store.get().feelMidi.message).toEqual({ target: 'brake', kind: 'timeout' });

    const refused = runtime.learnFeel('brake');
    await flush();
    expect(runtime.store.get().feelMidi.message).toBeNull();
    input.cc(1, 10, 1);
    await expect(refused).resolves.toMatchObject({ status: 'conflict', with: 'jog' });
    expect(runtime.store.get().feelMidi.message).toEqual({ target: 'brake', kind: 'conflict', control: 10 });
    expect(runtime.store.get().feelMidi.mappings.brake).toBeNull();
  });
});

describe('ScratchSection (spec 029)', () => {
  it('Learn next to Brake: a CC moves the Brake slider; Forget appears and removes the knob', async () => {
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    const learn = q('[data-scratch-feel-learn="brake"]')!;
    expect(q('[data-scratch-feel-learn="spinUp"]')).not.toBeNull();
    expect(learn.textContent).toBe('Learn');
    click(learn);
    await flush();
    expect(q('[data-scratch-feel-midi-status="learning"]')!.textContent).toBe('Turn a knob on your controller…');
    act(() => input.cc(2, 21, 127));
    await flush();
    const slider = q('#scratch-feel-brakeSeconds') as HTMLInputElement;
    expect(Number(slider.value)).toBe(1);
    expect(q('[data-scratch-feel-midi="brake"] [data-scratch-feel-midi-status="assigned"]')!.textContent).toContain(
      'control 21, channel 2',
    );
    click(q('[data-scratch-feel-forget="brake"]')!);
    expect(q('[data-scratch-feel-forget="brake"]')).toBeNull();
    expect(runtime.store.get().feelMidi.mappings.brake).toBeNull();
  });

  it('Esc cancels a Learn and keeps the previous knob', async () => {
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    click(q('[data-scratch-feel-learn="spinUp"]')!);
    await flush();
    expect(runtime.store.get().feelMidi.learning).toBe('spinUp');
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await flush();
    expect(runtime.store.get().feelMidi.learning).toBeNull();
    act(() => input.cc(1, 22, 5));
    expect(runtime.store.get().feelMidi.mappings.spinUp).toBeNull();
  });

  it('a second press cancels', async () => {
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    click(q('[data-scratch-feel-learn="brake"]')!);
    await flush();
    click(q('[data-scratch-feel-learn="brake"]')!);
    await flush();
    expect(runtime.store.get().feelMidi.learning).toBeNull();
  });

  it('a conflict shows the message', async () => {
    localStorage.setItem(
      MIDI_JOG_STORAGE_KEY,
      JSON.stringify({ inputName: 'Knobs', channel: 1, controller: 10, encoding: 'twos-complement' }),
    );
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    click(q('[data-scratch-feel-learn="brake"]')!);
    await flush();
    act(() => input.cc(1, 10, 1));
    await flush();
    expect(q('[data-scratch-feel-midi-status="conflict"]')!.textContent).toBe(
      'Control 10 is already used by the jog wheel or the other slider. Nothing changed.',
    );
  });

  it('without Web MIDI the Learn buttons are hidden', () => {
    const runtime = pageLoad({ midi: false });
    mount(<ScratchSection runtime={runtime} />);
    expect(q('[data-scratch-feel-learn]')).toBeNull();
    expect(q('#scratch-feel-brakeSeconds')).not.toBeNull();
  });

  it('review: the jog Learn refuses a Brake knob control and says so', async () => {
    localStorage.setItem(
      MIDI_FEEL_STORAGE_KEY,
      JSON.stringify({ brake: { inputName: 'Knobs', channel: 1, controller: 21 } }),
    );
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    click(q('[data-scratch-midi-learn]')!);
    await flush();
    act(() => {
      for (let i = 0; i < 3; i++) input.cc(1, 21, 1);
    });
    await flush();
    expect(q('[data-scratch-midi-conflict]')!.textContent).toBe(
      'Control 21 is already used by the Brake or Spin-up knob. Nothing changed.',
    );
    expect(q('[data-scratch-midi-timeout]')).toBeNull();
    expect(runtime.store.get().midi.mapping).toBeNull();
  });
});
