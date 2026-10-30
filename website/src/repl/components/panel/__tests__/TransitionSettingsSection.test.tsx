// @vitest-environment jsdom
/**
 * Mixer Settings → Transition (spec 017 §2.1–2.3), rendered: the eight-option radio group with
 * its description, Length in cycles, the modifiers, their greyed-out states, and persistence
 * through the settings store (what a reload reads back).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage` (undefined without --localstorage-file), which
// shadows jsdom's; settings.ts reads it at import time, so point it at jsdom's before imports.
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getTransitionSettings, setTransitionSettings, settingsMap } from '@src/settings';
import { DEFAULT_TRANSITION, parseTransitionSettings } from '@src/repl/transitionSettings';
import en from '@src/i18n/locales/en/settings.json';
import { TransitionSettingsSection } from '../TransitionSettingsSection';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<TransitionSettingsSection />));
  return container;
}

const q = <T extends Element = HTMLElement>(selector: string) => container!.querySelector<T>(selector);
const radios = (name: string) => [...container!.querySelectorAll<HTMLInputElement>(`input[type=radio][name=${name}]`)];
const typeRadio = (type: string) => q(`[data-transition-type="${type}"]`)!.closest('label')!.querySelector('input')!;
const lengthFieldset = () => q<HTMLFieldSetElement>('[data-transition-length]')!;
const snapFieldset = () => q('[data-transition-snap]')!.closest('fieldset') as HTMLFieldSetElement;
const glideBox = () => q('[data-transition-glide]')!.querySelector('input')!;
const description = () => q('[data-transition-description]')!.textContent;
const click = (el: HTMLElement) => act(() => el.click());

beforeEach(() => {
  setTransitionSettings({ ...DEFAULT_TRANSITION });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  setTransitionSettings({ ...DEFAULT_TRANSITION });
});

describe('the Transition radio group', () => {
  it('shows the eight options with exactly one selected, and no on/off switch', () => {
    render();
    const group = radios('transition-type');
    expect(group).toHaveLength(8);
    expect(group.filter((r) => r.checked)).toHaveLength(1);
    expect(typeRadio('off').checked).toBe(true);
    expect(container!.querySelectorAll('input[type=range]')).toHaveLength(0);
    expect(container!.textContent).not.toContain(en.transitionDescDip.slice(0, 20)); // only Off's line shows
  });

  it('selecting an option changes the description to that option’s', () => {
    render();
    expect(description()).toBe(en.transitionDescOff);
    click(typeRadio('echoOut'));
    expect(description()).toBe(en.transitionDescEchoOut);
    expect(typeRadio('echoOut').checked).toBe(true);
    expect(typeRadio('off').checked).toBe(false);
  });

  it('the choice is persisted: what a reload reads back is the selected option', () => {
    render();
    click(typeRadio('bassSwap'));
    expect(settingsMap.get().transitionType).toBe('bassSwap');
    expect(localStorage.getItem('strudel-settingstransitionType')).toBe('bassSwap');
    expect(getTransitionSettings().type).toBe('bassSwap');
  });

  it('a change made elsewhere (the picker) shows here too', () => {
    render();
    act(() => setTransitionSettings({ type: 'filterSweep' }));
    expect(typeRadio('filterSweep').checked).toBe(true);
  });
});

describe('Length', () => {
  it('offers 1, 2, 4, 8 and 16 cycles with 4 selected by default', () => {
    render();
    const lengths = radios('transition-length');
    expect(lengths.map((r) => r.closest('label')!.textContent)).toEqual(['1', '2', '4', '8', '16']);
    expect(lengths.filter((r) => r.checked).map((r) => r.closest('label')!.textContent)).toEqual(['4']);
  });

  it('a chosen length is stored', () => {
    act(() => setTransitionSettings({ type: 'crossfade' }));
    render();
    click(radios('transition-length')[4]);
    expect(parseTransitionSettings(settingsMap.get()).length).toBe(16);
  });

  it('greyed out and unchangeable for Off and Cut, enabled for the others', () => {
    render();
    expect(lengthFieldset().disabled).toBe(true); // Off
    click(typeRadio('cut'));
    expect(lengthFieldset().disabled).toBe(true);
    click(typeRadio('crossfade'));
    expect(lengthFieldset().disabled).toBe(false);
    click(typeRadio('dip'));
    expect(lengthFieldset().disabled).toBe(false);
  });
});

describe('modifiers', () => {
  it('Snap to, Tempo glide and Match loudness are greyed out for Off only', () => {
    render();
    expect(snapFieldset().disabled).toBe(true);
    click(typeRadio('cut'));
    expect(snapFieldset().disabled).toBe(false);
  });

  it('Tempo glide is greyed out for Dip and Cut, usable for the overlapping types', () => {
    render();
    click(typeRadio('dip'));
    expect(glideBox().disabled).toBe(true);
    click(typeRadio('cut'));
    expect(glideBox().disabled).toBe(true);
    click(typeRadio('crossfade'));
    expect(glideBox().disabled).toBe(false);
  });

  it('each modifier persists', () => {
    act(() => setTransitionSettings({ type: 'crossfade' }));
    render();
    click(radios('transition-snap')[2]); // next 4 cycles
    click(glideBox());
    click(q('[data-transition-match-loudness]')!.querySelector('input')!);
    expect(getTransitionSettings()).toEqual({
      type: 'crossfade',
      length: 4,
      snap: 4,
      glide: true,
      matchLoudness: true,
    });
  });
});
