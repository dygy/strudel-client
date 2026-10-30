// @vitest-environment jsdom
/**
 * The transition picker next to Update (spec 017 §2.4) and Update's waiting state (§2.3):
 * - picker ↔ Mixer Settings show the same choice, both ways;
 * - Update shows a waiting state from `track-transition-waiting` until the transition starts;
 * - a switch uses the settings in force when it begins: a change mid-transition doesn't alter
 *   the running switch, and a switch queued behind it takes the newer choice.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));
vi.mock('../../../components/auth/AuthButton', () => ({ AuthButton: () => null }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { s } from '../../../../../packages/core/index.mjs';
import { getTransitionSettings, setTransitionSettings } from '@src/settings';
import { DEFAULT_TRANSITION, settingsForSwitch } from '@src/repl/transitionSettings';
import { TRANSITION_EVENTS } from '@src/repl/transitionPhase';
import en from '@src/i18n/locales/en/settings.json';
import { TrackTransitionController } from '../../../../../packages/mixer/TrackTransitionController.mjs';
import { TransitionPicker } from '../TransitionPicker';
import { TransitionSettingsSection } from '../panel/TransitionSettingsSection';
import { UpdateButton } from '../Header';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const typeSelect = () => container!.querySelector<HTMLSelectElement>('[data-transition-picker] select')!;
const lengthSelect = () => container!.querySelectorAll<HTMLSelectElement>('[data-transition-picker] select')[1];
const sectionRadio = (type: string) =>
  container!.querySelector(`[data-transition-type="${type}"]`)!.closest('label')!.querySelector('input')!;
const choose = (select: HTMLSelectElement, value: string) =>
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
const emit = (name: keyof typeof TRANSITION_EVENTS) =>
  act(() => {
    window.dispatchEvent(new CustomEvent(TRANSITION_EVENTS[name], { detail: { timestamp: 0 } }));
  });

beforeEach(() => setTransitionSettings({ ...DEFAULT_TRANSITION }));
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  setTransitionSettings({ ...DEFAULT_TRANSITION });
});

describe('picker ↔ Mixer Settings', () => {
  it('shows the selected type, with the eight options in the user’s language', () => {
    act(() => setTransitionSettings({ type: 'crossfade' }));
    render(<TransitionPicker />);
    expect(typeSelect().value).toBe('crossfade');
    expect([...typeSelect().options].map((o) => o.textContent)).toEqual([
      en.transitionTypeOff,
      en.transitionTypeDip,
      en.transitionTypeCut,
      en.transitionTypeCrossfade,
      en.transitionTypeFilterSweep,
      en.transitionTypeBassSwap,
      en.transitionTypeEchoOut,
      en.transitionTypeLayeredIntro,
    ]);
  });

  it('Echo-out picked in the picker is selected in Mixer Settings', () => {
    render(
      <>
        <TransitionPicker />
        <TransitionSettingsSection />
      </>,
    );
    choose(typeSelect(), 'echoOut');
    expect(sectionRadio('echoOut').checked).toBe(true);
    expect(getTransitionSettings().type).toBe('echoOut');
  });

  it('a choice in Mixer Settings shows in the picker (type and length)', () => {
    render(
      <>
        <TransitionPicker />
        <TransitionSettingsSection />
      </>,
    );
    act(() => sectionRadio('layeredIntro').click());
    expect(typeSelect().value).toBe('layeredIntro');
    choose(lengthSelect(), '8');
    expect(getTransitionSettings().length).toBe(8);
    const sectionLength = [...container!.querySelectorAll<HTMLInputElement>('input[name=transition-length]')].find(
      (r) => r.checked,
    );
    expect(sectionLength!.closest('label')!.textContent).toBe('8');
  });

  it('the length is greyed out for Off and Cut', () => {
    render(<TransitionPicker />);
    expect(lengthSelect().disabled).toBe(true);
    choose(typeSelect(), 'cut');
    expect(lengthSelect().disabled).toBe(true);
    choose(typeSelect(), 'dip');
    expect(lengthSelect().disabled).toBe(false);
  });
});

describe('Update shows a waiting switch', () => {
  const context = {
    handleTogglePlay: () => {},
    handleEvaluate: vi.fn(),
    handleShuffle: () => {},
    handleShare: () => {},
  };
  const update = () => container!.querySelector('button')!;

  it('waiting from track-transition-waiting until the transition starts', () => {
    render(<UpdateButton context={context} />);
    expect(update().title).toBe('Update (Ctrl+U)');
    expect(update().className).not.toContain('animate-pulse');

    emit('waiting');
    expect(update().title).toContain(en.transitionWaiting);
    expect(update().className).toContain('animate-pulse');

    emit('start');
    expect(update().title).toBe('Update (Ctrl+U)');
    expect(update().className).not.toContain('animate-pulse');
  });

  it('the waiting state clears when the switch fails or is cancelled', () => {
    render(<UpdateButton context={context} />);
    emit('waiting');
    emit('error');
    expect(update().className).not.toContain('animate-pulse');
    emit('waiting');
    emit('end');
    expect(update().className).not.toContain('animate-pulse');
  });

  it('still updates when pressed', () => {
    render(<UpdateButton context={context} />);
    act(() => update().click());
    expect(context.handleEvaluate).toHaveBeenCalledTimes(1);
  });
});

describe('a switch uses the settings in force when it begins', () => {
  /** A Cyclist-shaped scheduler on the fake clock, and a repl whose setPattern runs editPattern. */
  type Pattern = Parameters<TrackTransitionController['editPattern']>[0];

  function setup() {
    const sch = {
      started: true,
      cps: 0.5,
      latency: 0,
      pattern: s('old') as Pattern,
      anchorCycle: 9.5,
      anchorMs: Date.now(),
      now: () => sch.anchorCycle + ((Date.now() - sch.anchorMs) / 1000) * sch.cps,
      setCps(cps: number) {
        sch.anchorCycle = sch.now();
        sch.anchorMs = Date.now();
        sch.cps = cps;
      },
      async setPattern(pattern: Pattern) {
        sch.pattern = pattern;
      },
    };
    const repl = {
      scheduler: sch,
      state: { layers: [] },
      async setPattern(pattern: Pattern) {
        const edited = controller.editPattern(pattern);
        await sch.setPattern(edited);
        return edited;
      },
      async evaluate(code: string): Promise<void> {
        await repl.setPattern(s(code) as Pattern);
      },
    };
    const controller = new TrackTransitionController({ repl, getSettings: getTransitionSettings });
    return { sch, controller };
  }

  /** What the web does on a switch (useReplContext.evaluateNewTrack). */
  const switchTo = (controller: TrackTransitionController, code: string) =>
    controller.switchTo(code, settingsForSwitch(getTransitionSettings(), controller.busy));

  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  it('changing the picker mid-transition does not alter it; the next switch uses the new type', async () => {
    const { controller } = setup();
    setTransitionSettings({ type: 'crossfade', length: 1 });

    const first = switchTo(controller, 'b');
    await vi.advanceTimersByTimeAsync(600); // past T: the crossfade runs
    expect(controller.getState()).toMatchObject({ phase: 'running', type: 'crossfade' });

    setTransitionSettings({ type: 'bassSwap' }); // the picker, during the transition
    await vi.advanceTimersByTimeAsync(100);
    expect(controller.getState().type).toBe('crossfade');

    await vi.advanceTimersByTimeAsync(3000);
    await expect(first).resolves.toMatchObject({ type: 'crossfade' });

    const second = switchTo(controller, 'c');
    await vi.advanceTimersByTimeAsync(10);
    expect(controller.getState().type).toBe('bassSwap');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(second).resolves.toMatchObject({ type: 'bassSwap' });
    controller.destroy();
  });

  it('a switch queued behind a running one takes the type selected when it begins, not when pressed', async () => {
    const { controller } = setup();
    setTransitionSettings({ type: 'crossfade', length: 1 });

    const first = switchTo(controller, 'b');
    await vi.advanceTimersByTimeAsync(600);
    const queued = switchTo(controller, 'c'); // pressed while Crossfade is selected...
    setTransitionSettings({ type: 'echoOut' }); // ...then the picker changes before it begins

    await vi.advanceTimersByTimeAsync(3000);
    await expect(first).resolves.toMatchObject({ type: 'crossfade' });
    await vi.advanceTimersByTimeAsync(10000);
    await expect(queued).resolves.toMatchObject({ type: 'echoOut' });
    controller.destroy();
  });
});
