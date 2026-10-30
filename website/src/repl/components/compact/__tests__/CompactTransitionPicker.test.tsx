// @vitest-environment jsdom
/**
 * @spec: 017-track-transition-types (2.3, 2.4) @regression
 * On compact screens (spec 016's bottom bar) the transition picker sits next to Update: a 44px
 * type select bound to the same settings as Mixer Settings, and Update shows a waiting state while
 * a snapped switch waits for its boundary.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getTransitionSettings, setTransitionSettings } from '@src/settings';
import { TRANSITION_EVENTS } from '@src/repl/transitionPhase';
import { CompactControlBar } from '../CompactControlBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderBar() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const context = { started: true, isDirty: false, handleTogglePlay: () => {}, handleEvaluate: () => {} };
  act(() => root!.render(<CompactControlBar context={context} />));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  setTransitionSettings({ type: 'off' });
});

describe('compact control bar: transition picker (spec 017 2.4)', () => {
  it('shows a 44px type picker right after Update, and no length select', () => {
    const bar = renderBar();
    const buttons = [...bar.querySelectorAll('[data-compact-control-bar] > *')];
    const updateIndex = buttons.findIndex((el) => el.hasAttribute('data-bar-update'));
    const picker = buttons[updateIndex + 1];
    expect(picker?.hasAttribute('data-transition-picker')).toBe(true);
    const selects = picker!.querySelectorAll('select');
    expect(selects).toHaveLength(1);
    expect(selects[0].className).toContain('h-11');
  });

  it('picking a type in the bar changes the shared setting', () => {
    const bar = renderBar();
    const select = bar.querySelector('[data-transition-picker] select') as HTMLSelectElement;
    act(() => {
      select.value = 'echoOut';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(getTransitionSettings().type).toBe('echoOut');
  });

  it('Update shows the waiting state from track-transition-waiting until the transition starts', () => {
    const bar = renderBar();
    const update = () => bar.querySelector('[data-bar-update]')!.getAttribute('data-bar-update-waiting');
    expect(update()).toBe('false');
    act(() => {
      window.dispatchEvent(new CustomEvent(TRANSITION_EVENTS.waiting));
    });
    expect(update()).toBe('true');
    act(() => {
      window.dispatchEvent(new CustomEvent(TRANSITION_EVENTS.start));
    });
    expect(update()).toBe('false');
  });
});
