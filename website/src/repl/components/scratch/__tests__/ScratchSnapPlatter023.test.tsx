// @vitest-environment jsdom
/**
 * @spec: 023-vinyl-scratch-realism (2.2, 2.4, 2.5; tech §2.3)
 * - Mixer Settings → Scratch has a Snap to beat switch with its hint (on by default), stored in
 *   `strudel-scratch-snap` through the runtime.
 * - The on-screen platter follows the record's motor: it slows to a stop over ~0.1 s when
 *   grabbed and spins up over ~0.4 s when let go (the curves the worklet runs).
 * - The platter is dimmed while a track switch blocks the speakers deck (tech §3).
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
import type { ScratchActions } from '../../../scratch/scratchRuntime';
import { ScratchSection } from '../ScratchSection';
import { Platter, platterGrab, platterRate, platterRelease, type PlatterMotor } from '../Platter';
import { fakeRuntime, playing } from './scratchFakes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

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
  vi.unstubAllGlobals();
});

describe('Scratch section: Snap to beat', () => {
  // Spec 025 replaced the switch with a Snap grid choice: 023's "on" is Beat, "off" is Off.
  const choose = (select: HTMLSelectElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

  it('shows the choice and its hint, on (Beat) by default, and turning it off goes to the runtime (stored)', () => {
    const snaps: boolean[] = [];
    const { runtime } = fakeRuntime({ readSnap: () => true, writeSnap: (s) => snaps.push(s) });
    mount(<ScratchSection runtime={runtime} />);
    const label = container!.querySelector('[data-scratch-snap]')!;
    expect(label.textContent).toContain(en.scratchSnap);
    expect(label.textContent).toContain(en.scratchSnapHint);
    const select = label.querySelector<HTMLSelectElement>('select')!;
    expect(select.value).toBe('beat');
    choose(select, 'off');
    expect(snaps).toEqual([false]);
    expect(runtime.store.get().snap).toBe(false);
    expect(select.value).toBe('off');
  });

  it('negative pair: a stored "off" renders Off', () => {
    const { runtime } = fakeRuntime({ readSnap: () => false });
    mount(<ScratchSection runtime={runtime} />);
    expect(container!.querySelector<HTMLSelectElement>('[data-scratch-snap] select')!.value).toBe('off');
  });

  it('the platter is dimmed while a track switch blocks the speakers', async () => {
    let busy = false;
    const { runtime } = fakeRuntime();
    await playing(runtime);
    runtime.setMainRepl({ scheduler: { cps: 0.5, started: true } }, { isBusy: () => busy });
    mount(<ScratchSection runtime={runtime} />);
    const platter = () => container!.querySelector('[data-scratch-platter]')!;
    expect(platter().getAttribute('data-active')).toBe('true');
    busy = true;
    act(() => runtime.refreshBlocked());
    expect(platter().getAttribute('data-active')).toBe('false');
    busy = false;
    act(() => runtime.refreshBlocked());
    expect(platter().getAttribute('data-active')).toBe('true');
  });
});

describe('platter motor (the same curves as the sound)', () => {
  const run: PlatterMotor = { mode: 'run', from: 0, since: 0 };

  it('turns at normal speed, brakes to 0 over ~0.1 s when grabbed, spins up over ~0.4 s when let go', () => {
    expect(platterRate(run, 5000)).toBe(1);
    const braking = platterGrab(run, 1000);
    expect(platterRate(braking, 1000)).toBeCloseTo(1, 9);
    expect(platterRate(braking, 1050)).toBeCloseTo(0.5, 9);
    expect(platterRate(braking, 1100)).toBe(0);
    const spinning = platterRelease(braking, 2000);
    expect(platterRate(spinning, 2000)).toBe(0);
    expect(platterRate(spinning, 2200)).toBeCloseTo(0.5, 9);
    expect(platterRate(spinning, 2400)).toBe(1);
  });

  it('a grab during the spin-up brakes from the speed reached; a release mid-brake spins up from there', () => {
    const spinning = platterRelease(platterGrab(run, 0), 1000);
    const braking = platterGrab(spinning, 1200); // half way: rate 0.5
    expect(platterRate(braking, 1200)).toBeCloseTo(0.5, 9);
    expect(platterRate(braking, 1250)).toBeCloseTo(0.25, 9);
    const again = platterRelease(platterGrab(run, 0), 50); // released mid-brake at rate 0.5
    expect(platterRate(again, 50)).toBeCloseTo(0.5, 9);
  });

  it('the picture follows: per-frame turn drops to 0 after a grab and climbs back over ~0.4 s after the release', () => {
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      frames.push(fn);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const actions: ScratchActions = { grab: () => true, moveBy: () => {}, release: () => {}, autoRelease: () => {} };
    const render = (grabbed: boolean) =>
      act(() => root!.render(<Platter actions={actions} active={true} grabbed={grabbed} label="platter" />));
    mount(<Platter actions={actions} active={true} grabbed={false} label="platter" />);
    const disc = () => container!.querySelector('svg g') as SVGGElement;
    const angle = () => Number(/rotate\(([-\d.e]+)deg\)/.exec(disc().style.transform)?.[1] ?? 0);
    /** Advance one 10 ms frame and return how far the platter turned (degrees). */
    const frame = () => {
      const before = angle();
      now += 10;
      const fn = frames.shift()!;
      act(() => fn(now));
      return angle() - before;
    };
    frame();
    const full = frame();
    expect(full).toBeCloseTo((100 / 3 / 60) * 360 * 0.01, 6); // 33⅓ rpm
    render(true);
    const brake: number[] = [];
    for (let i = 0; i < 15; i++) brake.push(frame());
    expect(brake[0]).toBeGreaterThan(full * 0.9);
    expect(brake[5]).toBeLessThan(full * 0.6);
    expect(brake[11]).toBe(0); // stopped after ~0.1 s
    render(false);
    const spin: number[] = [];
    for (let i = 0; i < 45; i++) spin.push(frame());
    expect(spin[0]).toBeLessThan(full * 0.05);
    expect(spin[20]).toBeGreaterThan(full * 0.4);
    expect(spin[20]).toBeLessThan(full * 0.6);
    expect(spin[42]).toBeCloseTo(full, 6);
  });
});
