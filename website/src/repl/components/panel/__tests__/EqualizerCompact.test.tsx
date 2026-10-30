// @vitest-environment jsdom
/**
 * @spec: 016-responsive-repl-layout (§2.3, tech §2.5)
 * The EQ on a phone: the whole curve, band chips and one band's large gain slider. Tapping the curve
 * at a band's x selects that band (same frequency→x mapping as the drawing); the gain slider goes
 * through the desktop band setter (clamped, saved, EQ-off stays silent); wide screens keep the
 * 10-column desktop grid.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage` (undefined without --localstorage-file), which
// shadows jsdom's; point it at jsdom's before the equalizer persistence is imported.
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AudioEqualizer, frequencyToX, loadEqualizerSettings } from '@strudel/equalizer';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext } from '../../../../../../packages/mixer/test/webAudioMock.mjs';
import { EqualizerUI, clampBandUpdate } from '../EqualizerUI';
import { nearestBandIndex } from '../EqualizerCompact';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const CANVAS_WIDTH = 600; // the canvas's pixel width
const CSS_WIDTH = 300; // the width the sheet shows it at
const CSS_LEFT = 20;

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let eq: AudioEqualizer;
let setBand: ReturnType<typeof vi.spyOn>;

/** The audible gain of each band (what the filter applies, not what is stored). */
const appliedGains = () => (eq as any).bands.map((b: any) => b.filter.gain.value);

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EqualizerUI mixer={null} previewEngine={{ equalizer: eq }} />));
  return container;
}

const q = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);
const canvas = () => q<HTMLCanvasElement>('canvas')!;
const selectedChip = () => q('[data-eq-chip][aria-pressed="true"]')?.getAttribute('data-eq-chip');
const slider = (name: string) => q<HTMLInputElement>(`[data-eq-slider="${name}"]`)!;
const value = (name: string) => q(`[data-eq-value="${name}"]`)?.textContent;

/** The client x at which band i is drawn on the CSS-scaled canvas. */
const clientXOfBand = (i: number) => CSS_LEFT + frequencyToX(FREQUENCIES[i], CANVAS_WIDTH) * (CSS_WIDTH / CANVAS_WIDTH);

function pointer(type: string, clientX: number) {
  const Ctor = (window as any).PointerEvent ?? MouseEvent;
  act(() => {
    canvas().dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, clientX, clientY: 50, buttons: 1 }));
  });
}

/** Drag a range input to a value the way React sees it (native value setter + input event). */
function drag(input: HTMLInputElement, to: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, to);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const originalSize = { width: window.innerWidth, height: window.innerHeight };

beforeEach(() => {
  localStorage.clear();
  eq = new AudioEqualizer(new MockAudioContext() as unknown as AudioContext);
  setBand = vi.spyOn(eq, 'setBand');
  // jsdom has no 2D canvas; the UI already skips drawing without a context.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: CSS_LEFT,
    top: 0,
    width: CSS_WIDTH,
    height: 100,
    right: CSS_LEFT + CSS_WIDTH,
    bottom: 100,
    x: CSS_LEFT,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  setViewport(originalSize.width, originalSize.height);
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('EqualizerUI on a phone (390x844)', () => {
  beforeEach(() => setViewport(390, 844));

  it('shows the compact EQ (curve, chips, one band) instead of the 10-column grid', () => {
    render();
    expect(q('[data-eq-compact]')).not.toBeNull();
    expect(q('.sm\\:grid-cols-10')).toBeNull();
    expect(container!.querySelectorAll('[data-eq-chip]')).toHaveLength(10);
    expect(container!.querySelectorAll('canvas')).toHaveLength(1);
    expect(selectedChip()).toBe('0');
  });

  it('tapping the curve at a band’s x selects that band', () => {
    render();
    pointer('pointerdown', clientXOfBand(7));
    pointer('pointerup', clientXOfBand(7));
    expect(selectedChip()).toBe('7');
    expect(value('frequency')).toBe('4kHz');

    // A tap between two bands picks the nearer one (just right of 250 Hz → 250 Hz).
    pointer('pointerdown', clientXOfBand(3) + 3);
    expect(selectedChip()).toBe('3');
  });

  it('dragging a finger along the curve moves the selection', () => {
    render();
    pointer('pointerdown', clientXOfBand(1));
    pointer('pointermove', clientXOfBand(5));
    expect(selectedChip()).toBe('5');
    pointer('pointerup', clientXOfBand(5));
    // Without a pressed pointer, hovering does not change the selection.
    pointer('pointermove', clientXOfBand(9));
    expect(selectedChip()).toBe('5');
  });

  it('a band chip selects that band', () => {
    render();
    act(() => q<HTMLButtonElement>('[data-eq-chip="9"]')!.click());
    expect(selectedChip()).toBe('9');
    expect(value('frequency')).toBe('16kHz');
  });

  it('the gain slider goes through the band setter: applied, shown and saved', () => {
    render();
    act(() => q<HTMLButtonElement>('[data-eq-chip="5"]')!.click());
    setBand.mockClear();

    drag(slider('gain'), '4.5');

    expect(setBand).toHaveBeenCalledWith(5, { gain: 4.5 });
    expect(appliedGains()[5]).toBe(4.5);
    expect(value('gain')).toBe('+4.5 dB');
    expect(loadEqualizerSettings()!.bands[5].gain).toBe(4.5);
    expect(loadEqualizerSettings()!.preset).toBe('custom');
  });

  it('gain values reaching the setter are inside the range the audio graph accepts', () => {
    render();
    setBand.mockClear();
    drag(slider('gain'), '40');
    drag(slider('gain'), '-40');
    for (const [, update] of setBand.mock.calls as [number, { gain?: number }][]) {
      expect(Math.abs(update.gain!)).toBeLessThanOrEqual(12);
    }
    // A saved setting the loader accepts (an out-of-range save would reset the EQ to flat).
    expect(loadEqualizerSettings()).not.toBeNull();
  });

  it('offers only a gain slider: no frequency or Q (width) slider, matching the desktop', () => {
    render();
    const ranges = [...container!.querySelectorAll<HTMLInputElement>('[data-eq-compact] input[type="range"]')];
    expect(ranges).toHaveLength(1);
    expect(ranges[0].getAttribute('data-eq-slider')).toBe('gain');
    expect(q('[data-eq-slider="frequency"]')).toBeNull();
    expect(q('[data-eq-slider="Q"]')).toBeNull();
    // The centre frequency is shown read-only next to the band name.
    act(() => q<HTMLButtonElement>('[data-eq-chip="6"]')!.click());
    expect(value('frequency')).toBe('2kHz');
    expect(q('[data-eq-value="frequency"]')!.tagName).not.toBe('INPUT');
    // Q only ever reaches the engine from loaded settings, never from a compact control.
    setBand.mockClear();
    drag(slider('gain'), '3');
    expect(setBand.mock.calls.every(([, update]) => !('Q' in (update as object)))).toBe(true);
  });

  it('with the EQ off, moving a slider stays silent and is applied when it is switched on', () => {
    render();
    const toggle = q<HTMLButtonElement>('button[aria-pressed]')!;
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    act(() => q<HTMLButtonElement>('[data-eq-chip="4"]')!.click());
    drag(slider('gain'), '6');

    expect(appliedGains()).toEqual(Array(10).fill(0));
    expect(eq.getState().bands[4].gain).toBe(6);

    act(() => toggle.click());
    expect(appliedGains()[4]).toBe(6);
  });

  it('the band controls are 44px touch targets that do not scroll the sheet', () => {
    render();
    expect(slider('gain').className).toMatch(/\bh-11\b/);
    expect(slider('gain').className).toMatch(/\btouch-none\b/);
    expect(canvas().className).toMatch(/\btouch-none\b/);
    for (const chip of container!.querySelectorAll('[data-eq-chip]')) {
      expect(chip.className).toMatch(/\bmin-h-11\b/);
      expect(chip.className).toMatch(/\bmin-w-11\b/);
    }
    expect(q('button[aria-pressed]')!.className).toMatch(/\bmin-h-11\b/);
    expect(q('select')!.className).toMatch(/\bmin-h-11\b/);
  });
});

describe('EqualizerUI on a laptop (1440x900)', () => {
  beforeEach(() => setViewport(1440, 900));

  it('keeps the desktop 10-column grid of vertical sliders and no compact controls', () => {
    render();
    expect(q('[data-eq-compact]')).toBeNull();
    expect(q('.sm\\:grid-cols-10')).not.toBeNull();
    expect(container!.querySelectorAll('input[type="range"]')).toHaveLength(10);
    expect(q('select')!.className).not.toMatch(/min-h-11/);
  });

  it('the desktop slider uses the same band setter', () => {
    render();
    setBand.mockClear();
    drag(container!.querySelectorAll<HTMLInputElement>('input[type="range"]')[5], '-3');
    expect(setBand).toHaveBeenCalledWith(5, { gain: -3 });
    expect(appliedGains()[5]).toBe(-3);
  });
});

describe('the pure helpers', () => {
  const bands = FREQUENCIES.map((frequency) => ({ frequency, gain: 0, Q: 1 }));

  it('nearestBandIndex uses the drawing’s frequency→x mapping', () => {
    FREQUENCIES.forEach((f, i) => expect(nearestBandIndex(bands, frequencyToX(f, 600), 600)).toBe(i));
    expect(nearestBandIndex(bands, -50, 600)).toBe(0);
    expect(nearestBandIndex(bands, 10_000, 600)).toBe(9);
    expect(nearestBandIndex([], 100, 600)).toBe(-1);
  });

  it('clampBandUpdate clamps to ±12 dB and Q 0.5–4, and drops non-finite values', () => {
    expect(clampBandUpdate({ gain: 20 })).toEqual({ gain: 12 });
    expect(clampBandUpdate({ gain: -20 })).toEqual({ gain: -12 });
    expect(clampBandUpdate({ Q: 10 })).toEqual({ Q: 4 });
    expect(clampBandUpdate({ Q: 0.1 })).toEqual({ Q: 0.5 });
    expect(clampBandUpdate({ gain: NaN, Q: Infinity })).toEqual({});
  });
});
