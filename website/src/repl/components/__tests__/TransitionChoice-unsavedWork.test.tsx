// @vitest-environment jsdom
/**
 * Spec 017 §2.6 "Unsaved work is not affected": choosing a transition type (picker next to
 * Update, or Mixer Settings) never changes or saves a track's code. The editor holds unsaved
 * changes; after every type is picked in both places, the editor content, its unsaved state
 * (globalSaveManager), every save path and every non-transition setting are as they were.
 *
 * @spec: 017-track-transition-types
 * @regression
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setActiveFooter, setTransitionSettings, settingsMap } from '@src/settings';
import { DEFAULT_TRANSITION, TRANSITION_SETTING_KEYS, TRANSITION_TYPE_OPTIONS } from '@src/repl/transitionSettings';
import { globalSaveManager } from '@src/repl/globalSaveManager';
import { TransitionPicker } from '../TransitionPicker';
import { TransitionSettingsSection } from '../panel/TransitionSettingsSection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAVED = 's("bd sd")';
const EDITED = 's("bd sd hh")'; // typed but not saved

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let fileManager: {
  tracks: Record<string, { id: string; name: string; code: string }>;
  saveCurrentTrack: any;
  saveSpecificTrack: any;
};
let editor: { code: string; setCode: any; evaluate: any };

/** Every setting except the transition ones, and every stored key's value. */
const nonTransitionSettings = () => {
  const all = { ...settingsMap.get() } as Record<string, unknown>;
  for (const key of TRANSITION_SETTING_KEYS) delete all[key];
  return JSON.stringify(all);
};
const storageWithoutTransitions = () =>
  JSON.stringify(
    Object.keys(localStorage)
      .filter((key) => !TRANSITION_SETTING_KEYS.some((t) => key.endsWith(t)))
      .sort()
      .map((key) => [key, localStorage.getItem(key)]),
  );

beforeEach(() => {
  setTransitionSettings({ ...DEFAULT_TRANSITION });
  window.history.pushState({}, '', '/repl/track-1');
  fileManager = {
    tracks: { 'track-1': { id: 'track-1', name: 'Track 1', code: SAVED } },
    saveCurrentTrack: vi.fn(),
    saveSpecificTrack: vi.fn(),
  };
  editor = { code: EDITED, setCode: vi.fn(), evaluate: vi.fn() };
  globalSaveManager.register(fileManager, { editorRef: { current: editor }, activeCode: EDITED });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <>
        <TransitionPicker />
        <TransitionSettingsSection />
      </>,
    ),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  globalSaveManager.unregister();
  setTransitionSettings({ ...DEFAULT_TRANSITION });
  window.history.pushState({}, '', '/');
});

function pickInPicker(type: string) {
  const select = container!.querySelector<HTMLSelectElement>('[data-transition-picker] select')!;
  act(() => {
    select.value = type;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function pickInSettings(type: string) {
  const input = container!.querySelector(`[data-transition-type="${type}"]`)!.closest('label')!.querySelector('input')!;
  act(() => input.click());
}

describe('spec 017 §2.6: changing the transition type leaves unsaved work alone', () => {
  it('every type, picked in the picker and in Mixer Settings: same code, still unsaved, nothing saved', () => {
    expect(globalSaveManager.hasUnsavedChanges()).toBe(true);
    const settingsBefore = nonTransitionSettings();
    const storageBefore = storageWithoutTransitions();

    for (const type of TRANSITION_TYPE_OPTIONS) {
      pickInPicker(type);
      pickInSettings(type === 'off' ? 'crossfade' : 'off');
      pickInSettings(type);
    }

    // the choice itself did take effect
    expect(settingsMap.get().transitionType).toBe(TRANSITION_TYPE_OPTIONS.at(-1));
    // the editor and its unsaved state are untouched
    expect(editor.code).toBe(EDITED);
    expect(editor.setCode).not.toHaveBeenCalled();
    expect(editor.evaluate).not.toHaveBeenCalled();
    expect(globalSaveManager.hasUnsavedChanges()).toBe(true);
    expect(fileManager.tracks['track-1'].code).toBe(SAVED);
    expect(fileManager.saveCurrentTrack).not.toHaveBeenCalled();
    expect(fileManager.saveSpecificTrack).not.toHaveBeenCalled();
    // only the transition settings changed: no other setting (userPatterns, ...) and no other stored key
    expect(nonTransitionSettings()).toBe(settingsBefore);
    expect(storageWithoutTransitions()).toBe(storageBefore);
  });

  it('negative: a write to any other setting is caught by the same check', () => {
    const settingsBefore = nonTransitionSettings();
    const storageBefore = storageWithoutTransitions();
    const footer = settingsMap.get().activeFooter;
    setActiveFooter(footer === 'settings' ? 'patterns' : 'settings');
    try {
      expect(nonTransitionSettings()).not.toBe(settingsBefore);
      expect(storageWithoutTransitions()).not.toBe(storageBefore);
    } finally {
      setActiveFooter(footer);
    }
  });
});
