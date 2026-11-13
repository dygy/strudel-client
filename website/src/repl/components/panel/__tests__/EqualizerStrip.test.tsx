// @vitest-environment jsdom
/**
 * @spec: 020-eq-strong-control (tech §2.4)
 * The EQ panel's low cut, high cut, output level and limiting indicator: each control drives the
 * main (speakers) and preview EQs, saves and makes the preset Custom; presets come in two groups and
 * a genre preset sets the cuts; the limiting indicator polls the main EQ once per frame and stops
 * polling on unmount.
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
import { AudioEqualizer, EQUALIZER_PRESETS, LOW_CUT_RANGE, loadEqualizerSettings } from '@strudel/equalizer';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext } from '../../../../../../packages/mixer/test/webAudioMock.mjs';
import { destroyMainEqualizer, initMainEqualizer } from '../../../mainEqualizer';
import { EqualizerUI } from '../EqualizerUI';
import {
  cutFrequencyToPosition,
  formatCutFrequency,
  positionToCutFrequency,
  CUT_SLIDER_STEPS,
} from '../EqualizerStripControls';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let main: AudioEqualizer;
let preview: AudioEqualizer;
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;

const q = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);
const cutStages = (eq: AudioEqualizer, which: 'low' | 'high') =>
  (eq as any)[which === 'low' ? 'lowCutFilters' : 'highCutFilters'].map((f: any) => f.frequency.value);
const outputLinear = (eq: AudioEqualizer) => (eq as any).outputGainNode.gain.value;

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EqualizerUI previewEngine={{ equalizer: preview }} />));
}

function drag(input: HTMLInputElement, to: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, to);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pick(preset: string) {
  act(() => {
    const select = q<HTMLSelectElement>('select')!;
    select.value = preset;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Run the pending animation frames once. */
function tick() {
  const pending = [...frames.entries()];
  frames.clear();
  act(() => pending.forEach(([, cb]) => cb(performance.now())));
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 900 });
  frames = new Map();
  // Like the browser's, these throw "Illegal invocation" when called as a method of another object
  // (found in Chromium: the panel called them through a `{ request: requestAnimationFrame }` wrapper).
  const asBrowser = (self: unknown) => {
    if (self !== undefined && self !== globalThis && self !== window) throw new TypeError('Illegal invocation');
  };
  vi.stubGlobal('requestAnimationFrame', function (this: unknown, cb: FrameRequestCallback) {
    asBrowser(this);
    frames.set(++nextFrame, cb);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', function (this: unknown, id: number) {
    asBrowser(this);
    frames.delete(id);
  });
  const ac = new MockAudioContext();
  main = initMainEqualizer(ac as unknown as AudioContext, { setOutputInsert: vi.fn() });
  preview = new AudioEqualizer(ac as unknown as AudioContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  destroyMainEqualizer();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('EQ panel: cuts, output level, limiting (spec 020)', () => {
  it('turning the low cut on and moving it reaches both EQs, saves, and shows Custom', () => {
    render();
    act(() => q<HTMLButtonElement>('[data-eq-toggle="lowCut"]')!.click());
    drag(q<HTMLInputElement>('[data-eq-slider="lowCut"]')!, String(cutFrequencyToPosition(200, LOW_CUT_RANGE)));

    expect(cutStages(main, 'low')).toEqual([200, 200]);
    expect(cutStages(preview, 'low')).toEqual([200, 200]);
    expect(q('[data-eq-value="lowCut"]')!.textContent).toBe('200 Hz');
    expect(loadEqualizerSettings()).toMatchObject({ lowCut: { enabled: true, frequency: 200 }, preset: 'custom' });
    expect(q<HTMLSelectElement>('select')!.value).toBe('custom');
  });

  it('the high cut reaches both EQs and shows kHz', () => {
    render();
    act(() => q<HTMLButtonElement>('[data-eq-toggle="highCut"]')!.click());
    drag(
      q<HTMLInputElement>('[data-eq-slider="highCut"]')!,
      String(cutFrequencyToPosition(2000, { min: 1000, max: 20000 })),
    );

    expect(cutStages(main, 'high')).toEqual([2000, 2000]);
    expect(cutStages(preview, 'high')).toEqual([2000, 2000]);
    expect(q('[data-eq-value="highCut"]')!.textContent).toBe('2.0 kHz');
  });

  it('the output slider reaches both EQs and is clamped to −24…+6 dB', () => {
    render();
    drag(q<HTMLInputElement>('[data-eq-slider="output"]')!, '-6');

    expect(outputLinear(main)).toBeCloseTo(Math.pow(10, -6 / 20), 6);
    expect(outputLinear(preview)).toBeCloseTo(Math.pow(10, -6 / 20), 6);
    expect(q('[data-eq-value="output"]')!.textContent).toBe('-6.0 dB');
    expect(loadEqualizerSettings()?.outputGain).toBe(-6);

    const slider = q<HTMLInputElement>('[data-eq-slider="output"]')!;
    expect([slider.min, slider.max]).toEqual(['-24', '6']);
  });

  it('the band sliders reach ±24 dB', () => {
    render();
    const band = container!.querySelectorAll<HTMLInputElement>('input[type="range"]:not([data-eq-slider])')[0];
    expect([band.min, band.max]).toEqual(['-24', '24']);

    drag(band, '24');
    expect(main.getState().bands[0].gain).toBe(24);
  });

  it('presets are in two groups, Genres then Profiles', () => {
    render();
    const groups = [...container!.querySelectorAll('optgroup')];
    expect(groups.map((g) => g.getAttribute('data-eq-group'))).toEqual(['genre', 'profile']);
    expect(groups[0].querySelectorAll('option')).toHaveLength(12);
    expect(groups[1].querySelectorAll('option')).toHaveLength(22);
    expect(groups[0].querySelector('option[value="phonk"]')).not.toBeNull();
  });

  it('a genre preset sets the cuts and output; a band moved afterwards shows Custom; Pop clears the cuts', () => {
    render();
    pick('phonk');

    expect(q<HTMLButtonElement>('[data-eq-toggle="highCut"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(cutStages(main, 'high')).toEqual([13000, 13000]);
    expect(main.getState().outputGain).toBe(EQUALIZER_PRESETS.phonk.outputGain);
    expect(loadEqualizerSettings()).toMatchObject({ preset: 'phonk', highCut: { enabled: true, frequency: 13000 } });

    drag(container!.querySelectorAll<HTMLInputElement>('input[type="range"]:not([data-eq-slider])')[3], '2');
    expect(q<HTMLSelectElement>('select')!.value).toBe('custom');

    pick('pop');
    expect(q<HTMLButtonElement>('[data-eq-toggle="highCut"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(main.getState()).toMatchObject({ highCut: { enabled: false }, outputGain: 0 });
    expect(preview.getState()).toMatchObject({ highCut: { enabled: false }, outputGain: 0 });
  });

  it('the limiting indicator lights while the main EQ limits by more than 1 dB, and polling stops on unmount', () => {
    let reduction = 0;
    vi.spyOn(main, 'getLimiterReduction').mockImplementation(() => reduction);
    render();
    tick();
    expect(q('[data-eq-limiting]')!.getAttribute('data-eq-limiting')).toBe('off');

    reduction = -4;
    tick();
    expect(q('[data-eq-limiting]')!.getAttribute('data-eq-limiting')).toBe('on');

    reduction = -0.5; // within the hold time it stays lit; the poll keeps running
    tick();
    expect(frames.size).toBe(1);

    act(() => root!.unmount());
    root = null;
    expect(frames.size).toBe(0);
  });

  // Review finding (spec 020): when the main EQ was swapped (A → B) while A was limiting, the poll for B
  // started with its own `lit` false and never cleared the React state, so the indicator stayed lit.
  it('the limiting indicator goes out when the main EQ is swapped for one that is not limiting', () => {
    vi.spyOn(main, 'getLimiterReduction').mockReturnValue(-6);
    render();
    tick();
    expect(q('[data-eq-limiting]')!.getAttribute('data-eq-limiting')).toBe('on');

    act(() => {
      destroyMainEqualizer();
      main = initMainEqualizer(new MockAudioContext() as unknown as AudioContext, { setOutputInsert: vi.fn() });
    });
    tick();
    tick();
    expect(main.getLimiterReduction()).toBe(0);
    expect(q('[data-eq-limiting]')!.getAttribute('data-eq-limiting')).toBe('off');
  });

  it('the compact (phone) layout has the cuts and the output level with 44px targets', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 844 });
    render();

    expect(q('[data-eq-compact]')).not.toBeNull();
    for (const name of ['lowCut', 'highCut', 'output']) expect(q(`[data-eq-slider="${name}"]`)).not.toBeNull();
    expect(q('[data-eq-toggle="lowCut"]')!.className).toMatch(/\bmin-h-11\b/);
    expect(q('[data-eq-slider="lowCut"]')!.className).toMatch(/\bh-11\b/);
  });
});

describe('cut slider helpers (spec 020)', () => {
  it('the slider is log-scaled over the range and round-trips', () => {
    expect(cutFrequencyToPosition(20, LOW_CUT_RANGE)).toBe(0);
    expect(cutFrequencyToPosition(1000, LOW_CUT_RANGE)).toBe(CUT_SLIDER_STEPS);
    expect(positionToCutFrequency(CUT_SLIDER_STEPS / 2, LOW_CUT_RANGE)).toBe(141); // √(20·1000)
    [20, 80, 200, 999].forEach((f) =>
      expect(
        Math.abs(positionToCutFrequency(cutFrequencyToPosition(f, LOW_CUT_RANGE), LOW_CUT_RANGE) - f),
      ).toBeLessThanOrEqual(f * 0.005),
    );
    expect(positionToCutFrequency(-10, LOW_CUT_RANGE)).toBe(20);
    expect(positionToCutFrequency(5000, LOW_CUT_RANGE)).toBe(1000);
  });

  it('formats Hz below 1 kHz and kHz above', () => {
    expect(formatCutFrequency(80)).toBe('80 Hz');
    expect(formatCutFrequency(12000)).toBe('12.0 kHz');
  });
});
