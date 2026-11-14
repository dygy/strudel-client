// @vitest-environment jsdom
/**
 * @spec: 028-eq-named-presets (functional §2, acceptance criteria 1–4 and 6)
 * The AC pairs not already in EqualizerUserPresets028.test: the EQ on/off restored exactly, a
 * cancelled Save as stores nothing; Rename / Overwrite / Delete survive a remount, and their cancel
 * paths change nothing; a 41-character name and the 51st preset are refused with a message; damaged
 * stored entries are skipped in the picker; and the controls render in each of the 9 languages.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage`, which shadows jsdom's (see EqualizerCompact.test).
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@src/i18n/i18n';
import { settingsMap } from '@src/settings';
import {
  AudioEqualizer,
  EQUALIZER_PRESETS,
  USER_PRESETS_STORAGE_KEY,
  USER_PRESET_LIMIT,
  getDefaultSettings,
  loadUserPresets,
  saveUserPreset,
} from '@strudel/equalizer';
import { MockAudioContext } from '../../../../../../packages/mixer/test/webAudioMock.mjs';
import { destroyMainEqualizer, getMainEqualizer, initMainEqualizer } from '../../../mainEqualizer';
import { resetPlayingEqProfile } from '../../../playingEqProfile';
import { EqualizerUI } from '../EqualizerUI';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PHONK = EQUALIZER_PRESETS.phonk;
const LOCALES = ['ar', 'en', 'es', 'fr', 'he', 'ko', 'ru', 'sr', 'zh'] as const;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let ac: any;
let preview: AudioEqualizer;

const q = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);
const main = () => getMainEqualizer()!;
const heard = (eq: AudioEqualizer) => (eq as any).bands.map((b: any) => b.filter.gain.value);
const picker = () => q<HTMLSelectElement>('select')!;
const userOptions = () =>
  [...container!.querySelectorAll<HTMLOptionElement>('optgroup[data-eq-group="user"] option')].map(
    (o) => o.textContent,
  );
const names = () => loadUserPresets().map((p) => p.name);
const strings = async (locale: string): Promise<Record<string, string>> =>
  (await import(`../../../../i18n/locales/${locale}/settings.json`)).default;

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
/** A page reload, as far as the panel is concerned: unmount, then mount from storage again. */
function reload() {
  unmount();
  render();
}
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
function rename(to: string) {
  click(q('[data-eq-user-rename]')!);
  type(q<HTMLInputElement>('[data-eq-user-name]')!, to);
  click(q('[data-eq-user-submit]')!);
}
const toggleOnOff = () => act(() => q<HTMLButtonElement>('button')!.click()); // the header's on/off

beforeEach(async () => {
  await i18n.changeLanguage('en');
  if (settingsMap.get().language !== 'en') settingsMap.setKey('language', 'en');
  await i18n.loadNamespaces(['settings', 'common']);
  localStorage.clear();
  resetPlayingEqProfile();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 900 });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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
  await i18n.changeLanguage('en');
  if (settingsMap.get().language !== 'en') settingsMap.setKey('language', 'en');
});

describe('AC 1: save as "Phonk car", reload, pick it: exactly those settings', () => {
  it('positive: the EQ on/off is part of the preset (saved off, picked while on: off again)', () => {
    render();
    choose('phonk');
    toggleOnOff();
    expect(main().getState().isEnabled).toBe(false);
    saveAs('Phonk car');
    toggleOnOff();
    choose('flat');
    expect(main().getState().isEnabled).toBe(true);

    reload();
    choose('user:Phonk car');
    for (const eq of [main(), preview]) {
      expect(eq.getState().isEnabled).toBe(false);
      expect(eq.getState().bands.map((b) => b.gain)).toEqual(PHONK.gains);
      expect(eq.getState().outputGain).toBe(PHONK.outputGain);
    }
  });

  it('negative: a cancelled Save as stores nothing and no My presets group appears after a reload', () => {
    render();
    choose('phonk');
    click(q('[data-eq-user-save-as]')!);
    type(q<HTMLInputElement>('[data-eq-user-name]')!, 'Phonk car');
    click(q('[data-eq-user-cancel]')!);
    expect(q('[data-eq-user-form]')).toBeNull();
    expect(localStorage.getItem(USER_PRESETS_STORAGE_KEY)).toBeNull();
    reload();
    expect(q('optgroup[data-eq-group="user"]')).toBeNull();
    expect(picker().value).toBe('phonk');
  });
});

describe('AC 2: rename, overwrite and delete show in the picker and survive a reload', () => {
  it('positive: a rename survives a reload, with the settings kept', () => {
    render();
    choose('phonk');
    saveAs('Old');
    rename('New');
    reload();
    expect(userOptions()).toEqual(['New']);
    expect(names()).toEqual(['New']);
    choose('flat');
    choose('user:New');
    expect(heard(main())).toEqual(PHONK.gains);
  });

  it('positive: an overwrite survives a reload', () => {
    render();
    saveAs('Mine'); // flat
    choose('phonk');
    choose('user:Mine');
    act(() => {
      const range = container!.querySelector<HTMLInputElement>('input[type="range"]')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(range, '6');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(q('[data-eq-user-overwrite]')!);
    reload();
    expect(userOptions()).toEqual(['Mine']);
    choose('flat');
    choose('user:Mine');
    expect(heard(main())[0]).toBe(6);
  });

  it('positive: a delete survives a reload', () => {
    render();
    saveAs('Keep');
    saveAs('Gone');
    click(q('[data-eq-user-delete]')!);
    click(q('[data-eq-user-delete-yes]')!);
    reload();
    expect(userOptions()).toEqual(['Keep']);
  });

  it('negative: Delete then Cancel keeps the preset, through a reload, and no browser dialog opens', () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    render();
    saveAs('Stay');
    click(q('[data-eq-user-delete]')!);
    expect(q('[data-eq-user-confirm-delete]')).not.toBeNull();
    // Asking is not deleting.
    expect(names()).toEqual(['Stay']);
    click(q('[data-eq-user-cancel]')!);
    expect(q('[data-eq-user-confirm-delete]')).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
    reload();
    expect(userOptions()).toEqual(['Stay']);
  });

  it('negative: a rename cancelled with Escape keeps the old name, through a reload', () => {
    render();
    saveAs('Old');
    click(q('[data-eq-user-rename]')!);
    const input = q<HTMLInputElement>('[data-eq-user-name]')!;
    type(input, 'New');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(q('[data-eq-user-form]')).toBeNull();
    reload();
    expect(userOptions()).toEqual(['Old']);
  });
});

describe('AC 3: a duplicate asks; an empty or 41-character name, or the 51st preset, is refused', () => {
  it('positive: a 40-character name is accepted', () => {
    render();
    saveAs('x'.repeat(40));
    expect(q('[data-eq-user-error]')).toBeNull();
    expect(userOptions()).toEqual(['x'.repeat(40)]);
  });

  it('negative: a 41-character name is refused with a message and nothing is stored', () => {
    render();
    saveAs('x'.repeat(41));
    const error = q('[data-eq-user-error="invalid"]');
    expect(error!.textContent).toContain('Type a name of 1 to 40 characters.');
    expect(localStorage.getItem(USER_PRESETS_STORAGE_KEY)).toBeNull();
    expect(q('optgroup[data-eq-group="user"]')).toBeNull();
  });

  it('negative: a duplicate name, then Cancel instead of Overwrite, keeps the old settings', () => {
    render();
    saveAs('Mine'); // flat
    choose('phonk');
    saveAs('Mine');
    expect(q('[data-eq-user-error="taken"]')!.textContent).toContain('already exists');
    click(q('[data-eq-user-cancel]')!);
    expect(loadUserPresets()[0].settings.bands.map((b) => b.gain)).toEqual(Array(10).fill(0));
  });

  it('positive: at 49 presets, the 50th is still saved', () => {
    for (let i = 0; i < USER_PRESET_LIMIT - 1; i++) saveUserPreset(`P${i}`, getDefaultSettings());
    render();
    saveAs('Fiftieth');
    expect(q('[data-eq-user-error]')).toBeNull();
    expect(userOptions()).toHaveLength(USER_PRESET_LIMIT);
  });

  it('negative: the 51st preset is refused with a message, and the 50 stay', () => {
    for (let i = 0; i < USER_PRESET_LIMIT; i++) saveUserPreset(`P${i}`, getDefaultSettings());
    render();
    saveAs('One too many');
    expect(q('[data-eq-user-error="full"]')!.textContent).toContain('You have 50 presets');
    expect(userOptions()).toHaveLength(USER_PRESET_LIMIT);
    expect(userOptions()).not.toContain('One too many');
    expect(names()).not.toContain('One too many');
  });
});

describe('AC 4: a damaged stored entry is skipped, the valid ones still load', () => {
  it('positive: the valid entries show under My presets and apply', () => {
    const good = { ...getDefaultSettings(), bands: getDefaultSettings().bands.map((b) => ({ ...b, gain: 3 })) };
    localStorage.setItem(
      USER_PRESETS_STORAGE_KEY,
      JSON.stringify([
        { name: 'Broken', settings: { ...good, bands: 'nope' } },
        42,
        { name: 'Good', settings: good },
        { name: '   ', settings: good },
        { name: 'Also good', settings: getDefaultSettings() },
      ]),
    );
    render();
    expect(userOptions()).toEqual(['Also good', 'Good']);
    choose('user:Good');
    expect(heard(main())).toEqual(Array(10).fill(3));
  });

  it('negative: only damaged entries (or unreadable storage) give no My presets group, and the panel still works', () => {
    localStorage.setItem(USER_PRESETS_STORAGE_KEY, '{not json');
    render();
    expect(q('optgroup[data-eq-group="user"]')).toBeNull();
    unmount();
    localStorage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify([{ name: 'Broken' }, null]));
    render();
    expect(q('optgroup[data-eq-group="user"]')).toBeNull();
    choose('phonk');
    expect(heard(main())).toEqual(PHONK.gains);
  });
});

describe('AC 6: the new controls show in each of the 9 languages', () => {
  /** Every spec 028 label the panel shows once a preset is saved and its delete is being asked. */
  async function renderedLabels() {
    saveUserPreset('Phonk car', getDefaultSettings());
    render();
    choose('user:Phonk car');
    const shown = {
      equalizerMyPresets: q('optgroup[data-eq-group="user"]')!.getAttribute('label'),
      equalizerSaveAs: q('[data-eq-user-save-as]')!.textContent,
      equalizerRename: q('[data-eq-user-rename]')!.textContent,
      equalizerOverwrite: q('[data-eq-user-overwrite]')!.textContent,
      equalizerDelete: q('[data-eq-user-delete]')!.textContent,
    } as Record<string, string | null>;
    click(q('[data-eq-user-save-as]')!);
    shown.equalizerPresetName = q<HTMLInputElement>('[data-eq-user-name]')!.placeholder;
    click(q('[data-eq-user-submit]')!);
    shown.equalizerNameInvalid = q('[data-eq-user-error="invalid"] span')!.textContent;
    type(q<HTMLInputElement>('[data-eq-user-name]')!, 'phonk CAR');
    click(q('[data-eq-user-submit]')!);
    shown.equalizerNameTaken = q('[data-eq-user-error="taken"] span')!.textContent;
    click(q('[data-eq-user-cancel]')!);
    click(q('[data-eq-user-delete]')!);
    shown.equalizerDeleteConfirm = q('[data-eq-user-confirm-delete] span')!.textContent;
    return shown;
  }

  it.each(LOCALES)('%s: every label shows in that language', async (locale) => {
    await i18n.changeLanguage(locale);
    await i18n.loadNamespaces(['settings', 'common']);
    const own = await strings(locale);
    const shown = await renderedLabels();
    for (const [key, text] of Object.entries(shown)) {
      const expected = key === 'equalizerDeleteConfirm' ? own[key].replace('{{name}}', 'Phonk car') : own[key];
      expect(text, `${locale}.${key}`).toBe(expected);
    }
  });

  it.each(LOCALES.filter((l) => l !== 'en'))(
    'negative pair: %s shows no English label and no raw key',
    async (locale) => {
      await i18n.changeLanguage(locale);
      await i18n.loadNamespaces(['settings', 'common']);
      const en = await strings('en');
      const shown = await renderedLabels();
      for (const [key, text] of Object.entries(shown)) {
        expect(text, `${locale}.${key}`).not.toBe(en[key].replace('{{name}}', 'Phonk car'));
        expect(text, `${locale}.${key}`).not.toBe(key);
      }
    },
  );
});
