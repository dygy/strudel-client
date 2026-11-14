// @vitest-environment jsdom
/**
 * Mixer Settings → Transition (spec 017 §2.1–2.3, spec 027 §2.1–2.2), rendered: the eight-option
 * radio group with its description, Length in cycles, the modifiers (Snap to with 16 cycles and
 * its description, the 4-way Tempo choice), their greyed-out states, and persistence through the
 * settings store (what a reload reads back). Desktop and the compact (390x844) layout.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';

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
import { setPersistentEngine, windowPersistentEvents } from '@nanostores/persistent';
import { getTransitionSettings, setTransitionSettings, settingsMap } from '@src/settings';
import { DEFAULT_TRANSITION, migrateLegacyTempoGlide, parseTransitionSettings } from '@src/repl/transitionSettings';
import en from '@src/i18n/locales/en/settings.json';
import i18n from '@src/i18n/i18n';
import { TransitionSettingsSection } from '../TransitionSettingsSection';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
const tempoRadio = (tempo: string) =>
  q(`[data-transition-tempo-option="${tempo}"]`)!.closest('label')!.querySelector('input')!;
const tempoLabel = (tempo: string) => q(`[data-transition-tempo-option="${tempo}"]`)!.closest('label')!;
const enabledTempos = () =>
  radios('transition-tempo')
    .filter((r) => !r.disabled)
    .map((r) =>
      r.closest('label')!.querySelector('[data-transition-tempo-option]')!.getAttribute('data-transition-tempo-option'),
    );
const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};
const originalSize = { width: window.innerWidth, height: window.innerHeight };
const description = () => q('[data-transition-description]')!.textContent;
const click = (el: HTMLElement) => act(() => el.click());

// The suite runs with isolate:false, so settings.ts may have been loaded (and its persistent
// store bound to a storage) by an earlier file's jsdom. Point the store at this file's storage.
beforeAll(() => setPersistentEngine(localStorage, windowPersistentEvents));

// isolate:false: an earlier file can leave the settings store's language non-English (settings.ts
// copies i18next's cached language into it once, 10 ms after it loads), and then any settings write
// switches i18n to that language (the settings.ts subscription). Start each test in English.
beforeEach(async () => {
  await i18n.changeLanguage('en');
  if (settingsMap.get().language !== 'en') settingsMap.setKey('language', 'en');
  setTransitionSettings({ ...DEFAULT_TRANSITION });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  setTransitionSettings({ ...DEFAULT_TRANSITION });
  setViewport(originalSize.width, originalSize.height);
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
  it('Snap to, Tempo and Match loudness are greyed out for Off only', () => {
    render();
    expect(snapFieldset().disabled).toBe(true);
    expect(radios('transition-tempo').every((r) => r.disabled)).toBe(true);
    click(typeRadio('cut'));
    expect(snapFieldset().disabled).toBe(false);
  });

  it('each modifier persists', () => {
    act(() => setTransitionSettings({ type: 'crossfade' }));
    render();
    click(radios('transition-snap')[2]); // next 4 cycles
    click(tempoRadio('glide'));
    click(q('[data-transition-match-loudness]')!.querySelector('input')!);
    expect(getTransitionSettings()).toEqual({
      type: 'crossfade',
      length: 4,
      snap: 4,
      tempo: 'glide',
      matchLoudness: true,
    });
  });
});

describe('Snap to (spec 027 §2.1)', () => {
  it('offers Off, next cycle, 4, 8 and 16 cycles, with the phrase description', () => {
    render();
    const labels = radios('transition-snap').map((r) => r.closest('label')!.textContent);
    expect(labels).toEqual([
      en.transitionSnapOff,
      en.transitionSnapNext1,
      en.transitionSnapNext4,
      en.transitionSnapNext8,
      en.transitionSnapNext16,
    ]);
    expect(q('[data-transition-snap-description]')!.textContent).toBe(en.transitionSnapDescription);
    expect(en.transitionSnapDescription).toMatch(/began/);
  });

  it('16 cycles is stored and read back', () => {
    act(() => setTransitionSettings({ type: 'crossfade' }));
    render();
    click(radios('transition-snap')[4]);
    expect(localStorage.getItem('strudel-settingstransitionSnap')).toBe('16');
    expect(getTransitionSettings().snap).toBe(16);
    expect(radios('transition-snap')[4].checked).toBe(true);
  });
});

describe('Tempo (spec 027 §2.2)', () => {
  it('four options with a description each, Jump selected by default, no Tempo glide checkbox', () => {
    act(() => setTransitionSettings({ type: 'crossfade' }));
    render();
    const group = q('[data-transition-tempo] [role=radiogroup]')!;
    expect(group.getAttribute('aria-label')).toBe(en.transitionTempo);
    const labels = radios('transition-tempo').map((r) => r.closest('label')!.textContent);
    expect(labels).toEqual([
      en.transitionTempoJump + en.transitionTempoJumpDescription,
      en.transitionTempoGlide + en.transitionTempoGlideDescription,
      en.transitionTempoMatch + en.transitionTempoMatchDescription,
      en.transitionTempoKeep + en.transitionTempoKeepDescription,
    ]);
    expect(radios('transition-tempo').filter((r) => r.checked)).toEqual([tempoRadio('jump')]);
    expect(container!.querySelector('[data-transition-glide]')).toBeNull();
    expect(container!.querySelectorAll('[data-transition-settings] input[type=checkbox]')).toHaveLength(1); // Match loudness
  });

  it('Glide during is greyed out for Dip and Cut; the other three stay usable', () => {
    render();
    click(typeRadio('dip'));
    expect(tempoRadio('glide').disabled).toBe(true);
    expect(enabledTempos()).toEqual(['jump', 'match', 'keep']);
    click(typeRadio('cut'));
    expect(tempoRadio('glide').disabled).toBe(true);
    expect(enabledTempos()).toEqual(['jump', 'match', 'keep']);
    click(typeRadio('crossfade'));
    expect(enabledTempos()).toEqual(['jump', 'glide', 'match', 'keep']);
  });

  it('a stored Glide during stays selected (greyed out) when the type becomes Cut', () => {
    act(() => setTransitionSettings({ type: 'crossfade', tempo: 'glide' }));
    render();
    click(typeRadio('cut'));
    expect(tempoRadio('glide').checked).toBe(true);
    expect(tempoRadio('glide').disabled).toBe(true);
    expect(getTransitionSettings().tempo).toBe('glide');
  });

  it('the choice persists through the settings store, with Cut too', () => {
    act(() => setTransitionSettings({ type: 'cut' }));
    render();
    click(tempoRadio('match'));
    expect(localStorage.getItem('strudel-settingstransitionTempo')).toBe('match');
    expect(getTransitionSettings().tempo).toBe('match');
    expect(tempoRadio('match').checked).toBe(true);
    click(tempoRadio('keep'));
    expect(parseTransitionSettings(settingsMap.get()).tempo).toBe('keep');
    expect(localStorage.getItem('strudel-settingstransitionGlide')).toBeNull(); // the legacy key is never written
  });

  it('review 027 finding 3: Glide during is greyed out for Echo-out; the other three stay usable', () => {
    render();
    click(typeRadio('echoOut'));
    expect(tempoRadio('glide').disabled).toBe(true);
    expect(enabledTempos()).toEqual(['jump', 'match', 'keep']);
  });

  it('negative (finding 3): Glide during stays usable for Crossfade', () => {
    render();
    click(typeRadio('crossfade'));
    expect(tempoRadio('glide').disabled).toBe(false);
  });

  it('review 027 finding 2: under Off the options are dimmed once (by the fieldset), not per option too', () => {
    render(); // Off
    const fieldset = q('[data-transition-tempo]')!.closest('fieldset')!;
    expect(fieldset.className).toMatch(/(^|\s)opacity-40(\s|$)/);
    expect(radios('transition-tempo').every((r) => r.disabled)).toBe(true); // still not choosable
    for (const r of radios('transition-tempo')) expect(r.closest('label')!.className).not.toMatch(/!opacity-40/);
  });

  it('review 027 finding 2: under Dip only Glide during is dimmed per option', () => {
    render();
    click(typeRadio('dip'));
    expect(q('[data-transition-tempo]')!.closest('fieldset')!.className).not.toMatch(/(^|\s)opacity-40(\s|$)/);
    expect(tempoLabel('glide').className).toMatch(/!opacity-40/);
    for (const tempo of ['jump', 'match', 'keep']) expect(tempoLabel(tempo).className).not.toMatch(/!opacity-40/);
  });

  it('negative: clicking the greyed-out Glide during under Dip changes nothing', () => {
    act(() => setTransitionSettings({ type: 'dip', tempo: 'keep' }));
    render();
    click(tempoRadio('glide'));
    expect(getTransitionSettings().tempo).toBe('keep');
  });
});

describe('compact layout (spec 016 rules)', () => {
  it('at 390x844 every Snap and Tempo option is a 44px target, and the groups wrap instead of overflowing', () => {
    setViewport(390, 844);
    act(() => setTransitionSettings({ type: 'crossfade' }));
    render();
    const labels = [...radios('transition-snap'), ...radios('transition-tempo')].map((r) => r.closest('label')!);
    expect(labels).toHaveLength(9);
    for (const label of labels) expect(label.className).toMatch(/\bmin-h-11\b/);
    // Narrow first: 3 snap columns and 1 tempo column below `sm`; a label may shrink (min-w-0).
    expect(q('[data-transition-snap] [role=radiogroup]')!.className).toMatch(/\bgrid-cols-3\b.*\bsm:grid-cols-5\b/);
    expect(q('[data-transition-tempo] [role=radiogroup]')!.className).toMatch(/\bgrid-cols-1\b.*\bsm:grid-cols-2\b/);
    for (const label of labels) expect(label.className).toMatch(/\bmin-w-0\b/);
  });

  it('on a laptop the options keep the desktop size', () => {
    setViewport(1440, 900);
    render();
    for (const r of radios('transition-tempo')) expect(r.closest('label')!.className).not.toMatch(/\bmin-h-11\b/);
  });
});

describe('spec 027 §2.1: Snap to in the compact layout', () => {
  it('at 390x844 it shows its 5 choices, including 16 cycles, and the description about the track’s start', () => {
    setViewport(390, 844);
    act(() => setTransitionSettings({ type: 'crossfade' }));
    render();
    const snaps = radios('transition-snap');
    expect(snaps.map((r) => r.closest('label')!.textContent)).toEqual([
      en.transitionSnapOff,
      en.transitionSnapNext1,
      en.transitionSnapNext4,
      en.transitionSnapNext8,
      en.transitionSnapNext16,
    ]);
    expect(en.transitionSnapNext16).toMatch(/16/);
    expect(q('[data-transition-snap-description]')!.textContent).toBe(en.transitionSnapDescription);
    expect(snapFieldset().disabled).toBe(false);
    click(snaps[4]);
    expect(getTransitionSettings().snap).toBe(16);
  });

  it('negative: at 390x844 with Off the 5 choices are greyed out and choosing 16 stores nothing', () => {
    setViewport(390, 844);
    render();
    expect(radios('transition-snap')).toHaveLength(5);
    expect(snapFieldset().disabled).toBe(true);
    click(radios('transition-snap')[4]);
    expect(getTransitionSettings().snap).toBe(0);
  });
});

describe('spec 027 §2.2: a Tempo glide saved before this change, when the user opens the settings', () => {
  const PREFIX = 'strudel-settings';
  /** What settings.ts runs at start-up, before the store mounts, over this browser’s storage. */
  function startUpWith(stored: Record<string, string>) {
    localStorage.removeItem(`${PREFIX}transitionTempo`);
    for (const [key, value] of Object.entries(stored)) localStorage.setItem(`${PREFIX}${key}`, value);
    migrateLegacyTempoGlide({
      storage: localStorage,
      settingsPrefix: PREFIX,
      setKey: (key, value) => settingsMap.setKey(key as 'transitionTempo', value as never),
    });
  }
  afterEach(() => localStorage.removeItem(`${PREFIX}transitionGlide`));

  it('saved on: Tempo shows Glide during, and it is stored as the Tempo choice', () => {
    act(() => setTransitionSettings({ type: 'crossfade' }));
    startUpWith({ transitionGlide: 'true' });
    render();
    expect(radios('transition-tempo').filter((r) => r.checked)).toEqual([tempoRadio('glide')]);
    expect(localStorage.getItem(`${PREFIX}transitionTempo`)).toBe('glide');
  });

  it('saved off: Tempo shows Jump', () => {
    act(() => setTransitionSettings({ type: 'crossfade', tempo: 'match' }));
    startUpWith({ transitionGlide: 'false' });
    render();
    expect(radios('transition-tempo').filter((r) => r.checked)).toEqual([tempoRadio('jump')]);
  });

  it('negative: a Tempo choice already stored is never overwritten by the old checkbox', () => {
    act(() => setTransitionSettings({ type: 'crossfade', tempo: 'keep' }));
    localStorage.setItem(`${PREFIX}transitionGlide`, 'true');
    migrateLegacyTempoGlide({
      storage: localStorage,
      settingsPrefix: PREFIX,
      setKey: (key, value) => settingsMap.setKey(key as 'transitionTempo', value as never),
    });
    render();
    expect(radios('transition-tempo').filter((r) => r.checked)).toEqual([tempoRadio('keep')]);
  });

  it('settings.ts runs that migration at start-up over localStorage and the settings store', () => {
    const flat = (code: string) =>
      code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\s+/g, ' ');
    const call =
      /migrateLegacyTempoGlide\(\{ storage: localStorage, settingsPrefix: settings_key, setKey: \(key, value\) => settingsMap\.setKey\(key, value\), \}\)/;
    expect(flat(readFileSync(resolve(process.cwd(), 'website/src/settings.ts'), 'utf8'))).toMatch(call);
    // negative: a start-up without it is caught
    expect(
      flat('migrateLegacySmoothTransitions({ storage: localStorage, settingsPrefix: settings_key, });'),
    ).not.toMatch(call);
  });
});
