// @vitest-environment jsdom
/**
 * @spec: 028-eq-named-presets (functional §2; tech: panel)
 * The panel's named presets: Save as puts the active slot's settings under My presets (first group),
 * picking one glides both EQs into the active slot only, a taken name asks before overwriting, Rename
 * and Overwrite, and Delete asks inside the panel (no browser dialog). Survives a remount.
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
import {
  AudioEqualizer,
  EQUALIZER_PRESETS,
  EQ_SLOTS_STORAGE_KEY,
  USER_PRESETS_STORAGE_KEY,
  loadUserPresets,
} from '@strudel/equalizer';
import { MockAudioContext } from '../../../../../../packages/mixer/test/webAudioMock.mjs';
import { destroyMainEqualizer, getMainEqualizer, initMainEqualizer } from '../../../mainEqualizer';
import { resetPlayingEqProfile } from '../../../playingEqProfile';
import { EqualizerUI } from '../EqualizerUI';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PHONK = EQUALIZER_PRESETS.phonk;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let ac: any;
let preview: AudioEqualizer;

const q = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);
const main = () => getMainEqualizer()!;
const heard = (eq: AudioEqualizer) => (eq as any).bands.map((b: any) => b.filter.gain.value);
const picker = () => q<HTMLSelectElement>('select')!;
const slotButton = (slot: 'A' | 'B') => q<HTMLButtonElement>(`[data-eq-slot="${slot}"]`)!;
const savedSlots = () => JSON.parse(localStorage.getItem(EQ_SLOTS_STORAGE_KEY)!);
const userOptions = () =>
  [...container!.querySelectorAll<HTMLOptionElement>('optgroup[data-eq-group="user"] option')].map(
    (o) => o.textContent,
  );

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
const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};
const click = (el: HTMLElement) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const choose = (value: string) =>
  act(() => {
    picker().value = value;
    picker().dispatchEvent(new Event('change', { bubbles: true }));
  });
function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function saveAs(name: string) {
  click(q('[data-eq-user-save-as]')!);
  type(q<HTMLInputElement>('[data-eq-user-name]')!, name);
  click(q('[data-eq-user-submit]')!);
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings', 'common']);
  localStorage.clear();
  resetPlayingEqProfile();
  setViewport(1440, 900);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  ac = new MockAudioContext();
  initMainEqualizer(ac as unknown as AudioContext, { setOutputInsert: vi.fn() });
  preview = new AudioEqualizer(ac as unknown as AudioContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  unmount();
  destroyMainEqualizer();
  resetPlayingEqProfile();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('spec 028 named presets in the panel', () => {
  it('Save as puts the settings under My presets, first; after a remount picking it restores them', () => {
    render();
    choose('phonk');
    saveAs('  Phonk car ');
    expect(userOptions()).toEqual(['Phonk car']);
    expect(picker().querySelector('optgroup')!.getAttribute('data-eq-group')).toBe('user');
    expect(picker().value).toBe('user:Phonk car');

    choose('flat');
    expect(heard(main())).toEqual(Array(10).fill(0));
    unmount();
    render();
    expect(userOptions()).toEqual(['Phonk car']);
    choose('user:Phonk car');
    for (const eq of [main(), preview]) {
      expect(heard(eq)).toEqual(PHONK.gains);
      expect(eq.getState().highCut).toEqual({ enabled: true, frequency: PHONK.highCut });
      expect(eq.getState().outputGain).toBe(PHONK.outputGain);
    }
    unmount();
    render();
    expect(picker().value).toBe('user:Phonk car');
  });

  it('picking a user preset glides (setTargetAtTime only) and goes into the active slot only', () => {
    render();
    choose('phonk');
    saveAs('Mine');
    choose('flat');
    click(slotButton('B'));
    const params = (eq: any) => [...eq.bands.map((b: any) => b.filter.gain), eq.outputGainNode.gain];
    const before = params(main()).map((p: any) => p.calls.length);
    choose('user:Mine');
    const added = params(main()).flatMap((p: any, i: number) => p.calls.slice(before[i]));
    expect(added.length).toBeGreaterThan(0);
    expect(added.filter((c: any[]) => c[0] !== 'setTargetAtTime')).toEqual([]);
    const slots = savedSlots();
    expect(slots.B.preset).toBe('user:Mine');
    expect(slots.A.preset).toBe('flat');
  });

  it('an empty name is refused; a taken name asks before overwriting', () => {
    render();
    saveAs('   ');
    expect(q('[data-eq-user-error="invalid"]')).not.toBeNull();
    click(q('[data-eq-user-cancel]')!);

    saveAs('Mine');
    choose('phonk');
    saveAs('mine');
    expect(q('[data-eq-user-error="taken"]')).not.toBeNull();
    expect(loadUserPresets()[0].settings.bands[0].gain).toBe(0);
    click(q('[data-eq-user-confirm-overwrite]')!);
    expect(loadUserPresets().map((p) => p.name)).toEqual(['mine']);
    expect(loadUserPresets()[0].settings.bands[0].gain).toBe(PHONK.gains[0]);
  });

  it('Rename and Overwrite act on the last picked preset', () => {
    render();
    saveAs('Old');
    click(q('[data-eq-user-rename]')!);
    type(q<HTMLInputElement>('[data-eq-user-name]')!, 'New');
    click(q('[data-eq-user-submit]')!);
    expect(userOptions()).toEqual(['New']);
    expect(picker().value).toBe('user:New');

    choose('phonk');
    choose('user:New');
    act(() => {
      const range = container!.querySelector<HTMLInputElement>('input[type="range"]')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(range, '6');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(picker().value).toBe('custom');
    click(q('[data-eq-user-overwrite]')!);
    expect(loadUserPresets()[0].settings.bands[0].gain).toBe(6);
    expect(picker().value).toBe('user:New');
  });

  it('review: renaming while the slot is edited (Custom) only renames; the slot stays Custom, no settings written', () => {
    render();
    choose('phonk');
    saveAs('Phonk car');
    act(() => {
      const range = container!.querySelector<HTMLInputElement>('input[type="range"]')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(range, '3');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(picker().value).toBe('custom');
    const slotBefore = savedSlots().A;

    click(q('[data-eq-user-rename]')!);
    type(q<HTMLInputElement>('[data-eq-user-name]')!, 'Car');
    click(q('[data-eq-user-submit]')!);
    expect(userOptions()).toEqual(['Car']);
    expect(picker().value).toBe('custom');
    expect(savedSlots().A).toEqual(slotBefore);
    expect(savedSlots().A.preset).toBe('custom');
    // The stored preset keeps what it held, not the edit.
    expect(loadUserPresets()[0].settings.bands[0].gain).toBe(PHONK.gains[0]);
    unmount();
    render();
    expect(picker().value).toBe('custom');
  });

  it('review: renaming the preset the slot shows relabels the slot only (same settings)', () => {
    render();
    choose('phonk');
    saveAs('Phonk car');
    const bandsBefore = savedSlots().A.bands;
    click(q('[data-eq-user-rename]')!);
    type(q<HTMLInputElement>('[data-eq-user-name]')!, 'Car');
    click(q('[data-eq-user-submit]')!);
    expect(picker().value).toBe('user:Car');
    expect(savedSlots().A.preset).toBe('user:Car');
    expect(savedSlots().A.bands).toEqual(bandsBefore);
  });

  it('review: renaming a preset deleted in another tab says so and refreshes the list', () => {
    render();
    saveAs('Gone elsewhere');
    saveAs('Kept');
    choose('user:Gone elsewhere');
    // Another tab deletes it.
    const stored = JSON.parse(localStorage.getItem(USER_PRESETS_STORAGE_KEY)!);
    localStorage.setItem(
      USER_PRESETS_STORAGE_KEY,
      JSON.stringify(stored.filter((p: { name: string }) => p.name !== 'Gone elsewhere')),
    );
    click(q('[data-eq-user-rename]')!);
    type(q<HTMLInputElement>('[data-eq-user-name]')!, 'New name');
    click(q('[data-eq-user-submit]')!);
    expect(q('[data-eq-user-error="missing"]')!.textContent).toBe(
      'This preset no longer exists (it may have been deleted in another tab). The list is refreshed.',
    );
    expect(userOptions()).toEqual(['Kept']);
    expect(picker().value).toBe('custom');
    expect(q('[data-eq-user-rename]')).toBeNull();
  });

  it('Delete asks inside the panel, never with a browser dialog', () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    render();
    saveAs('Gone');
    click(q('[data-eq-user-delete]')!);
    expect(userOptions()).toEqual(['Gone']);
    expect(q('[data-eq-user-confirm-delete]')!.textContent).toContain('Delete the preset "Gone"?');
    click(q('[data-eq-user-delete-yes]')!);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(userOptions()).toEqual([]);
    expect(loadUserPresets()).toEqual([]);
    expect(picker().value).toBe('custom');
  });

  it('works on a phone (compact): the same controls, with 44px touch targets', () => {
    setViewport(390, 844);
    render();
    choose('phonk');
    saveAs('Phone');
    expect(userOptions()).toEqual(['Phone']);
    expect(q('[data-eq-user-save-as]')!.className).toContain('min-h-11');
    expect(q('[data-eq-user-delete]')!.className).toContain('min-h-11');
  });
});
