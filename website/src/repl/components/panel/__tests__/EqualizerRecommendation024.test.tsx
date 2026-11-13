// @vitest-environment jsdom
/**
 * @spec: 024-track-eq-profile (functional §2.2, §2.3, §2.4; tech §2.3)
 * "Track recommends" in the EQ panel follows the playing code's `// @eq-profile` line: hidden
 * without one, the preset, the plain-words description, the why and Apply on desktop and compact,
 * the user's EQ untouched until Apply. Apply sets both EQs (bands, cuts, output), names the preset
 * the settings equal or Custom, turns an EQ that is off on after storing the values silently, saves
 * like any EQ change, and reads Applied until the user changes something. Words follow the language.
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
import { AudioEqualizer, EQUALIZER_PRESETS, loadEqualizerSettings } from '@strudel/equalizer';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext } from '../../../../../../packages/mixer/test/webAudioMock.mjs';
import { destroyMainEqualizer, getMainEqualizer, initMainEqualizer } from '../../../mainEqualizer';
import { playingCodeEvaluated, playingStopped, resetPlayingEqProfile } from '../../../playingEqProfile';
import { EqualizerUI } from '../EqualizerUI';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const AUTOMOTIVO = EQUALIZER_PRESETS.automotivo;
const bandsOf = (gains: number[]) => FREQUENCIES.map((frequency, i) => ({ frequency, gain: gains[i] }));
const profileCode = (json: Record<string, unknown>) => `// @eq-profile ${JSON.stringify(json)}\ns("bd*4")`;
/** Bands, cuts and output equal to Automotivo, without naming it. */
const AUTOMOTIVO_BANDS = {
  v: 1,
  preset: null,
  bands: bandsOf(AUTOMOTIVO.gains),
  lowCut: { enabled: true, frequency: AUTOMOTIVO.lowCut },
  highCut: null,
  outputGain: AUTOMOTIVO.outputGain,
  why: 'render is 4 dB light in the sub versus the original',
};
const CUSTOM = {
  v: 1,
  preset: 'automotivo',
  bands: bandsOf([3.1, 2, 0, 0, 0, 0, 0, 0, 0, 0]),
  lowCut: null,
  highCut: { enabled: true, frequency: 14000 },
  outputGain: 0,
  why: 'render is 4 dB light in the sub versus the original',
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let preview: AudioEqualizer;

const q = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);
const text = (sel: string) => (q(sel)?.textContent ?? '').replace(/[⁦-⁩]/g, '');
const block = () => q('[data-eq-recommendation]');
const applyButton = () => q<HTMLButtonElement>('[data-eq-recommend="apply"]')!;
const picker = () => q<HTMLSelectElement>('select')!;
const main = () => getMainEqualizer()!;
const gains = (eq: AudioEqualizer) => eq.getState().bands.map((b) => b.gain);

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

const play = (code: string) => act(() => playingCodeEvaluated(code));
const click = (el: HTMLElement) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

function drag(input: HTMLInputElement, to: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, to);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces('settings');
  localStorage.clear();
  resetPlayingEqProfile();
  setViewport(1440, 900);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const ac = new MockAudioContext();
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

describe('§2.2 the block follows the playing code', () => {
  it('is not shown when nothing with a profile plays', () => {
    render();
    expect(block()).toBeNull();
    play('s("bd*4")');
    expect(block()).toBeNull();
  });

  it('desktop: title, preset, what it does, why and Apply', () => {
    render();
    play(profileCode(CUSTOM));
    expect(block()).not.toBeNull();
    expect(block()!.querySelector('h4')!.textContent).toBe('Track recommends');
    expect(text('[data-eq-recommend="preset"]')).toBe('Preset: Automotivo');
    expect(text('[data-eq-recommend="regions"]')).toBe('Sub +3 dB');
    expect(text('[data-eq-recommend="strip"]')).toBe('High cut 14 kHz');
    expect(text('[data-eq-recommend="why"]')).toBe('Why: render is 4 dB light in the sub versus the original');
    expect(applyButton().textContent).toBe('Apply');
    expect(applyButton().disabled).toBe(false);
    expect(block()!.getAttribute('aria-labelledby')).toBe(block()!.querySelector('h4')!.id);
  });

  it('no preset line when the profile names none', () => {
    render();
    play(profileCode(AUTOMOTIVO_BANDS));
    expect(q('[data-eq-recommend="preset"]')).toBeNull();
    expect(text('[data-eq-recommend="strip"]')).toBe('Low cut 25 Hz · Output −9 dB');
  });

  it('a track with a profile starting changes nothing in the EQ', () => {
    render();
    const before = main().getState();
    play(profileCode(AUTOMOTIVO_BANDS));
    expect(main().getState()).toEqual(before);
    expect(gains(preview)).toEqual(Array(10).fill(0));
    expect(picker().value).toBe('flat');
    expect(localStorage.getItem('strudel-equalizer-settings')).toBeNull();
  });

  it('disappears when playback stops or code without a profile is evaluated; follows a new profile', () => {
    render();
    play(profileCode(CUSTOM));
    act(() => playingStopped());
    expect(block()).toBeNull();
    play(profileCode(CUSTOM));
    play(profileCode({ v: 1, preset: 'phonk' }));
    expect(text('[data-eq-recommend="preset"]')).toBe('Preset: Phonk');
    play('s("bd*4")');
    expect(block()).toBeNull();
  });

  it('a malformed line shows nothing and does not throw', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render();
    expect(() => play('// @eq-profile {"v":1,"bands":[{"frequency":31,"gain":30}]}')).not.toThrow();
    expect(block()).toBeNull();
  });

  it('compact (phone): the same block, with a 44 px Apply', () => {
    setViewport(390, 844);
    render();
    play(profileCode(CUSTOM));
    expect(block()).not.toBeNull();
    expect(text('[data-eq-recommend="preset"]')).toBe('Preset: Automotivo');
    expect(text('[data-eq-recommend="why"]')).toMatch(/light in the sub/);
    expect(applyButton().className).toMatch(/min-h-11/);
    click(applyButton());
    expect(gains(main()).slice(0, 2)).toEqual([3.1, 2]);
  });
});

describe('§2.3 Apply', () => {
  it('bands equal to Automotivo: both EQs get them, the picker shows Automotivo, a reload keeps it', () => {
    render();
    play(profileCode(AUTOMOTIVO_BANDS));
    click(applyButton());

    for (const eq of [main(), preview]) {
      const state = eq.getState();
      expect(state.bands.map((b) => b.gain)).toEqual(AUTOMOTIVO.gains);
      expect(state.lowCut).toEqual({ enabled: true, frequency: 25 });
      expect(state.highCut!.enabled).toBe(false);
      expect(state.outputGain).toBe(-9);
    }
    expect(picker().value).toBe('automotivo');
    expect(applyButton().textContent).toBe('Applied');
    expect(applyButton().disabled).toBe(true);

    const saved = loadEqualizerSettings()!;
    expect(saved.preset).toBe('automotivo');
    expect(saved.isEnabled).toBe(true);
    expect(saved.bands.map((b) => b.gain)).toEqual(AUTOMOTIVO.gains);
    expect(saved.lowCut).toEqual({ enabled: true, frequency: 25 });
    expect(saved.outputGain).toBe(-9);

    unmount(); // reload: a new panel reads the saved settings
    render();
    expect(picker().value).toBe('automotivo');
  });

  it('bands equal to no preset: the picker shows Custom', () => {
    render();
    play(profileCode(CUSTOM));
    click(applyButton());
    expect(picker().value).toBe('custom');
    expect(gains(preview)).toEqual([3.1, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(main().getState().highCut).toEqual({ enabled: true, frequency: 14000 });
    expect(loadEqualizerSettings()!.preset).toBe('custom');
  });

  it('preset only: the same as picking the preset', () => {
    render();
    act(() => {
      picker().value = 'automotivo';
      picker().dispatchEvent(new Event('change', { bubbles: true }));
    });
    const picked = { main: main().getState(), saved: loadEqualizerSettings() };
    unmount();
    destroyMainEqualizer();
    localStorage.clear();
    initMainEqualizer(new MockAudioContext() as unknown as AudioContext, { setOutputInsert: vi.fn() });

    render();
    play(profileCode({ v: 1, preset: 'automotivo' }));
    click(applyButton());
    expect(main().getState()).toEqual(picked.main);
    expect(loadEqualizerSettings()).toEqual(picked.saved);
    expect(picker().value).toBe('automotivo');
  });

  it('EQ off: Apply stores every value first, then turns it on (nothing heard while off)', () => {
    render();
    click(q<HTMLButtonElement>('button')!); // the header's on/off toggle
    expect(main().getState().isEnabled).toBe(false);
    play(profileCode(AUTOMOTIVO_BANDS));
    expect(text('[data-eq-recommend="note"]')).toBe('Apply also turns the EQ on');

    const calls: string[] = [];
    /** What is heard right before each switch-on: the wet path's level and the band filters' gains. */
    const heardBeforeOn: { wet: number; bandGains: number[] }[] = [];
    const audible = (eq: AudioEqualizer) => {
      const internals = eq as unknown as { wetGain: GainNode; bands: { filter: BiquadFilterNode }[] };
      return { wet: internals.wetGain.gain.value, bandGains: internals.bands.map((b) => b.filter.gain.value) };
    };
    for (const [name, eq] of [
      ['main', main()],
      ['preview', preview],
    ] as const) {
      for (const method of ['setBand', 'setLowCut', 'setHighCut', 'setOutputGain', 'setEnabled'] as const) {
        const original = (eq[method] as (...args: unknown[]) => void).bind(eq);
        vi.spyOn(eq, method).mockImplementation((...args: unknown[]) => {
          calls.push(`${name}.${method}:${eq.getState().isEnabled ? 'on' : 'off'}`);
          if (method === 'setEnabled') heardBeforeOn.push(audible(eq));
          original(...args);
        });
      }
    }
    click(applyButton());

    for (const name of ['main', 'preview']) {
      const mine = calls.filter((c) => c.startsWith(`${name}.`));
      expect(mine.at(-1)).toBe(`${name}.setEnabled:off`); // the switch-on comes last…
      expect(mine.slice(0, -1).every((c) => c.endsWith(':off'))).toBe(true); // …every value is stored while off
      expect(mine.filter((c) => c.includes('setBand'))).toHaveLength(10);
    }
    // With every value stored, both EQs were still silent: wet path at 0 and the band filters flat.
    expect(heardBeforeOn).toEqual([
      { wet: 0, bandGains: Array(10).fill(0) },
      { wet: 0, bandGains: Array(10).fill(0) },
    ]);
    // …and once on, the band filters carry the recommendation.
    expect(audible(main()).bandGains).toEqual(AUTOMOTIVO.gains);
    expect(main().getState().isEnabled).toBe(true);
    expect(preview.getState().isEnabled).toBe(true);
    expect(loadEqualizerSettings()!.isEnabled).toBe(true);
    expect(q('[data-eq-recommend="note"]')!.textContent).toBe('');
    expect(applyButton().textContent).toBe('Applied');
  });

  it('after Apply, moving a band makes it Apply again', () => {
    render();
    play(profileCode(AUTOMOTIVO_BANDS));
    click(applyButton());
    expect(applyButton().textContent).toBe('Applied');
    const slider = container!.querySelectorAll<HTMLInputElement>('.sm\\:grid-cols-10 input[type="range"]')[7];
    drag(slider, '0');
    expect(picker().value).toBe('custom');
    expect(applyButton().textContent).toBe('Apply');
    expect(applyButton().disabled).toBe(false);
  });
});

describe('§2.4 languages', () => {
  it('the block follows the app language; the why stays as written', async () => {
    render();
    play(profileCode(CUSTOM));
    await act(async () => {
      await i18n.changeLanguage('ru');
      await i18n.loadNamespaces('settings');
    });
    expect(block()!.querySelector('h4')!.textContent).toBe('Трек рекомендует');
    expect(applyButton().textContent).toBe('Применить');
    expect(text('[data-eq-recommend="why"]')).toBe('Почему: render is 4 dB light in the sub versus the original');
  });
});
