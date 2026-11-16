// @vitest-environment jsdom
/**
 * @spec: 031-midi-mapping (§2.2 "Already used by …"; review #7)
 * A jog or feel Learn refused because a MIDI map target holds the control names that target in the
 * current language (the runtime passes `with`/`target` through), not its raw id; midiFeel's
 * `labelOf` names it in the result too. The 029 messages for the jog and the knobs are unchanged.
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
  MIDI_FEEL_STORAGE_KEY,
  MIDI_MAP_STORAGE_KEY,
  ScratchController,
  createMidiFeel,
  createMidiJog,
} from '@strudel/mixer';
import { ScratchSection } from '../ScratchSection';
import {
  createScratchRuntime,
  readScratchFeel,
  writeScratchFeel,
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

const bindCrossfader = () =>
  localStorage.setItem(
    MIDI_MAP_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      bindings: { 'mixer.crossfader': { inputName: 'Knobs', kind: 'cc', channel: 1, number: 21 } },
    }),
  );

describe('a Learn refused by a MIDI map binding names the target', () => {
  it('the feel knob says "already used by Crossfader"', async () => {
    bindCrossfader();
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    click(q('[data-scratch-feel-learn="brake"]')!);
    await flush();
    act(() => input.cc(1, 21, 1));
    await flush();
    expect(runtime.store.get().feelMidi.message).toMatchObject({ kind: 'conflict', holder: 'map:mixer.crossfader' });
    expect(q('[data-scratch-feel-midi-status="conflict"]')!.textContent).toBe(
      'Control 21 is already used by Crossfader. Nothing changed.',
    );
  });

  it('the jog says "already used by Crossfader"', async () => {
    bindCrossfader();
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    click(q('[data-scratch-midi-learn]')!);
    await flush();
    act(() => {
      for (let i = 0; i < 3; i++) input.cc(1, 21, 1);
    });
    await flush();
    expect(q('[data-scratch-midi-conflict]')!.textContent).toBe(
      'Control 21 is already used by Crossfader. Nothing changed.',
    );
  });

  it('midiFeel names the map target through labelOf; without it, the id', async () => {
    bindCrossfader();
    const WebMidi = { inputs: [input], addListener: () => {}, removeListener: () => {} };
    const loadMidi = async () => ({ WebMidi, enableWebMidi: async () => WebMidi });
    const named = createMidiFeel(
      { setFeel: () => {} },
      { loadMidi, storage: localStorage, labelOf: () => 'Crossfader' },
    );
    const learning = named.learn('brake');
    await flush();
    input.cc(1, 21, 1);
    await expect(learning).resolves.toMatchObject({ with: 'map', target: 'mixer.crossfader', label: 'Crossfader' });
    named.destroy();
    const plain = createMidiFeel({ setFeel: () => {} }, { loadMidi, storage: localStorage });
    const again = plain.learn('brake');
    await flush();
    input.cc(1, 21, 1);
    await expect(again).resolves.toMatchObject({ label: 'mixer.crossfader' });
    plain.destroy();
  });
});
