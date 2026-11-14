// @vitest-environment jsdom
/**
 * @spec: 029-scratch-feel-midi-learn (functional §2, acceptance criteria 1–4 and 6)
 * The AC pairs not already in ScratchFeelMidi029.test, through the rendered Scratch section with
 * the real runtime and createMidiFeel on a fake WebMidi: a mid-range CC moves the slider on the log
 * curve while other controls don't; a learned knob shows after a reload and a forgotten one doesn't;
 * a 10 s timeout or Esc keeps the previous knob; the other slider's control is refused with a
 * message while a free one is taken; and the controls render in each of the 9 languages.
 * Real MIDI hardware is a manual check (headless browsers deny Web MIDI).
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
  SCRATCH_FEEL_RANGES,
  ScratchController,
  ccToFeel,
  createMidiFeel,
} from '@strudel/mixer';
import { ScratchSection } from '../ScratchSection';
import {
  createScratchRuntime,
  readScratchFeel,
  writeScratchFeel,
  type ScratchRuntimeDeps,
} from '../../../scratch/scratchRuntime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOCALES = ['ar', 'en', 'es', 'fr', 'he', 'ko', 'ru', 'sr', 'zh'] as const;
const BRAKE = SCRATCH_FEEL_RANGES.brakeSeconds;

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

function pageLoad() {
  const WebMidi = { inputs: [input], addListener: () => {}, removeListener: () => {} };
  const loadMidi = async () => ({ WebMidi, enableWebMidi: async () => WebMidi });
  const deps: ScratchRuntimeDeps = {
    createController: () => new ScratchController(),
    createDeck: () => {
      throw new Error('not used');
    },
    loadMidiJog: async () => {
      throw new Error('not used');
    },
    readSelected: () => 'main',
    writeSelected: () => {},
    midiSupported: () => true,
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
function unmount() {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
}
/** A fresh page: new MIDI port objects, a new runtime, the stored knobs reconnected, the section mounted. */
async function reloadPage() {
  unmount();
  input = makeInput('Knobs');
  const runtime = pageLoad();
  await runtime.restoreMidi();
  mount(<ScratchSection runtime={runtime} />);
  await flush();
  return runtime;
}
const q = (sel: string) => container!.querySelector<HTMLElement>(sel);
const click = (el: HTMLElement) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const slider = (key: 'brakeSeconds' | 'spinUpSeconds') => Number((q(`#scratch-feel-${key}`) as HTMLInputElement).value);
const status = (target: 'brake' | 'spinUp') =>
  q(`[data-scratch-feel-midi="${target}"] [data-scratch-feel-midi-status]`)!;
const strings = async (locale: string): Promise<Record<string, string>> =>
  (await import(`../../../../i18n/locales/${locale}/settings.json`)).default;

/** Press Learn on `target` and turn `controller` on channel 1 to `value`. */
async function learnWith(target: 'brake' | 'spinUp', controller: number, value: number) {
  click(q(`[data-scratch-feel-learn="${target}"]`)!);
  await flush();
  act(() => input.cc(1, controller, value));
  await flush();
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  if (settingsMap.get().language !== 'en') settingsMap.setKey('language', 'en');
  await i18n.loadNamespaces('settings');
  localStorage.clear();
  vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: () => Promise.resolve({}) });
  input = makeInput('Knobs');
});

afterEach(async () => {
  unmount();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
  if (settingsMap.get().language !== 'en') settingsMap.setKey('language', 'en');
});

describe('AC 1: Learn on Brake, CC 21 drives Brake on a log curve (0 → 0.02 s, 127 → 1 s)', () => {
  it('positive: mid-range values move the Brake slider on the log curve, far below linear', async () => {
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    await learnWith('brake', 21, 0);
    expect(slider('brakeSeconds')).toBe(0.02);
    for (const value of [32, 64, 96]) {
      act(() => input.cc(1, 21, value));
      expect(slider('brakeSeconds')).toBe(ccToFeel(value, BRAKE));
    }
    act(() => input.cc(1, 21, 64));
    // Geometric, not linear: CC 64 is ~0.14 s, where a linear map would give ~0.51 s.
    expect(slider('brakeSeconds')).toBeCloseTo(0.02 * Math.pow(50, 64 / 127), 3);
    expect(slider('brakeSeconds')).toBeLessThan(0.2);
    act(() => input.cc(1, 21, 127));
    expect(slider('brakeSeconds')).toBe(1);
  });

  it('negative: other controls, and CC 21 on another channel, move neither slider', async () => {
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    await learnWith('brake', 21, 127);
    const brake = slider('brakeSeconds');
    const spin = slider('spinUpSeconds');
    act(() => {
      input.cc(1, 22, 0);
      input.cc(2, 21, 0);
    });
    expect(slider('brakeSeconds')).toBe(brake);
    expect(slider('spinUpSeconds')).toBe(spin);
  });
});

describe('AC 2: a learned knob survives a reload; Forget removes it', () => {
  it('positive: after a reload the Brake knob shows as assigned and drives the slider', async () => {
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    await learnWith('brake', 21, 64);
    await reloadPage();
    expect(q('[data-scratch-feel-forget="brake"]')).not.toBeNull();
    expect(status('brake').getAttribute('data-scratch-feel-midi-status')).toBe('assigned');
    expect(status('brake').textContent).toContain('control 21, channel 1');
    act(() => input.cc(1, 21, 0));
    expect(slider('brakeSeconds')).toBe(0.02);
  });

  it('negative: after Forget and a reload, no knob is shown and CC 21 moves nothing', async () => {
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    await learnWith('brake', 21, 127);
    click(q('[data-scratch-feel-forget="brake"]')!);
    const after = await reloadPage();
    expect(q('[data-scratch-feel-forget="brake"]')).toBeNull();
    expect(status('brake').getAttribute('data-scratch-feel-midi-status')).toBe('none');
    expect(after.store.get().feelMidi.mappings.brake).toBeNull();
    act(() => input.cc(1, 21, 0));
    expect(slider('brakeSeconds')).toBe(1);
  });
});

describe('AC 3: Learn times out after 10 s, or is cancelled with Esc, keeping the previous knob', () => {
  it('positive: after 10 s with no knob, the timeout message shows and CC 21 still drives Brake', async () => {
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    await learnWith('brake', 21, 127);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    click(q('[data-scratch-feel-learn="brake"]')!);
    await flush();
    act(() => vi.advanceTimersByTime(MIDI_FEEL_LEARN_TIMEOUT_MS));
    await flush();
    expect(status('brake').getAttribute('data-scratch-feel-midi-status')).toBe('timeout');
    expect(status('brake').textContent).toBe('No knob was turned. Nothing changed.');
    expect(runtime.store.get().feelMidi.mappings.brake?.controller).toBe(21);
    act(() => input.cc(1, 21, 0));
    expect(slider('brakeSeconds')).toBe(0.02);
  });

  it('negative: just before 10 s Learn is still waiting, and a knob turned then is learned', async () => {
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    click(q('[data-scratch-feel-learn="brake"]')!);
    await flush();
    act(() => vi.advanceTimersByTime(MIDI_FEEL_LEARN_TIMEOUT_MS - 1));
    await flush();
    expect(status('brake').getAttribute('data-scratch-feel-midi-status')).toBe('learning');
    act(() => input.cc(1, 30, 127));
    await flush();
    expect(runtime.store.get().feelMidi.mappings.brake?.controller).toBe(30);
    expect(q('[data-scratch-feel-midi-status="timeout"]')).toBeNull();
  });

  it('Esc keeps the previous knob: a control turned after Esc is not learned', async () => {
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    await learnWith('brake', 21, 127);
    click(q('[data-scratch-feel-learn="brake"]')!);
    await flush();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await flush();
    act(() => input.cc(1, 40, 0));
    await flush();
    expect(runtime.store.get().feelMidi.mappings.brake?.controller).toBe(21);
    expect(slider('brakeSeconds')).toBe(1);
    act(() => input.cc(1, 21, 0));
    expect(slider('brakeSeconds')).toBe(0.02);
  });

  it('negative: a key other than Esc does not cancel; the knob turned next is learned', async () => {
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    click(q('[data-scratch-feel-learn="spinUp"]')!);
    await flush();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
    await flush();
    expect(runtime.store.get().feelMidi.learning).toBe('spinUp');
    act(() => input.cc(1, 22, 127));
    await flush();
    expect(runtime.store.get().feelMidi.mappings.spinUp?.controller).toBe(22);
  });
});

describe('AC 4: a CC used by the jog wheel or the other slider is refused with a message', () => {
  it("positive: the Brake knob's control is refused for Spin-up, with the message", async () => {
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    await learnWith('brake', 21, 127);
    await learnWith('spinUp', 21, 0);
    expect(status('spinUp').getAttribute('data-scratch-feel-midi-status')).toBe('conflict');
    expect(status('spinUp').textContent).toBe(
      'Control 21 is already used by the jog wheel or the other slider. Nothing changed.',
    );
    expect(runtime.store.get().feelMidi.mappings.spinUp).toBeNull();
    // The refused move changed neither slider.
    expect(slider('brakeSeconds')).toBe(1);
  });

  it('negative: a free control, or the slider re-learning its own, is taken with no message', async () => {
    localStorage.setItem(
      MIDI_JOG_STORAGE_KEY,
      JSON.stringify({ inputName: 'Knobs', channel: 1, controller: 10, encoding: 'twos-complement' }),
    );
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    await learnWith('brake', 21, 127);
    await learnWith('spinUp', 22, 127);
    expect(q('[data-scratch-feel-midi-status="conflict"]')).toBeNull();
    await learnWith('brake', 21, 0);
    expect(q('[data-scratch-feel-midi-status="conflict"]')).toBeNull();
    expect(runtime.store.get().feelMidi.mappings).toMatchObject({
      brake: { controller: 21 },
      spinUp: { controller: 22 },
    });
  });
});

describe('AC 6: the new controls show in each of the 9 languages', () => {
  /** Learn, Learning, Forget, the timeout and the conflict messages, as rendered. */
  async function renderedLabels() {
    localStorage.setItem(
      MIDI_JOG_STORAGE_KEY,
      JSON.stringify({ inputName: 'Knobs', channel: 1, controller: 10, encoding: 'twos-complement' }),
    );
    const runtime = pageLoad();
    mount(<ScratchSection runtime={runtime} />);
    const shown: Record<string, string | null> = {
      scratchFeelLearn: q('[data-scratch-feel-learn="brake"]')!.textContent,
    };
    click(q('[data-scratch-feel-learn="brake"]')!);
    await flush();
    shown.scratchFeelLearning = status('brake').textContent;
    act(() => input.cc(1, 21, 64));
    await flush();
    shown.scratchFeelForget = q('[data-scratch-feel-forget="brake"]')!.textContent;
    await learnWith('spinUp', 10, 1);
    shown.scratchFeelLearnConflict = status('spinUp').textContent;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    click(q('[data-scratch-feel-learn="spinUp"]')!);
    await flush();
    act(() => vi.advanceTimersByTime(MIDI_FEEL_LEARN_TIMEOUT_MS));
    await flush();
    shown.scratchFeelLearnTimeout = status('spinUp').textContent;
    vi.useRealTimers();
    return shown;
  }
  const fill = (key: string, text: string) =>
    key === 'scratchFeelLearnConflict' ? text.replace('{{control}}', '10') : text;

  it.each(LOCALES)('%s: Learn, Forget and the Learn messages show in that language', async (locale) => {
    await i18n.changeLanguage(locale);
    await i18n.loadNamespaces('settings');
    const own = await strings(locale);
    const shown = await renderedLabels();
    for (const [key, text] of Object.entries(shown)) expect(text, `${locale}.${key}`).toBe(fill(key, own[key]));
  });

  it.each(LOCALES.filter((l) => l !== 'en'))(
    'negative pair: %s shows no English label and no raw key',
    async (locale) => {
      await i18n.changeLanguage(locale);
      await i18n.loadNamespaces('settings');
      const en = await strings('en');
      const shown = await renderedLabels();
      for (const [key, text] of Object.entries(shown)) {
        expect(text, `${locale}.${key}`).not.toBe(fill(key, en[key]));
        expect(text, `${locale}.${key}`).not.toBe(key);
      }
    },
  );
});
