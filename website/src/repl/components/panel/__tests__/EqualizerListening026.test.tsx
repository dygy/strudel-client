// @vitest-environment jsdom
/**
 * @spec: 026-eq-listening-tools (functional §2.1, §2.2, §2.3, §2.5; tech §2.1–§2.3)
 * The EQ panel's listening tools: the A | B slots drive both EQs (speakers and headphones) through
 * the gliding setters, edits and spec 024 Apply go to the active slot only, the slots survive a
 * reload and pre-026 settings become slot A with B a copy; Copy follows the active slot. The
 * spectrum taps the main EQ only while it is on, the speakers play and the panel is mounted, and
 * requests no frames while stopped. Record as heard is a remembered checkbox. Both layouts.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage`, which shadows jsdom's (see EqualizerCompact.test).
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@src/i18n/i18n';
import {
  AudioEqualizer,
  EQUALIZER_PRESETS,
  EQ_SLOTS_STORAGE_KEY,
  getDefaultSettings,
  loadEqualizerSettings,
  saveEqualizerSettings,
} from '@strudel/equalizer';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext } from '../../../../../../packages/mixer/test/webAudioMock.mjs';
import { destroyMainEqualizer, getMainEqualizer, initMainEqualizer } from '../../../mainEqualizer';
import { playingCodeEvaluated, playingStopped, resetPlayingEqProfile } from '../../../playingEqProfile';
import { RECORD_POST_EQ_KEY } from '../../../recording/recordingTap';
import { EqualizerUI, SPECTRUM_STORAGE_KEY, spectrumPoints } from '../EqualizerUI';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PHONK = EQUALIZER_PRESETS.phonk;
const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let ac: any;
let preview: AudioEqualizer;
/** Pending animation frames (id → callback); flush() runs one round. */
let frames: Map<number, () => void>;
let nextFrame: number;

const q = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);
const main = () => getMainEqualizer()!;
/** The band gains each EQ's filters glide to (what is heard while on). */
const heard = (eq: AudioEqualizer) => (eq as any).bands.map((b: any) => b.filter.gain.value);
const stored = (eq: AudioEqualizer) => eq.getState().bands.map((b) => b.gain);
const slotButton = (slot: 'A' | 'B') => q<HTMLButtonElement>(`[data-eq-slot="${slot}"]`)!;
const copyButton = () => q<HTMLButtonElement>('[data-eq-slot-copy]')!;
const picker = () => q<HTMLSelectElement>('select')!;
const sliders = () => container!.querySelectorAll<HTMLInputElement>('input[type="range"]:not([data-eq-slider])');
const savedSlots = () => JSON.parse(localStorage.getItem(EQ_SLOTS_STORAGE_KEY)!);

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EqualizerUI previewEngine={{ equalizer: preview }} />));
}

function unmount() {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
}

const click = (el: HTMLElement) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const choose = (value: string) =>
  act(() => {
    picker().value = value;
    picker().dispatchEvent(new Event('change', { bubbles: true }));
  });
function drag(input: HTMLInputElement, to: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, to);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const flush = () =>
  act(() => {
    const round = [...frames.values()];
    frames.clear();
    round.forEach((cb) => cb());
  });

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces('settings');
  localStorage.clear();
  resetPlayingEqProfile();
  setViewport(1440, 900);
  frames = new Map();
  nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    const id = nextFrame++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  ac = new MockAudioContext();
  initMainEqualizer(ac as unknown as AudioContext, { setOutputInsert: vi.fn() });
  preview = new AudioEqualizer(ac as unknown as AudioContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(async () => {
  unmount();
  destroyMainEqualizer();
  resetPlayingEqProfile();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('§2.1 A/B slots', () => {
  it('A Flat, B Phonk: A→B→A drives both EQs each time and shows the active slot and preset', () => {
    render();
    expect(slotButton('A').getAttribute('aria-pressed')).toBe('true');
    click(slotButton('B'));
    choose('phonk');
    expect(heard(main())).toEqual(PHONK.gains);

    click(slotButton('A'));
    expect(slotButton('A').getAttribute('aria-pressed')).toBe('true');
    expect(picker().value).toBe('flat');
    for (const eq of [main(), preview]) {
      expect(heard(eq)).toEqual(Array(10).fill(0));
      expect(eq.getState().highCut!.enabled).toBe(false);
      expect(eq.getState().outputGain).toBe(0);
    }

    click(slotButton('B'));
    expect(picker().value).toBe('phonk');
    for (const eq of [main(), preview]) {
      expect(heard(eq)).toEqual(PHONK.gains);
      expect(eq.getState().highCut).toEqual({ enabled: true, frequency: PHONK.highCut });
      expect(eq.getState().outputGain).toBe(PHONK.outputGain);
    }
  });

  it('a switch glides: every band, cut and output change is a setTargetAtTime, never a jump', () => {
    render();
    click(slotButton('B'));
    choose('phonk');
    const params = (eq: any) => [
      ...eq.bands.map((b: any) => b.filter.gain),
      ...eq.lowCutFilters.map((f: any) => f.frequency),
      ...eq.highCutFilters.map((f: any) => f.frequency),
      eq.outputGainNode.gain,
      eq.wetGain.gain,
      eq.dryGain.gain,
    ];
    const before = params(main()).map((p: any) => p.calls.length);

    click(slotButton('A'));
    const added = params(main()).flatMap((p: any, i: number) => p.calls.slice(before[i]));
    expect(added.length).toBeGreaterThan(0);
    expect(added.filter((c: any[]) => c[0] !== 'setTargetAtTime')).toEqual([]);
  });

  it('a slot saved as off stays silent when switched to, and on/off follows the slot', () => {
    render();
    click(slotButton('B'));
    choose('phonk');
    act(() => q<HTMLButtonElement>('button')!.click()); // the on/off toggle: B off
    expect(main().getState().isEnabled).toBe(false);
    click(slotButton('A'));
    expect(main().getState().isEnabled).toBe(true);
    click(slotButton('B'));
    expect(main().getState().isEnabled).toBe(false);
    expect(heard(main())).toEqual(Array(10).fill(0)); // off: flat, Phonk only stored
    expect(stored(main())).toEqual(PHONK.gains);
  });

  it('an edit while B is active leaves A unchanged; back on B the edit is there', () => {
    render();
    click(slotButton('B'));
    drag(sliders()[2], '9');
    click(slotButton('A'));
    expect(heard(main())[2]).toBe(0);
    expect(sliders()[2].value).toBe('0');
    click(slotButton('B'));
    expect(heard(main())[2]).toBe(9);
    expect(sliders()[2].value).toBe('9');
    expect(savedSlots().A.bands[2].gain).toBe(0);
    expect(savedSlots().B.bands[2].gain).toBe(9);
  });

  it('a reload brings back both slots and the active one; the legacy key holds the active slot', () => {
    render();
    click(slotButton('B'));
    choose('phonk');
    unmount();
    expect(loadEqualizerSettings()!.preset).toBe('phonk');

    render();
    expect(slotButton('B').getAttribute('aria-pressed')).toBe('true');
    expect(picker().value).toBe('phonk');
    click(slotButton('A'));
    expect(picker().value).toBe('flat');
    expect(loadEqualizerSettings()!.preset).toBe('flat');
  });

  it('settings saved before spec 026 load into A, and B starts as a copy', () => {
    const legacy = {
      ...getDefaultSettings(),
      preset: 'custom',
      bands: FREQUENCIES.map((frequency, i) => ({ frequency, gain: i - 3, Q: 1 })),
    };
    saveEqualizerSettings(legacy);
    render();
    expect(slotButton('A').getAttribute('aria-pressed')).toBe('true');
    expect(heard(main())).toEqual(legacy.bands.map((b) => b.gain));
    click(slotButton('B'));
    expect(heard(main())).toEqual(legacy.bands.map((b) => b.gain));
    expect(picker().value).toBe('custom');
  });

  it('Copy A→B copies the active slot into the other; the label follows the direction', () => {
    render();
    choose('phonk');
    expect(copyButton().textContent).toBe('Copy A→B');
    click(copyButton());
    expect(savedSlots().B.preset).toBe('phonk');
    expect(heard(main())).toEqual(PHONK.gains); // the sound does not change

    click(slotButton('B'));
    expect(copyButton().textContent).toBe('Copy B→A');
    choose('flat');
    click(copyButton());
    click(slotButton('A'));
    expect(picker().value).toBe('flat');
  });

  it('spec 024 Apply goes into the active slot only', () => {
    render();
    click(slotButton('B'));
    act(() => playingCodeEvaluated('// @eq-profile {"v":1,"preset":"phonk"}\ns("bd")'));
    click(q<HTMLButtonElement>('[data-eq-recommend="apply"]')!);
    expect(heard(main())).toEqual(PHONK.gains);
    expect(savedSlots().B.preset).toBe('phonk');
    expect(savedSlots().A.preset).toBe('flat');
  });

  it('on a phone the slots and Copy are 44px targets and switch the same way', () => {
    setViewport(390, 844);
    render();
    expect(q('[data-eq-compact]')).not.toBeNull();
    expect(slotButton('A').className).toMatch(/\bmin-h-11\b/);
    expect(copyButton().className).toMatch(/\bmin-h-11\b/);
    click(slotButton('B'));
    choose('phonk');
    click(slotButton('A'));
    expect(heard(main())).toEqual(Array(10).fill(0));
    click(slotButton('B'));
    expect(heard(main())).toEqual(PHONK.gains);
  });
});

describe('§2.2 spectrum', () => {
  const analyserTaps = () => main().getAnalyserTapCount();

  it('taps the main EQ and draws frames only while the speakers play; stopping stops the frames', () => {
    render();
    flush();
    // Before play: no tap, and only the limiter poll (spec 020) has a frame pending.
    expect(analyserTaps()).toBe(0);
    expect(frames.size).toBe(1);

    act(() => playingCodeEvaluated('s("bd")'));
    expect(analyserTaps()).toBe(1);
    const tap = (main().getOutput() as any).connections.find((n: any) => n.kind === 'Analyser');
    expect(tap.fftSize).toBe(4096);
    const read = vi.spyOn(tap, 'getFloatFrequencyData');
    flush();
    expect(frames.size).toBe(2); // limiter poll + spectrum
    flush();
    expect(read).toHaveBeenCalledTimes(2);

    act(() => playingStopped());
    expect(analyserTaps()).toBe(0);
    expect(frames.size).toBe(1); // the spectrum's pending frame was cancelled
    flush();
    flush();
    expect(frames.size).toBe(1);
    expect(read).toHaveBeenCalledTimes(2); // no spectrum frame while stopped
  });

  it('a suspended context draws silence and stops requesting spectrum frames', () => {
    render();
    act(() => playingCodeEvaluated('s("bd")'));
    const tap = (main().getOutput() as any).connections.find((n: any) => n.kind === 'Analyser');
    const read = vi.spyOn(tap, 'getFloatFrequencyData');
    ac.state = 'suspended';
    flush();
    flush();
    expect(read).not.toHaveBeenCalled();
  });

  it('Spectrum off: nothing drawn, the analysis disconnected, and remembered', () => {
    render();
    act(() => playingCodeEvaluated('s("bd")'));
    expect(analyserTaps()).toBe(1);
    const toggle = q<HTMLInputElement>('[data-eq-spectrum]')!;
    expect(toggle.checked).toBe(true);

    click(toggle);
    expect(toggle.checked).toBe(false);
    expect(analyserTaps()).toBe(0);
    expect(localStorage.getItem(SPECTRUM_STORAGE_KEY)).toBe('false');

    unmount();
    render();
    expect(q<HTMLInputElement>('[data-eq-spectrum]')!.checked).toBe(false);
    expect(analyserTaps()).toBe(0);
  });

  it('closing the panel disposes the tap; repeated open/close leaks no analyser', () => {
    act(() => playingCodeEvaluated('s("bd")'));
    for (let i = 0; i < 5; i++) {
      render();
      expect(analyserTaps()).toBe(1);
      unmount();
      expect(analyserTaps()).toBe(0);
    }
    expect((main().getOutput() as any).connections.filter((n: any) => n.kind === 'Analyser')).toEqual([]);
  });

  it('spectrumPoints: 20 Hz–20 kHz on the log axis, −100…0 dBFS onto the height, one point per pixel', () => {
    const data = new Float32Array(2048).fill(-50);
    data[100] = -Infinity;
    const points = spectrumPoints(data, 48000, 600, 200);
    expect(points[0][0]).toBeGreaterThanOrEqual(0);
    expect(points[points.length - 1][0]).toBeLessThanOrEqual(600);
    expect(points.length).toBeLessThanOrEqual(600);
    expect(points.every(([, y]) => y >= 0 && y <= 200)).toBe(true);
    expect(points[1][1]).toBe(100); // −50 dBFS: halfway
    expect(spectrumPoints(new Float32Array(2048).fill(0), 48000, 600, 200)[5][1]).toBe(0);
    expect(spectrumPoints(new Float32Array(2048).fill(-120), 48000, 600, 200)[5][1]).toBe(200);
  });
});

describe('§2.3 Record as heard option', () => {
  it('is off by default, and remembered when turned on', () => {
    render();
    const box = q<HTMLInputElement>('[data-record-post-eq]')!;
    expect(box.checked).toBe(false);
    click(box);
    expect(localStorage.getItem(RECORD_POST_EQ_KEY)).toBe('true');
    unmount();
    render();
    expect(q<HTMLInputElement>('[data-record-post-eq]')!.checked).toBe(true);
  });
});

describe('§2.5 labels', () => {
  it('show in the language (Russian)', async () => {
    await i18n.changeLanguage('ru');
    await i18n.loadNamespaces('settings');
    render();
    expect(copyButton().textContent).toBe('Копировать A→B');
    expect(q('[data-eq-listening]')!.textContent).toContain('Спектр');
    expect(q('[data-eq-listening]')!.textContent).toContain('Записывать как слышно');
  });
});
