// @vitest-environment jsdom
/**
 * @spec: 020-eq-strong-control (functional §2.1–2.7, tasks 5.1 / 5.3)
 * Acceptance-level panel tests that EqualizerStrip.test / EqualizerCompact.test do not already
 * cover: the drawn curve and its ±24 dB scale, the range hint, the phone layout reaching ±24 dB and
 * driving both EQs through the cuts, a cut turned Off, the limiting indicator going out and reading
 * only the speakers EQ, Custom after any manual change (and not after a preset), EQ-off silence
 * at panel level, saved settings restored / damaged / from before 020, and the EQ being there
 * when signed out. Each test names the criterion it covers.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage`, which shadows jsdom's (see EqualizerCompact.test).
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  AudioEqualizer,
  EQUALIZER_PRESETS,
  HIGH_CUT_RANGE,
  LOW_CUT_RANGE,
  frequencyToX,
  gainToY,
  getDefaultSettings,
  loadEqualizerSettings,
} from '@strudel/equalizer';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext } from '../../../../../../packages/mixer/test/webAudioMock.mjs';
import { destroyMainEqualizer, initMainEqualizer } from '../../../mainEqualizer';
import { EqualizerUI } from '../EqualizerUI';
import { cutFrequencyToPosition } from '../EqualizerStripControls';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = 'strudel-equalizer-settings';
const CANVAS_W = 600;
const CANVAS_H = 200;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let ac: any;
let main: AudioEqualizer;
let preview: AudioEqualizer;
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
let now = 1_000_000;

const q = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);
const bandSliders = () => [...container!.querySelectorAll<HTMLInputElement>('.sm\\:grid-cols-10 input[type="range"]')];
const appliedBands = (eq: AudioEqualizer) => (eq as any).bands.map((b: any) => b.filter.gain.value);
const cutStages = (eq: AudioEqualizer, which: 'low' | 'high') =>
  (eq as any)[which === 'low' ? 'lowCutFilters' : 'highCutFilters'].map((f: any) => f.frequency.value);
const outputLinear = (eq: AudioEqualizer) => (eq as any).outputGainNode.gain.value;
const toLinear = (db: number) => Math.pow(10, db / 20);
const setLimiterReduction = (eq: AudioEqualizer, db: number) =>
  (eq as any).limiters.forEach((l: any) => (l.reduction = db));
const limiting = () => q('[data-eq-limiting]')!.getAttribute('data-eq-limiting');
const selectValue = () => q<HTMLSelectElement>('select')!.value;

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};

function render(previewEngine: any = { equalizer: preview }) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EqualizerUI previewEngine={previewEngine} />));
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

const click = (sel: string) => act(() => q<HTMLButtonElement>(sel)!.click());

/** Run the pending animation frames once. */
function tick() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((cb) => cb(performance.now())));
}

/**
 * A recording 2D context: the response curve is the path stroked in #1db954 at width 3, and the
 * gain labels are the fillText calls ending in "dB".
 */
function recordingContext() {
  let path: [number, number][] = [];
  const state = { curve: null as [number, number][] | null, labels: [] as string[] };
  const ctx: any = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    shadowBlur: 0,
    shadowColor: '',
    clearRect: () => {
      state.curve = null;
      state.labels = [];
    },
    beginPath: () => (path = []),
    moveTo: (x: number, y: number) => path.push([x, y]),
    lineTo: (x: number, y: number) => path.push([x, y]),
    arc: () => {},
    fill: () => {},
    setLineDash: () => {},
    fillText: (text: string) => state.labels.push(text),
    stroke: () => {
      if (ctx.strokeStyle === '#1db954' && ctx.lineWidth === 3) state.curve = [...path];
    },
  };
  return { ctx, state };
}

/** The curve's y (canvas px) at the drawn point nearest to `frequency`. */
function curveYAt(curve: [number, number][], frequency: number): number {
  const x = frequencyToX(frequency, CANVAS_W);
  return curve.reduce((best, p) => (Math.abs(p[0] - x) < Math.abs(best[0] - x) ? p : best))[1];
}

beforeEach(() => {
  localStorage.clear();
  setViewport(1440, 900);
  frames = new Map();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++nextFrame, cb);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(Date, 'now').mockImplementation(() => now);
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('§2.1 wider band range', () => {
  it('AC 2.1.1/2.1.2: a desktop band dragged to the top reads +24 dB, to the bottom −24 dB, on both EQs', () => {
    render();
    drag(bandSliders()[5], '24');
    expect(bandSliders()[5].parentElement!.nextElementSibling!.textContent).toBe('+24.0');
    expect(appliedBands(main)[5]).toBe(24);
    expect(appliedBands(preview)[5]).toBe(24);

    drag(bandSliders()[5], '-24');
    expect(bandSliders()[5].parentElement!.nextElementSibling!.textContent).toBe('-24.0');
    expect(appliedBands(main)[5]).toBe(-24);
  });

  it('AC 2.1.1 (negative): a value past the top stops at +24 dB, never beyond', () => {
    render();
    drag(bandSliders()[2], '40');
    expect(appliedBands(main)[2]).toBe(24);
    expect(loadEqualizerSettings()!.bands[2].gain).toBe(24);
  });

  it('AC 2.1.1/2.1.3: the curve peaks at +24 dB at the band, on a ±24 dB scale', () => {
    const { ctx, state } = recordingContext();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx);
    render();
    drag(bandSliders()[5], '24'); // 1 kHz peaking

    expect(curveYAt(state.curve!, 1000)).toBeCloseTo(gainToY(24, CANVAS_H, 24), 0); // the top edge
    // The scale's labels run every 6 dB to ±18 (the ±24 edges are unlabelled): a ±12 scale has no ±18.
    expect(state.labels).toEqual(expect.arrayContaining(['+18dB', '+12dB', '+6dB', '0dB', '-6dB', '-18dB']));
  });

  it('AC 2.1.1 (negative): a flat EQ draws no peak; +12 dB draws half-way up, not at the top', () => {
    const { ctx, state } = recordingContext();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx);
    render();
    expect(curveYAt(state.curve!, 1000)).toBeCloseTo(CANVAS_H / 2, 0);

    drag(bandSliders()[5], '12');
    expect(curveYAt(state.curve!, 1000)).toBeCloseTo(CANVAS_H / 4, 0);
  });

  it('AC 2.1.3: the hint text shows the range as −24 dB to +24 dB (not the old ±12)', () => {
    render();
    expect(container!.textContent).toContain('-24dB to +24dB');
    expect(container!.textContent).not.toContain('12dB to +12dB');
  });

  it('AC 2.1.4: on a phone each band reaches −24 and +24 dB on both EQs', () => {
    setViewport(390, 844);
    render();
    const gain = q<HTMLInputElement>('[data-eq-slider="gain"]')!;
    expect([gain.min, gain.max]).toEqual(['-24', '24']);

    act(() => q<HTMLButtonElement>('[data-eq-chip="1"]')!.click());
    drag(gain, '24');
    expect(q('[data-eq-value="gain"]')!.textContent).toBe('+24.0 dB');
    expect([appliedBands(main)[1], appliedBands(preview)[1]]).toEqual([24, 24]);

    drag(gain, '-24');
    expect(q('[data-eq-value="gain"]')!.textContent).toBe('-24.0 dB');
    expect([appliedBands(main)[1], appliedBands(preview)[1]]).toEqual([-24, -24]);
  });

  it('AC 2.1.4 (negative): on a phone a value past the range stops at ±24 dB', () => {
    setViewport(390, 844);
    render();
    drag(q<HTMLInputElement>('[data-eq-slider="gain"]')!, '-60');
    expect(appliedBands(main)[0]).toBe(-24);
  });
});

describe('§2.2 low cut and high cut', () => {
  it('AC 2.2.1: the low cut at 200 Hz makes the curve drop off below 200 Hz and not above', () => {
    const { ctx, state } = recordingContext();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx);
    render();
    click('[data-eq-toggle="lowCut"]');
    drag(q<HTMLInputElement>('[data-eq-slider="lowCut"]')!, String(cutFrequencyToPosition(200, LOW_CUT_RANGE)));

    expect(curveYAt(state.curve!, 100)).toBeGreaterThan(gainToY(-20, CANVAS_H, 24));
    expect(curveYAt(state.curve!, 1000)).toBeCloseTo(CANVAS_H / 2, 0);
  });

  it('AC 2.2.2: the high cut at 2 kHz makes the curve drop off above 2 kHz and not below', () => {
    const { ctx, state } = recordingContext();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx);
    render();
    click('[data-eq-toggle="highCut"]');
    drag(q<HTMLInputElement>('[data-eq-slider="highCut"]')!, String(cutFrequencyToPosition(2000, HIGH_CUT_RANGE)));

    expect(curveYAt(state.curve!, 4000)).toBeGreaterThan(gainToY(-20, CANVAS_H, 24));
    expect(curveYAt(state.curve!, 500)).toBeCloseTo(CANVAS_H / 2, 0);
  });

  it('AC 2.2.3: a cut set to Off shows no drop, reads Off, and both EQs return to pass-through', () => {
    const { ctx, state } = recordingContext();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx);
    render();
    const restLow = cutStages(main, 'low');
    const restHigh = cutStages(main, 'high');
    click('[data-eq-toggle="lowCut"]');
    click('[data-eq-toggle="highCut"]');
    drag(q<HTMLInputElement>('[data-eq-slider="lowCut"]')!, String(cutFrequencyToPosition(200, LOW_CUT_RANGE)));
    expect(cutStages(preview, 'low')).toEqual([200, 200]);

    click('[data-eq-toggle="lowCut"]');
    click('[data-eq-toggle="highCut"]');

    expect(q('[data-eq-value="lowCut"]')!.textContent).toBe('Off');
    expect(q('[data-eq-toggle="lowCut"]')!.getAttribute('aria-pressed')).toBe('false');
    for (const eq of [main, preview]) {
      expect(cutStages(eq, 'low')).toEqual(restLow);
      expect(cutStages(eq, 'high')).toEqual(restHigh);
    }
    expect(curveYAt(state.curve!, 30)).toBeCloseTo(CANVAS_H / 2, 0);
    expect(curveYAt(state.curve!, 19000)).toBeCloseTo(CANVAS_H / 2, 0);
    expect(loadEqualizerSettings()).toMatchObject({ lowCut: { enabled: false, frequency: 200 } });
  });

  it('AC 2.2.3 (negative): moving a cut slider while it is Off is not heard on either EQ', () => {
    render();
    const rest = cutStages(main, 'low');
    drag(q<HTMLInputElement>('[data-eq-slider="lowCut"]')!, String(cutFrequencyToPosition(300, LOW_CUT_RANGE)));
    expect(cutStages(main, 'low')).toEqual(rest);
    expect(cutStages(preview, 'low')).toEqual(rest);
    expect(main.getState().lowCut).toEqual({ enabled: false, frequency: 300 });
  });

  it('AC 2.2.5: on a phone both cuts are there and reach both EQs', () => {
    setViewport(390, 844);
    render();
    expect(q('[data-eq-compact]')).not.toBeNull();
    click('[data-eq-toggle="lowCut"]');
    drag(q<HTMLInputElement>('[data-eq-slider="lowCut"]')!, String(cutFrequencyToPosition(150, LOW_CUT_RANGE)));
    click('[data-eq-toggle="highCut"]');
    drag(q<HTMLInputElement>('[data-eq-slider="highCut"]')!, String(cutFrequencyToPosition(5000, HIGH_CUT_RANGE)));

    for (const eq of [main, preview]) {
      expect(cutStages(eq, 'low')).toEqual([150, 150]);
      expect(cutStages(eq, 'high')).toEqual([5000, 5000]);
    }
    expect(q('[data-eq-value="highCut"]')!.textContent).toBe('5.0 kHz');
  });
});

describe('§2.3 output level and the limiting indicator', () => {
  it('AC 2.3.1/2.3.2: the indicator lights past −1 dB of reduction and goes out after the hold once under the limit', () => {
    render();
    tick();
    expect(limiting()).toBe('off');

    setLimiterReduction(main, -6);
    tick();
    expect(limiting()).toBe('on');

    // The user lowers the output level: the signal falls under the limit.
    drag(q<HTMLInputElement>('[data-eq-slider="output"]')!, '-12');
    setLimiterReduction(main, 0);
    now += 100;
    tick();
    expect(limiting()).toBe('on'); // held, so a pumping limiter does not flicker
    now += 300;
    tick();
    expect(limiting()).toBe('off');
    expect(outputLinear(main)).toBeCloseTo(toLinear(-12), 6);
    expect(outputLinear(preview)).toBeCloseTo(toLinear(-12), 6);
  });

  it('AC 2.3.1 (negative): exactly −1 dB of reduction does not light it', () => {
    render();
    setLimiterReduction(main, -1);
    tick();
    tick();
    expect(limiting()).toBe('off');
  });

  it('AC 2.3.1 (negative): the indicator reads the speakers EQ only, not the headphone preview', () => {
    render();
    setLimiterReduction(preview, -10);
    tick();
    expect(limiting()).toBe('off');
  });

  it('AC 2.3.3 / 2.5: with the EQ off the indicator stays out (no protection stage while bypassed)', () => {
    render();
    click('button'); // the on/off toggle is the first button
    setLimiterReduction(main, -10);
    tick();
    expect(limiting()).toBe('off');
  });
});

describe('§2.4 genre presets', () => {
  it('AC 2.4.1: Phonk sets the bands, cuts and output on both EQs, updates the curve and shows Phonk', () => {
    const { ctx, state } = recordingContext();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx);
    render();
    const before = state.curve!.map((p) => p[1]);
    const phonk = EQUALIZER_PRESETS.phonk;
    pick('phonk');

    expect(selectValue()).toBe('phonk');
    for (const eq of [main, preview]) {
      expect(appliedBands(eq)).toEqual(phonk.gains);
      expect(eq.getState().outputGain).toBe(phonk.outputGain);
      expect(eq.getState().highCut).toEqual({ enabled: phonk.highCut != null, frequency: phonk.highCut ?? 12000 });
      expect(eq.getState().lowCut.enabled).toBe(phonk.lowCut != null);
    }
    expect(q('[data-eq-value="output"]')!.textContent).toBe(
      `${phonk.outputGain! > 0 ? '+' : ''}${phonk.outputGain!.toFixed(1)} dB`,
    );
    expect(state.curve!.map((p) => p[1])).not.toEqual(before);
  });

  it('AC 2.4.4 (negative): picking a preset alone does not show Custom', () => {
    render();
    pick('drumAndBass');
    expect(selectValue()).toBe('drumAndBass');
    expect(q('option[value="custom"]')).toBeNull();
    expect(loadEqualizerSettings()!.preset).toBe('drumAndBass');
  });

  it.each([
    ['the output level', () => drag(q<HTMLInputElement>('[data-eq-slider="output"]')!, '-3')],
    ['the low cut on/off', () => click('[data-eq-toggle="lowCut"]')],
    [
      'the high cut frequency',
      () =>
        drag(q<HTMLInputElement>('[data-eq-slider="highCut"]')!, String(cutFrequencyToPosition(9000, HIGH_CUT_RANGE))),
    ],
  ])('AC 2.4.4: changing %s after a genre preset shows Custom', (_label, change) => {
    render();
    pick('phonk');
    change();
    expect(selectValue()).toBe('custom');
    expect(loadEqualizerSettings()!.preset).toBe('custom');
  });

  it('AC 2.4.3: a profile preset after a genre preset with a low cut turns both cuts off on both EQs, output 0 dB', () => {
    const withLowCut = Object.entries(EQUALIZER_PRESETS).find(([, p]) => p.group === 'genre' && p.lowCut != null);
    expect(withLowCut).toBeDefined();
    render();
    pick(withLowCut![0]);
    expect(main.getState().lowCut.enabled).toBe(true);

    pick('pop');
    for (const eq of [main, preview]) {
      expect(eq.getState()).toMatchObject({ lowCut: { enabled: false }, highCut: { enabled: false }, outputGain: 0 });
      expect(outputLinear(eq)).toBeCloseTo(1, 9);
    }
    expect(q('[data-eq-value="lowCut"]')!.textContent).toBe('Off');
    expect(q('[data-eq-value="output"]')!.textContent).toBe('0.0 dB');
  });
});

describe('§2.5 EQ off is a true bypass', () => {
  it('AC 2.5.2: with the EQ off, cuts, output and a preset are not heard; switching on applies them', () => {
    render();
    const restLow = cutStages(main, 'low');
    click('button'); // off
    expect(main.getState().isEnabled).toBe(false);

    click('[data-eq-toggle="lowCut"]');
    drag(q<HTMLInputElement>('[data-eq-slider="lowCut"]')!, String(cutFrequencyToPosition(200, LOW_CUT_RANGE)));
    drag(q<HTMLInputElement>('[data-eq-slider="output"]')!, '-6');
    for (const eq of [main, preview]) {
      expect(cutStages(eq, 'low')).toEqual(restLow);
      expect(outputLinear(eq)).toBeCloseTo(1, 9);
    }
    pick('phonk');
    for (const eq of [main, preview]) {
      expect(appliedBands(eq)).toEqual(Array(10).fill(0));
      expect(outputLinear(eq)).toBeCloseTo(1, 9);
    }

    click('button'); // on
    for (const eq of [main, preview]) {
      expect(appliedBands(eq)).toEqual(EQUALIZER_PRESETS.phonk.gains);
      expect(outputLinear(eq)).toBeCloseTo(toLinear(EQUALIZER_PRESETS.phonk.outputGain!), 6);
    }
  });
});

describe('§2.6 saved settings', () => {
  const saved = () => {
    const s = getDefaultSettings();
    s.bands[0].gain = 20;
    return {
      ...s,
      preset: 'custom',
      lowCut: { enabled: true, frequency: 80 },
      outputGain: -6,
    };
  };

  /** Recreate the main EQ after the save, as a reload does (it loads the saved settings when created). */
  const reload = () => {
    destroyMainEqualizer();
    main = initMainEqualizer(ac as unknown as AudioContext, { setOutputInsert: vi.fn() });
    preview = new AudioEqualizer(ac as unknown as AudioContext);
  };

  it('AC 2.6.1: band +20 dB, low cut 80 Hz and output −6 dB are restored in the panel and heard', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved()));
    reload();
    render();

    expect(bandSliders()[0].parentElement!.nextElementSibling!.textContent).toBe('+20.0');
    expect(q('[data-eq-value="lowCut"]')!.textContent).toBe('80 Hz');
    expect(q('[data-eq-value="output"]')!.textContent).toBe('-6.0 dB');
    for (const eq of [main, preview]) {
      expect(appliedBands(eq)[0]).toBe(20);
      expect(cutStages(eq, 'low')).toEqual([80, 80]);
      expect(outputLinear(eq)).toBeCloseTo(toLinear(-6), 6);
    }
  });

  it('AC 2.6.2: a save from before spec 020 shows and sounds as before (cuts Off, output 0 dB)', () => {
    const bands = getDefaultSettings().bands.map((b, i) => ({ ...b, gain: i - 4 }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ isEnabled: true, preset: 'rock', bands }));
    reload();
    render();

    expect(selectValue()).toBe('rock');
    expect(q('[data-eq-value="lowCut"]')!.textContent).toBe('Off');
    expect(q('[data-eq-value="highCut"]')!.textContent).toBe('Off');
    expect(q('[data-eq-value="output"]')!.textContent).toBe('0.0 dB');
    expect(appliedBands(main)).toEqual(bands.map((b) => b.gain));
    expect(outputLinear(main)).toBeCloseTo(1, 9);
  });

  it('AC 2.6.3: damaged saved settings start the panel flat, and it works', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved(), outputGain: 40, lowCut: { enabled: 'yes' } }));
    reload();
    render();

    expect(selectValue()).toBe('flat');
    expect(bandSliders().map((s) => s.value)).toEqual(Array(10).fill('0'));
    expect(q('[data-eq-value="lowCut"]')!.textContent).toBe('Off');
    expect(q('[data-eq-value="output"]')!.textContent).toBe('0.0 dB');
    expect(appliedBands(main)).toEqual(Array(10).fill(0));

    drag(bandSliders()[3], '6');
    expect(appliedBands(main)[3]).toBe(6);
    expect(loadEqualizerSettings()!.bands[3].gain).toBe(6);
  });

  it('AC 2.6.3 (negative): unparseable JSON does not break the panel either', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    reload();
    render();
    expect(selectValue()).toBe('flat');
    expect(bandSliders()).toHaveLength(10);
  });
});

describe('§2.7 everyone gets the same EQ', () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), 'website/src/repl/components/panel', rel), 'utf8');

  it('AC 2.7.1: rendered with no auth provider and no Supabase, the wider range, the cuts and the genre presets are there', () => {
    render();
    expect([bandSliders()[0].min, bandSliders()[0].max]).toEqual(['-24', '24']);
    expect(q('[data-eq-toggle="lowCut"]')).not.toBeNull();
    expect(q('[data-eq-toggle="highCut"]')).not.toBeNull();
    expect(q('optgroup[data-eq-group="genre"]')!.querySelectorAll('option')).toHaveLength(12);
  });

  // SettingsTab-eq020.test.tsx renders the settings tab signed out and read-only; this pins the rest
  // of the chain: the mixer section always mounts the EQ, and no EQ module looks at sign-in.
  it('AC 2.7.1 (negative): no EQ module depends on sign-in, and the mixer section mounts the EQ unconditionally', () => {
    expect(read('MixerSettings.tsx')).toMatch(/^\s*<EqualizerUI previewEngine=\{mixer\} \/>$/m);
    for (const file of ['EqualizerUI.tsx', 'EqualizerCompact.tsx', 'EqualizerStripControls.tsx', 'MixerSettings.tsx']) {
      expect(read(file)).not.toMatch(/useAuth|supabase|isAuthenticated|readOnly/i);
    }
  });
});
