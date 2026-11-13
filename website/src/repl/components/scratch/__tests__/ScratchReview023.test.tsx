// @vitest-environment jsdom
/**
 * @spec: 023-vinyl-scratch-realism (review fixes 2 and 4, website side)
 * - 4: the Update / Ctrl+Enter paths (beforeUpdate, beforeEvaluate, beforeEval) let go with
 *   `commitPending`, so a record already spinning up keeps its lag; start / stop (onToggle) don't.
 * - 2: the worklet's release plan reaches the store, and the platter follows it: a stretched
 *   release reaches full speed when the sound does, not at the nominal 0.4 s.
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
import { ScratchController, planScratchRelease, scratchReleaseRate } from '@strudel/mixer';
import { createScratchReplHooks } from '../../../scratch/scratchReplHooks';
import { selectedSpin, type ScratchActions } from '../../../scratch/scratchRuntime';
import { Platter, platterFollowPlan, platterRate, platterRelease, type PlatterMotor } from '../Platter';
import { FakeDeck, fakeRuntime, playing } from './scratchFakes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('review 4: Update paths keep a spin-up, stop paths drop it', () => {
  it('beforeUpdate, beforeEvaluate and beforeEval commit; onToggle (start/stop) does not', () => {
    const calls: unknown[] = [];
    const hooks = createScratchReplHooks({ releaseAll: (options?: unknown) => calls.push(options ?? 'cancel') });
    const options = hooks.replOptions({ beforeEval: () => {}, onToggle: (_playing: boolean) => {} });
    hooks.beforeUpdate();
    hooks.beforeEvaluate();
    options.beforeEval!();
    options.onToggle!(false);
    options.onToggle!(true);
    expect(calls).toEqual([
      { commitPending: true },
      { commitPending: true },
      { commitPending: true },
      'cancel',
      'cancel',
    ]);
  });

  it('the runtime hands the option to the controller', async () => {
    const releaseAll = vi.spyOn(ScratchController.prototype, 'releaseAll');
    const { runtime } = fakeRuntime();
    await playing(runtime);
    runtime.releaseAll({ commitPending: true });
    runtime.releaseAll();
    expect(releaseAll.mock.calls.map((c) => c[0])).toEqual([{ commitPending: true }, undefined]);
    releaseAll.mockRestore();
  });
});

describe('review 2: the platter follows the release plan', () => {
  it('the selected deck’s plan reaches the store; the other deck’s is not drawn', async () => {
    class PlanDeck extends FakeDeck {
      emitPlan: ((p: any) => void) | null = null;
      onPlan(fn: (p: any) => void) {
        this.emitPlan = fn;
        return () => (this.emitPlan = null);
      }
    }
    const deck = new PlanDeck();
    const { runtime } = fakeRuntime({ createDeck: () => deck as never });
    await playing(runtime);
    deck.emitPlan!({ id: 3, upSeconds: 0.6, fromRate: 0, bumpSeconds: 0.7, bumpDepth: 0.08, targetSeconds: 1 });
    const state = runtime.store.get();
    expect(selectedSpin(state)).toMatchObject({ deck: 'main', id: 3, upSeconds: 0.6, bumpSeconds: 0.7 });
    expect(selectedSpin({ ...state, selected: 'preview' })).toBeNull();
  });

  it('a stretched release: the picture is at full speed exactly when the sound is (not at 0.4 s)', () => {
    const plan = planScratchRelease({ lagSeconds: 0.57, fromRate: 0, beatSeconds: 0.5 });
    expect(plan.upSeconds).toBeCloseTo(0.8, 9);
    const released: PlatterMotor = platterRelease({ mode: 'brake', from: 1, since: 0 }, 1000);
    const following = platterFollowPlan(released, plan);
    for (let ms = 0; ms <= 2500; ms += 10) {
      expect(platterRate(following, 1000 + ms)).toBeCloseTo(scratchReleaseRate(ms / 1000, plan, 0), 9);
    }
    // The nominal curve would be at full speed at 0.4 s; the sound is still at about half.
    expect(platterRate(released, 1400)).toBe(1);
    expect(platterRate(following, 1400)).toBeLessThan(0.6);
    // Full speed when the sound settles (spin-up plus the correction).
    expect(platterRate(following, 1000 + (plan.upSeconds + plan.bumpSeconds) * 1000)).toBe(1);
  });

  it('in the component: the plan that arrives after the release takes over the picture', () => {
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
    const plan = planScratchRelease({ lagSeconds: 0.57, fromRate: 0, beatSeconds: 0.5 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const render = (grabbed: boolean, spin: typeof plan | null) =>
      act(() => root!.render(<Platter actions={actions} active grabbed={grabbed} spin={spin} label="platter" />));
    render(false, null);
    const angle = () =>
      Number(
        /rotate\(([-\d.e]+)deg\)/.exec((container!.querySelector('svg g') as SVGGElement).style.transform)?.[1] ?? 0,
      );
    const frame = () => {
      const before = angle();
      now += 10;
      const fn = frames.shift()!;
      act(() => fn(now));
      return angle() - before;
    };
    frame();
    const full = frame();
    render(true, null);
    for (let i = 0; i < 20; i++) frame(); // stopped
    render(false, null); // let go…
    frame();
    render(false, plan); // …and the worklet's plan arrives 10 ms later
    const turns: number[] = [];
    for (let i = 0; i < 200; i++) turns.push(frame());
    // At 0.4 s (frame ~40) the nominal curve would be at full speed; the planned one isn't.
    expect(turns[38]).toBeLessThan(full * 0.6);
    // Full speed by the end of the spin-up and the correction (~1.5 s), and not before 0.8 s.
    expect(turns[70]).toBeLessThan(full * 0.999);
    expect(turns[160]).toBeCloseTo(full, 6);
  });
});
