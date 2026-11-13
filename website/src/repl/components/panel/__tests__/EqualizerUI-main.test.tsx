// @vitest-environment jsdom
/**
 * @spec: 008-audio-equalizer (Req 2.2 / 2.3; /fix 2026-11-12)
 * The EQ panel drives the speakers' (main) EQ as well as the headphones' (preview engine) one:
 * a slider, the on/off toggle and a preset reach both, on desktop and on a phone. Before the fix
 * the panel was mounted with mixer={null} and only ever reached the preview engine.
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
import { AudioEqualizer, EQUALIZER_PRESETS } from '@strudel/equalizer';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext } from '../../../../../../packages/mixer/test/webAudioMock.mjs';
import { destroyMainEqualizer, getMainEqualizer, initMainEqualizer } from '../../../mainEqualizer';
import { EqualizerUI } from '../EqualizerUI';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let main: AudioEqualizer;
let preview: AudioEqualizer;
let ac: any;

const applied = (eq: AudioEqualizer) => (eq as any).bands.map((b: any) => b.filter.gain.value);

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};
const originalSize = { width: window.innerWidth, height: window.innerHeight };

function render(previewEngine: any = { equalizer: preview }) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EqualizerUI previewEngine={previewEngine} />));
}

const q = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);

function drag(input: HTMLInputElement, to: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, to);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  ac = new MockAudioContext();
  main = initMainEqualizer(ac as unknown as AudioContext, { setOutputInsert: vi.fn() });
  preview = new AudioEqualizer(ac as unknown as AudioContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  destroyMainEqualizer();
  setViewport(originalSize.width, originalSize.height);
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('EqualizerUI drives the main (speakers) EQ', () => {
  describe('on a laptop', () => {
    beforeEach(() => setViewport(1440, 900));

    it('a slider change reaches the main EQ and the preview EQ', () => {
      render();
      drag(container!.querySelectorAll<HTMLInputElement>('input[type="range"]')[2], '12');

      expect(applied(main)[2]).toBe(12);
      expect(applied(preview)[2]).toBe(12);
    });

    it('a preset reaches the main EQ', () => {
      render();
      act(() => {
        const select = q<HTMLSelectElement>('select')!;
        select.value = 'bassBoost';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });

      expect(applied(main)).toEqual(EQUALIZER_PRESETS.bassBoost.gains);
    });

    it('switching the EQ off makes the main EQ flat; a slider moved while off stays silent', () => {
      render();
      drag(container!.querySelectorAll<HTMLInputElement>('input[type="range"]')[2], '6');
      act(() => q<HTMLButtonElement>('button')!.click()); // the on/off toggle is the first button

      expect(main.getState().isEnabled).toBe(false);
      expect(applied(main)).toEqual(Array(10).fill(0));

      drag(container!.querySelectorAll<HTMLInputElement>('input[type="range"]')[4], '9');
      expect(applied(main)).toEqual(Array(10).fill(0));
      expect(main.getState().bands[4].gain).toBe(9);
    });

    it('works before the headphone preview engine is ready (the speakers EQ is still there)', () => {
      render(null);
      expect(container!.querySelectorAll('input[type="range"]:not([data-eq-slider])')).toHaveLength(10);

      drag(container!.querySelectorAll<HTMLInputElement>('input[type="range"]')[5], '-3');
      expect(applied(main)[5]).toBe(-3);
    });
  });

  describe('on a phone', () => {
    beforeEach(() => setViewport(390, 844));

    it('the compact gain slider reaches the main EQ', () => {
      render();
      act(() => q<HTMLButtonElement>('[data-eq-chip="2"]')!.click());
      drag(q<HTMLInputElement>('[data-eq-slider="gain"]')!, '12');

      expect(applied(main)[2]).toBe(12);
      expect(applied(preview)[2]).toBe(12);
    });
  });
});

// The app installs the main EQ on the first click (after initAudio picked the output device), so
// the panel can be open before it exists.
describe('EqualizerUI before the main EQ exists', () => {
  beforeEach(() => {
    setViewport(1440, 900);
    destroyMainEqualizer();
  });

  it('picks the main EQ up when it appears and drives it from then on', () => {
    render();
    act(() => {
      main = initMainEqualizer(ac, { setOutputInsert: vi.fn() });
    });

    drag(container!.querySelectorAll<HTMLInputElement>('input[type="range"]')[3], '7');
    expect(applied(main)[3]).toBe(7);
  });

  it('a change made before it existed is applied when it is installed', () => {
    render();
    drag(container!.querySelectorAll<HTMLInputElement>('input[type="range"]')[2], '12');
    expect(getMainEqualizer()).toBeNull();

    act(() => {
      main = initMainEqualizer(ac, { setOutputInsert: vi.fn() });
    });

    expect(applied(main)[2]).toBe(12);
    expect(applied(preview)[2]).toBe(12);
  });

  it('with no EQ at all it says so, and shows the controls once the main EQ appears', () => {
    render(null);
    expect(container!.querySelectorAll('input[type="range"]')).toHaveLength(0);

    act(() => {
      main = initMainEqualizer(ac, { setOutputInsert: vi.fn() });
    });

    expect(container!.querySelectorAll('input[type="range"]:not([data-eq-slider])')).toHaveLength(10);
  });
});
