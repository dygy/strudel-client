// @vitest-environment jsdom
/**
 * @spec: 025-scratch-feel-controls (2.1, 2.2; tech §2.3)
 * - Mixer Settings → Scratch has a Snap choice (Off / ½ beat / Beat / Bar), Brake and Spin-up
 *   sliders with readouts in seconds, and Reset; all go through the runtime (stored, both decks).
 * - Compact layout: 44 px touch targets for the choice and Reset.
 * - The on-screen platter brakes and spins up over the chosen times.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import en from '@src/i18n/locales/en/settings.json';
import { ScratchSection, formatFeelSeconds } from '../ScratchSection';
import { platterGrab, platterRate, platterRelease, type PlatterMotor } from '../Platter';
import { fakeRuntime } from './scratchFakes';
import type { ScratchFeel, ScratchSnapGrid } from '../../../scratch/scratchRuntime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;

function mount(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
});

const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string, event: 'change' | 'input') =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(event, { bubbles: true }));
  });

function feelRuntime(grid: ScratchSnapGrid = 'beat', feel?: ScratchFeel) {
  const grids: ScratchSnapGrid[] = [];
  const feels: ScratchFeel[] = [];
  const t = fakeRuntime({
    readSnapGrid: () => grid,
    writeSnapGrid: (g) => grids.push(g),
    readFeel: () => feel ?? { brakeSeconds: 0.1, spinUpSeconds: 0.4 },
    writeFeel: (f) => feels.push(f),
  });
  return { ...t, grids, feels };
}

const q = <T extends Element>(sel: string) => container!.querySelector<T>(sel)!;

describe('Scratch section: the Snap choice (2.1)', () => {
  it('offers Off, ½ beat, Beat and Bar, shows the stored one, and a choice goes to the runtime', () => {
    const { runtime, grids } = feelRuntime('beat');
    mount(<ScratchSection runtime={runtime} />);
    const select = q<HTMLSelectElement>('[data-scratch-snap] select');
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['off', en.scratchSnapOff],
      ['half', en.scratchSnapHalf],
      ['beat', en.scratchSnapBeat],
      ['bar', en.scratchSnapBar],
    ]);
    expect(select.value).toBe('beat');
    expect(q('[data-scratch-snap] label').textContent).toBe(en.scratchSnap);
    setValue(select, 'bar', 'change');
    expect(grids).toEqual(['bar']);
    expect(runtime.store.get().snapGrid).toBe('bar');
    expect(select.value).toBe('bar');
  });

  it('negative pair: a stored ½ beat renders ½ beat', () => {
    const { runtime } = feelRuntime('half');
    mount(<ScratchSection runtime={runtime} />);
    expect(q<HTMLSelectElement>('[data-scratch-snap] select').value).toBe('half');
  });
});

describe('Scratch section: Brake, Spin-up and Reset (2.2)', () => {
  it('shows both sliders with their ranges and readouts, and a move goes to the runtime', () => {
    const { runtime, feels } = feelRuntime();
    mount(<ScratchSection runtime={runtime} />);
    const brake = q<HTMLInputElement>('[data-scratch-feel="brakeSeconds"] input[type="range"]');
    const spin = q<HTMLInputElement>('[data-scratch-feel="spinUpSeconds"] input[type="range"]');
    expect([brake.min, brake.max, brake.value]).toEqual(['0.02', '1', '0.1']);
    expect([spin.min, spin.max, spin.value]).toEqual(['0.1', '2', '0.4']);
    expect(q('[data-scratch-feel="brakeSeconds"] label').textContent).toBe(en.scratchBrake);
    expect(q('[data-scratch-feel="spinUpSeconds"] label').textContent).toBe(en.scratchSpinUp);
    const readout = (key: string) => q(`[data-scratch-feel="${key}"] [data-scratch-feel-value]`).textContent;
    expect(readout('brakeSeconds')).toMatch(/^0\.1\s?s/);
    expect(readout('spinUpSeconds')).toMatch(/^0\.4\s?s/);

    setValue(brake, '0.5', 'input');
    setValue(spin, '1.5', 'input');
    expect(feels.at(-1)).toEqual({ brakeSeconds: 0.5, spinUpSeconds: 1.5 });
    expect(readout('brakeSeconds')).toMatch(/^0\.5\s?s/);
    expect(readout('spinUpSeconds')).toMatch(/^1\.5\s?s/);
    setValue(brake, '0.02', 'input');
    expect(readout('brakeSeconds')).toMatch(/^0\.02\s?s/);
    expect(q('[data-scratch-feel-hint]').textContent).toBe(en.scratchFeelHint);
  });

  it('Reset brings back 0.1 s and 0.4 s; it is disabled at the defaults', () => {
    const { runtime, feels } = feelRuntime('beat', { brakeSeconds: 0.5, spinUpSeconds: 1.5 });
    mount(<ScratchSection runtime={runtime} />);
    const reset = q<HTMLButtonElement>('[data-scratch-feel-reset]');
    expect(reset.textContent).toBe(en.scratchFeelReset);
    expect(reset.disabled).toBe(false);
    act(() => reset.click());
    expect(feels.at(-1)).toEqual({ brakeSeconds: 0.1, spinUpSeconds: 0.4 });
    expect(q<HTMLInputElement>('[data-scratch-feel="brakeSeconds"] input').value).toBe('0.1');
    expect(q<HTMLInputElement>('[data-scratch-feel="spinUpSeconds"] input').value).toBe('0.4');
    expect(reset.disabled).toBe(true);
  });

  it('compact layout: the choice and Reset are 44 px touch targets', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    const { runtime } = feelRuntime();
    mount(<ScratchSection runtime={runtime} />);
    expect(q('[data-scratch-snap] select').className).toContain('min-h-11');
    expect(q('[data-scratch-feel-reset]').className).toContain('min-h-11');
  });

  it('negative pair: the desktop layout uses the compact-free sizes', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    const { runtime } = feelRuntime();
    mount(<ScratchSection runtime={runtime} />);
    expect(q('[data-scratch-snap] select').className).not.toContain('min-h-11');
  });

  it('formats readouts: one decimal, two when one would hide the value', () => {
    expect(formatFeelSeconds(0.1, 'en')).toMatch(/^0\.1\s?s/);
    expect(formatFeelSeconds(2, 'en')).toMatch(/^2\.0\s?s/);
    expect(formatFeelSeconds(0.02, 'en')).toMatch(/^0\.02\s?s/);
    expect(formatFeelSeconds(0.15, 'en')).toMatch(/^0\.15\s?s/);
  });
});

describe('platter motor follows the feel (2.2)', () => {
  const run: PlatterMotor = { mode: 'run', from: 0, since: 0 };

  it('Brake 0.5 s: half speed at 0.25 s, stopped at 0.5 s; Spin-up 1.5 s: half at 0.75 s, full at 1.5 s', () => {
    const braking = platterGrab(run, 1000, 0.5);
    expect(platterRate(braking, 1250)).toBeCloseTo(0.5, 9);
    expect(platterRate(braking, 1499)).toBeGreaterThan(0);
    expect(platterRate(braking, 1500)).toBe(0);
    const spinning = platterRelease(braking, 2000, 1.5);
    expect(platterRate(spinning, 2750)).toBeCloseTo(0.5, 9);
    expect(platterRate(spinning, 3499)).toBeLessThan(1);
    expect(platterRate(spinning, 3500)).toBe(1);
  });

  it('negative pair: without a feel the 023 times apply (0.1 s, 0.4 s)', () => {
    const braking = platterGrab(run, 1000);
    expect(platterRate(braking, 1100)).toBe(0);
    expect(platterRate(platterRelease(braking, 2000), 2400)).toBe(1);
  });
});
