// @vitest-environment jsdom
/**
 * @spec: 033-loudness-meter (functional §2.7 spectrum before the EQ; tech §2.4, §4 "the Before EQ toggle
 *   opens and closes the second tap")
 * The Before EQ toggle is off by default and remembered; with Spectrum on, Before EQ on and the speakers
 * playing, a second analyser listens to the EQ's input and is read in the same frame loop as the 026
 * one; turning Before EQ off, turning Spectrum off, stopping or closing the panel disconnects it.
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
import { AudioEqualizer } from '@strudel/equalizer';
import { MockAudioContext } from '../../../../../../packages/mixer/test/webAudioMock.mjs';
import { destroyMainEqualizer, getMainEqualizer, initMainEqualizer } from '../../../mainEqualizer';
import { playingCodeEvaluated, playingStopped, resetPlayingEqProfile } from '../../../playingEqProfile';
import { EQ_SPECTRUM_PRE_STORAGE_KEY } from '../../../meter/meterSettings';
import { EqualizerUI } from '../EqualizerUI';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MockNode {
  kind?: string;
  connections: MockNode[];
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let ac: InstanceType<typeof MockAudioContext>;
let preview: AudioEqualizer;
let frames: Map<number, () => void>;
let nextFrame: number;

const q = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);
const main = () => getMainEqualizer()!;
const analysersOn = (node: AudioNode) =>
  (node as unknown as MockNode).connections.filter((n) => n.kind === 'Analyser') as unknown as AnalyserNode[];
const preTaps = () => analysersOn(main().getInput());
const postTaps = () => analysersOn(main().getOutput());
const preToggle = () => q<HTMLInputElement>('[data-eq-spectrum-pre]')!;
const spectrumToggle = () => q<HTMLInputElement>('[data-eq-spectrum]')!;

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
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 900 });
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
});

describe('§2.7 Before EQ spectrum', () => {
  it('off by default: only the 026 tap, no before-EQ measurement', () => {
    render();
    act(() => playingCodeEvaluated('s("bd")'));
    expect(preToggle().checked).toBe(false);
    expect(postTaps()).toHaveLength(1);
    expect(preTaps()).toHaveLength(0);
  });

  it('on: a second tap on the EQ input, read in the same frames; off disconnects it; remembered', () => {
    render();
    act(() => playingCodeEvaluated('s("bd")'));
    click(preToggle());
    expect(preToggle().checked).toBe(true);
    expect(localStorage.getItem(EQ_SPECTRUM_PRE_STORAGE_KEY)).toBe('true');
    expect(preTaps()).toHaveLength(1);
    expect(postTaps()).toHaveLength(1);
    const pre = preTaps()[0];
    const post = postTaps()[0];
    const readPre = vi.spyOn(pre, 'getFloatFrequencyData');
    const readPost = vi.spyOn(post, 'getFloatFrequencyData');
    flush();
    flush();
    expect(readPre).toHaveBeenCalledTimes(2);
    expect(readPost).toHaveBeenCalledTimes(2);

    click(preToggle());
    expect(preTaps()).toHaveLength(0);
    expect(postTaps()).toHaveLength(1);
    expect(localStorage.getItem(EQ_SPECTRUM_PRE_STORAGE_KEY)).toBe('false');

    click(preToggle());
    unmount();
    render();
    expect(preToggle().checked).toBe(true); // remembered
    expect(preTaps()).toHaveLength(1);
  });

  it('negative: Spectrum off disables Before EQ and disconnects both taps', () => {
    localStorage.setItem(EQ_SPECTRUM_PRE_STORAGE_KEY, 'true');
    render();
    act(() => playingCodeEvaluated('s("bd")'));
    expect(preTaps()).toHaveLength(1);
    click(spectrumToggle());
    expect(preToggle().disabled).toBe(true);
    expect(preTaps()).toHaveLength(0);
    expect(postTaps()).toHaveLength(0);
  });

  it('not while stopped; stopping and closing the panel disconnect it, with no frames left', () => {
    localStorage.setItem(EQ_SPECTRUM_PRE_STORAGE_KEY, 'true');
    render();
    expect(preTaps()).toHaveLength(0); // nothing plays yet
    act(() => playingCodeEvaluated('s("bd")'));
    expect(preTaps()).toHaveLength(1);
    act(() => playingStopped());
    expect(preTaps()).toHaveLength(0);
    expect(frames.size).toBe(0);
    act(() => playingCodeEvaluated('s("bd")'));
    for (let i = 0; i < 3; i++) {
      unmount();
      expect(preTaps()).toHaveLength(0);
      render();
      expect(preTaps()).toHaveLength(1);
    }
  });
});
