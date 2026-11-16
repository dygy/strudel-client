// @vitest-environment jsdom
/**
 * @spec: 031-midi-mapping (§2.2 the MIDI panel, §2.3 "Move to pick up"; tech §2.6 MidiSettings, §4 web)
 * The status line for every MIDI state ('failed' included); every target in its group with its
 * binding, Learn and Clear; a row's Learn states (learning, timed out, cancelled, refused naming the
 * holder, MIDI unavailable, waiting for pickup); Learn disabled without Web MIDI; Clear all asks in
 * the panel (never window.confirm); Export downloads strudel-midi-map.json; Import reports errors;
 * the scratch jog and feel knobs are listed with their own Learn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

// settings.ts (through scratchRuntime) imports repl/util, which pulls the whole tidal package.
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { atom } from 'nanostores';
import type { MidiMap, MidiMapState } from '@strudel/mixer';
import i18n from '@src/i18n/i18n';
import { MidiSettings } from '../MidiSettings';
import { MidiMapContext, type MidiMapContextValue } from '../../../midi/midiMapContext';
import { createCrossfader } from '../../../midi/crossfader';
import type { ScratchRuntime } from '../../../scratch/scratchRuntime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const BASE: MidiMapState = {
  status: 'ready',
  inputs: ['Launch Control'],
  learning: null,
  bindings: {},
  awaitingPickup: [],
  lastLearn: null,
};

function fakeMap() {
  return {
    learn: vi.fn(async () => ({ ok: false as const, reason: 'cancelled' as const })),
    cancelLearn: vi.fn(),
    clear: vi.fn(),
    clearAll: vi.fn(),
    bindings: vi.fn(() => ({})),
    exportJson: vi.fn(() => '{"version":1,"bindings":{}}'),
    importJson: vi.fn((): ReturnType<MidiMap['importJson']> => ({ ok: true })),
    status: vi.fn(),
    getState: vi.fn(),
    setTargets: vi.fn(),
    notifyExternalChange: vi.fn(),
    isPickedUp: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    ready: Promise.resolve(),
    destroy: vi.fn(),
  };
}

function fakeRuntime() {
  const store = atom({
    midi: {
      state: 'off',
      mapping: { inputName: 'Jogger', channel: 2, controller: 30, encoding: 'twos' },
      lastLearn: null,
    },
    feelMidi: { state: 'off', learning: null, mappings: { brake: null, spinUp: null }, message: null },
  });
  return {
    store,
    midiLearn: vi.fn(async () => null),
    midiForget: vi.fn(),
    learnFeel: vi.fn(async () => ({ status: 'cancelled' })),
    forgetFeel: vi.fn(),
  };
}

function render(state: Partial<MidiMapState> = {}, map = fakeMap(), runtime = fakeRuntime()) {
  const value: MidiMapContextValue = {
    map: map as unknown as MidiMap,
    state: { ...BASE, ...state },
    crossfader: createCrossfader(),
    notifyExternalChange: vi.fn(),
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <MidiMapContext.Provider value={value}>
        <MidiSettings runtime={runtime as unknown as ScratchRuntime} />
      </MidiMapContext.Provider>,
    ),
  );
  return { map, runtime };
}

const q = <T extends Element = HTMLElement>(selector: string) => container!.querySelector<T>(selector);
const row = (id: string) => q(`[data-midi-row="${id}"]`)!;
const click = (element: Element | null) => act(() => (element as HTMLElement).click());

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings']);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  vi.restoreAllMocks();
});

describe('the status line', () => {
  it.each([
    ['unsupported', 'No MIDI support in this browser'],
    ['idle', 'Allow MIDI to start: press Learn on a row'],
    ['denied', 'Permission denied'],
    ['failed', 'MIDI could not be started'],
  ] as const)('%s', (status, text) => {
    render({ status, inputs: [] });
    expect(q('[data-midi-status]')!.textContent).toBe(text);
  });

  it('ready names the connected inputs, or says none is connected', () => {
    render({ inputs: ['Launch Control', 'nanoKONTROL'] });
    expect(q('[data-midi-status]')!.textContent).toBe('Connected: Launch Control, nanoKONTROL');
    act(() => root!.unmount());
    container!.remove();
    render({ inputs: [] });
    expect(q('[data-midi-status]')!.textContent).toBe('MIDI is on, but no controller is connected');
  });

  it('without Web MIDI every Learn is disabled', () => {
    render({ status: 'unsupported', inputs: [] });
    const learns = [...container!.querySelectorAll<HTMLButtonElement>('[data-midi-learn]')];
    expect(learns.length).toBeGreaterThan(20);
    expect(learns.every((button) => button.disabled)).toBe(true);
  });
});

describe('rows', () => {
  it('lists every target in its group, plus the jog and feel knobs', () => {
    render();
    const groups = [...container!.querySelectorAll('[data-midi-group]')].map((g) => g.getAttribute('data-midi-group'));
    expect(groups).toEqual(['eq', 'mixer', 'masterFx', 'set', 'transport', 'transition', 'view', 'scratch']);
    expect(container!.querySelectorAll('[data-midi-group="eq"] [data-midi-row]')).toHaveLength(12);
    // Spec 032 §2.7: filter, four holds, repeat length.
    expect(container!.querySelectorAll('[data-midi-group="masterFx"] [data-midi-row]')).toHaveLength(6);
    expect(row('masterFx.repeat').textContent).toContain('Beat-repeat');
    expect(row('eq.band.3').textContent).toContain('Band 3');
    expect(row('mixer.crossfader').textContent).toContain('Crossfader');
    expect(row('scratch.jog').textContent).toContain('Jogger · ch 2 · CC 30');
  });

  it('shows a binding, and — without one; Learn and Clear call the map', () => {
    const { map } = render({
      bindings: { 'eq.band.1': { inputName: 'Launch Control', kind: 'cc', channel: 1, number: 21 } },
    });
    expect(row('eq.band.1').querySelector('[data-midi-binding]')!.textContent).toBe('Launch Control · ch 1 · CC 21');
    expect(row('eq.band.2').querySelector('[data-midi-binding]')!.textContent).toBe('—');
    expect(row('eq.band.2').querySelector<HTMLButtonElement>('[data-midi-clear]')!.disabled).toBe(true);
    click(row('eq.band.1').querySelector('[data-midi-learn]'));
    expect(map.learn).toHaveBeenCalledWith('eq.band.1');
    click(row('eq.band.1').querySelector('[data-midi-clear]'));
    expect(map.clear).toHaveBeenCalledWith('eq.band.1');
  });

  it('a note binding reads as a note', () => {
    render({ bindings: { 'set.cueGo': { inputName: 'Pads', kind: 'note', channel: 10, number: 36 } } });
    expect(row('set.cueGo').querySelector('[data-midi-binding]')!.textContent).toBe('Pads · ch 10 · note 36');
  });

  it('learning, waiting for pickup, timed out and cancelled', () => {
    render({ learning: 'eq.band.1', awaitingPickup: ['mixer.speakers'] });
    expect(row('eq.band.1').querySelector('[data-midi-note]')!.textContent).toBe('Move a control… (Esc cancels)');
    expect(row('eq.band.1').querySelector('[data-midi-learn]')!.getAttribute('aria-pressed')).toBe('true');
    expect(row('mixer.speakers').querySelector('[data-midi-note]')!.textContent).toBe('Move to pick up');
    act(() => root!.unmount());
    container!.remove();
    render({ lastLearn: { targetId: 'eq.band.4', ok: false, reason: 'timeout' } });
    expect(row('eq.band.4').querySelector('[data-midi-note]')!.textContent).toBe('Timed out');
    act(() => root!.unmount());
    container!.remove();
    render({ lastLearn: { targetId: 'eq.band.4', ok: false, reason: 'cancelled' } });
    expect(row('eq.band.4').querySelector('[data-midi-note]')!.textContent).toBe('Cancelled');
  });

  it('a refused Learn names the holder in this language: another target, the jog', () => {
    render({
      lastLearn: {
        targetId: 'eq.band.2',
        ok: false,
        reason: 'conflict',
        holder: { owner: 'map:eq.band.1', label: 'x' },
      },
    });
    expect(row('eq.band.2').querySelector('[data-midi-note]')!.textContent).toBe('Already used by Band 1');
    act(() => root!.unmount());
    container!.remove();
    render({
      lastLearn: { targetId: 'set.cueGo', ok: false, reason: 'conflict', holder: { owner: 'jog', label: 'x' } },
    });
    expect(row('set.cueGo').querySelector('[data-midi-note]')!.textContent).toBe('Already used by Jog wheel');
  });

  it('a Learn that could not start says why (denied, failed)', () => {
    render({ status: 'failed', lastLearn: { targetId: 'eq.band.1', ok: false, reason: 'failed' } });
    expect(row('eq.band.1').querySelector('[data-midi-note]')!.textContent).toBe('MIDI could not be started');
    act(() => root!.unmount());
    container!.remove();
    render({ status: 'denied', lastLearn: { targetId: 'eq.band.1', ok: false, reason: 'denied' } });
    expect(row('eq.band.1').querySelector('[data-midi-note]')!.textContent).toBe('Permission denied');
  });

  it('a jog or feel Learn refused by a map binding names the target, not its id (review #7)', () => {
    const runtime = fakeRuntime();
    runtime.store.set({
      midi: {
        state: 'off',
        mapping: null,
        lastLearn: { status: 'conflict', controller: 21, with: 'map', target: 'eq.band.1', label: 'eq.band.1' },
      },
      feelMidi: {
        state: 'off',
        learning: null,
        mappings: { brake: null, spinUp: null },
        message: { target: 'brake', kind: 'conflict', control: 22, holder: 'map:mixer.crossfader' },
      },
    } as never);
    render({}, fakeMap(), runtime);
    expect(row('scratch.jog').querySelector('[data-midi-note]')!.textContent).toBe('Already used by Band 1');
    expect(row('scratch.brake').querySelector('[data-midi-note]')!.textContent).toBe('Already used by Crossfader');
  });

  it('the jog row uses the jog’s own Learn and Forget', () => {
    const { runtime } = render();
    click(row('scratch.jog').querySelector('[data-midi-learn]'));
    expect(runtime.midiLearn).toHaveBeenCalledTimes(1);
    click(row('scratch.jog').querySelector('[data-midi-clear]'));
    expect(runtime.midiForget).toHaveBeenCalledTimes(1);
    click(row('scratch.brake').querySelector('[data-midi-learn]'));
    expect(runtime.learnFeel).toHaveBeenCalledWith('brake');
  });
});

describe('Clear all', () => {
  it('asks in the panel, never in a browser dialog; Cancel keeps everything, Yes clears', () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    window.confirm = confirmSpy;
    const { map } = render({ bindings: { 'eq.band.1': { inputName: 'L', kind: 'cc', channel: 1, number: 21 } } });
    expect(q('[data-midi-clear-all-confirm]')).toBeNull();
    click(q('[data-midi-clear-all]'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(map.clearAll).not.toHaveBeenCalled();
    expect(q('[data-midi-clear-all-confirm]')!.textContent).toContain('Remove every binding in this panel?');
    click(q('[data-midi-clear-all-cancel]'));
    expect(map.clearAll).not.toHaveBeenCalled();
    expect(q('[data-midi-clear-all-confirm]')).toBeNull();
    click(q('[data-midi-clear-all]'));
    click(q('[data-midi-clear-all-yes]'));
    expect(map.clearAll).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('negative: disabled with no panel binding (the jog’s don’t count)', () => {
    render();
    expect(q<HTMLButtonElement>('[data-midi-clear-all]')!.disabled).toBe(true);
  });
});

describe('Export and Import', () => {
  it('Export downloads strudel-midi-map.json with the map’s JSON', () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    let downloaded = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this.download;
    });
    const { map } = render();
    click(q('[data-midi-export]'));
    expect(map.exportJson).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloaded).toBe('strudel-midi-map.json');
  });

  /** Pick a file and wait (however the file is read) until the panel has shown its outcome. */
  async function pick(map: ReturnType<typeof fakeMap>, text: string) {
    const input = q<HTMLInputElement>('[data-midi-import-file]')!;
    const file = new File([text], 'map.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    const calls = map.importJson.mock.calls.length;
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(map.importJson.mock.calls.length).toBe(calls + 1);
      expect(q('[data-midi-message]')).not.toBeNull();
    });
    await act(async () => {});
  }

  it('a malformed file shows why and changes nothing; a good one says imported', async () => {
    const map = fakeMap();
    map.importJson.mockReturnValueOnce({ ok: false, error: 'not-json' });
    render({}, map);
    await pick(map, 'nope');
    expect(map.importJson).toHaveBeenCalledWith('nope');
    expect(q('[data-midi-message="error"]')!.textContent).toBe("That file isn't JSON. Nothing changed.");
    await pick(map, '{"version":1,"bindings":{}}');
    expect(q('[data-midi-message="ok"]')!.textContent).toBe('Bindings imported');
  });

  it('a conflict names the holder', async () => {
    const map = fakeMap();
    map.importJson.mockReturnValueOnce({
      ok: false,
      error: 'conflict',
      detail: 'eq.band.1',
      holder: { owner: 'feel:brake', label: 'Brake' },
    });
    render({}, map);
    await pick(map, '{}');
    expect(q('[data-midi-message="error"]')!.textContent).toBe(
      'That file uses a control already used by Brake. Nothing changed.',
    );
  });
});

describe('outside the REPL', () => {
  it('renders nothing without the MIDI map context', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<MidiSettings runtime={fakeRuntime() as unknown as ScratchRuntime} />));
    expect(container.innerHTML).toBe('');
  });
});
