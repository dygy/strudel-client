// @vitest-environment jsdom
/**
 * @spec: 022-set-playlist (2.2 building a set, 2.3 compact layout and the next key, 2.6 who sees sets; tech §2.5)
 * The library's "Add to set": in a track's and a multitrack step's menu, with the right target,
 * and absent in the read-only (admin) view, signed out and outside the REPL. The chooser shown
 * when no set is open (pick a set, or a new one). The set bar's Cue/Go button in the compact
 * control bar, and the Alt+Shift+N row in the Shortcuts tab.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage`, which shadows jsdom's; settings.ts reads it at
// import time, so point it at jsdom's before imports.
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@src/i18n/i18n';
import { FileTree } from '../sidebar/FileTree';
import { AddToSetChooser } from '../set/AddToSetChooser';
import { CompactControlBar } from '../compact/CompactControlBar';
import { ShortcutsTab } from '../panel/ShortcutsTab';
import { SetPlayerContext, type SetPlayerContextValue } from '../../sets/useSetPlayer';
import { NO_SET } from '../../sets/setPlayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// FileTree suspends until these have loaded, and whether they have depends on which file ran before.
beforeAll(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['files', 'common', 'settings', 'tabs', 'shortcuts']);
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  document.body.innerHTML = '';
});

function context(over: Partial<SetPlayerContextValue> = {}): SetPlayerContextValue {
  return {
    enabled: true,
    signedIn: true,
    sets: [
      { id: 's1', name: 'Friday', version: 'v1', items: [{ id: 'a', trackId: 'plain', transition: null }] },
      { id: 's2', name: 'Saturday', version: 'v1', items: [] },
    ],
    loaded: true,
    loadFailed: false,
    tracks: { plain: { id: 'plain', name: 'Groove' } },
    openSetId: null,
    setOpenSetId: vi.fn(),
    player: NO_SET,
    buttonMode: 'cue',
    endOfSet: false,
    createSet: vi.fn(async () => ({ ok: false as const, error: 'failed' as const })),
    renameSet: vi.fn(async () => 'ok' as const),
    deleteSet: vi.fn(async () => true),
    addItem: vi.fn(),
    moveItem: vi.fn(),
    removeItem: vi.fn(),
    setItemTransition: vi.fn(),
    playSet: vi.fn(),
    endSet: vi.fn(),
    press: vi.fn(),
    selectItem: vi.fn(),
    requestAddToSet: vi.fn(),
    chooserTarget: null,
    closeChooser: vi.fn(),
    ...over,
  };
}

function render(ui: React.ReactElement, value: SetPlayerContextValue | null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<SetPlayerContext.Provider value={value}>{ui}</SetPlayerContext.Provider>));
  return container;
}

// ---------------------------------------------------------------- FileTree "Add to set"

const noop = () => {};
const libraryTracks = {
  plain: { id: 'plain', name: 'Groove', code: '', created: '', modified: '', folder: '', isMultitrack: false },
  multi: {
    id: 'multi',
    name: 'Big',
    code: '',
    created: '',
    modified: '',
    folder: '',
    isMultitrack: true,
    activeStep: 0,
    steps: [
      { id: 'st1', name: 'Intro', code: '', created: '', modified: '' },
      { id: 'st2', name: 'Drop', code: '', created: '', modified: '' },
    ],
  },
} as any;

const treeProps = (readOnly = false) =>
  ({
    tracks: libraryTracks,
    folders: {},
    selectedTrack: null,
    activePattern: '',
    onTrackSelect: noop,
    onTrackInfo: noop,
    onTrackDownload: noop,
    onFolderDownload: noop,
    renamingTrack: null,
    renamingFolder: null,
    renameValue: '',
    setRenameValue: noop,
    onRenameFinish: noop,
    onRenameCancel: noop,
    emptySpaceContextItems: [],
    onSwitchStep: noop,
    renamingStep: null,
    onRenameStepFinish: noop,
    onRenameStepCancel: noop,
    readOnly,
  }) as any;

/** The innermost element whose text is exactly `text`. */
const byText = (text: string) =>
  [...container!.querySelectorAll('*')].find(
    (el) => el.textContent?.trim() === text && el.children.length === 0,
  ) as HTMLElement;

/** Right-clicks the row showing `text` and returns the labels of the menu that opens. */
function openMenu(text: string): string[] {
  act(() => {
    byText(text).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
  });
  return [...document.querySelectorAll<HTMLButtonElement>('div.fixed button')].map((b) => b.textContent!.trim());
}
const menuButton = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('div.fixed button')].find((b) => b.textContent?.trim() === label)!;

describe('the library: "Add to set" in the track menu', () => {
  it('is offered for a track and adds that track', () => {
    const value = context();
    render(<FileTree {...treeProps()} />, value);
    expect(openMenu('Groove')).toContain('Add to set');
    act(() => menuButton('Add to set').click());
    expect(value.requestAddToSet).toHaveBeenCalledTimes(1);
    expect(value.requestAddToSet).toHaveBeenCalledWith({ trackId: 'plain' });
  });

  it('negative: not in the read-only (admin) view', () => {
    render(<FileTree {...treeProps(true)} />, context());
    const labels = openMenu('Groove');
    expect(labels).toContain('Load');
    expect(labels).not.toContain('Add to set');
  });

  it('negative: not while sets are off (signed out), nor outside the REPL', () => {
    render(<FileTree {...treeProps()} />, context({ enabled: false, signedIn: false }));
    expect(openMenu('Groove')).not.toContain('Add to set');
    act(() => root!.unmount());
    document.body.innerHTML = '';
    render(<FileTree {...treeProps()} />, null);
    const labels = openMenu('Groove');
    expect(labels).toContain('Rename');
    expect(labels).not.toContain('Add to set');
  });
});

describe('the library: "Add to set" in a multitrack step menu', () => {
  const expandBig = () => act(() => byText('Big').click());

  it('is offered for a step and adds that step (by its index)', () => {
    const value = context();
    render(<FileTree {...treeProps()} />, value);
    expandBig();
    expect(openMenu('Drop')).toContain('Add to set');
    act(() => menuButton('Add to set').click());
    expect(value.requestAddToSet).toHaveBeenCalledWith({ trackId: 'multi', stepIndex: 1 });
  });

  it('negative: not in the read-only (admin) view', () => {
    render(<FileTree {...treeProps(true)} />, context());
    expandBig();
    const labels = openMenu('Drop');
    expect(labels).toContain('Load');
    expect(labels).not.toContain('Add to set');
  });

  it('negative: not while sets are off (signed out)', () => {
    render(<FileTree {...treeProps()} />, context({ enabled: false, signedIn: false }));
    expandBig();
    const labels = openMenu('Drop');
    expect(labels).toContain('Rename');
    expect(labels).not.toContain('Add to set');
  });
});

// ---------------------------------------------------------------- the chooser (no set open)

const chooserButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[data-set-chooser] button')];

describe('"Add to set" with no set open: the chooser', () => {
  it('lists the sets and "New set"; picking one adds the track there and opens that set', () => {
    const value = context({ chooserTarget: { trackId: 'multi', stepIndex: 1 } });
    render(<AddToSetChooser />, value);
    expect(chooserButtons().map((b) => b.textContent)).toEqual(['Friday', 'Saturday', 'New set']);
    act(() => document.querySelector<HTMLButtonElement>('[data-set-chooser-set="s2"]')!.click());
    expect(value.addItem).toHaveBeenCalledWith('s2', { trackId: 'multi', stepIndex: 1 });
    expect(value.setOpenSetId).toHaveBeenCalledWith('s2');
    expect(value.closeChooser).toHaveBeenCalled();
  });

  it('"New set" creates a set and adds the track to it', async () => {
    const created = { id: 's3', name: 'Set 1', version: 'v', items: [] };
    const value = context({
      chooserTarget: { trackId: 'plain' },
      createSet: vi.fn(async () => ({ ok: true as const, set: created })),
    });
    render(<AddToSetChooser />, value);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-set-chooser-new]')!.click());
    expect(value.createSet).toHaveBeenCalled();
    expect(value.addItem).toHaveBeenCalledWith('s3', { trackId: 'plain' });
    expect(value.setOpenSetId).toHaveBeenCalledWith('s3');
  });

  it('negative: a failed "New set" says so and adds nothing', async () => {
    const value = context({ chooserTarget: { trackId: 'plain' } });
    render(<AddToSetChooser />, value);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-set-chooser-new]')!.click());
    expect(value.addItem).not.toHaveBeenCalled();
    expect(value.closeChooser).not.toHaveBeenCalled();
    expect(document.querySelector('[data-set-chooser]')?.textContent).toContain("That didn't work. Try again.");
  });

  it('negative: nothing shows without a pending "Add to set", or with sets off', () => {
    render(<AddToSetChooser />, context());
    expect(document.querySelector('[data-set-chooser]')).toBeNull();
    act(() => root!.unmount());
    render(<AddToSetChooser />, context({ enabled: false, chooserTarget: { trackId: 'plain' } }));
    expect(document.querySelector('[data-set-chooser]')).toBeNull();
  });
});

// ---------------------------------------------------------------- compact bar and Shortcuts tab

const barContext = { started: true, isDirty: false, handleTogglePlay: () => {}, handleEvaluate: () => {} };

describe('the compact control bar', () => {
  it('holds the set bar (touch) while a set plays, and its button Cues', () => {
    const value = context({
      openSetId: 's1',
      player: { setId: 's1', nowItemId: null, nextItemId: 'a', cuedItemId: null, phase: 'idle' },
    });
    render(<CompactControlBar context={barContext} />, value);
    const bar = document.querySelector('[data-compact-control-bar] [data-set-bar]');
    expect(bar?.getAttribute('data-set-bar-touch')).toBe('true');
    const button = bar!.querySelector<HTMLButtonElement>('[data-set-bar-button]')!;
    expect(button.textContent).toBe('Cue');
    act(() => button.click());
    expect(value.press).toHaveBeenCalledTimes(1);
  });

  it('negative: no set bar while no set plays', () => {
    render(<CompactControlBar context={barContext} />, context());
    expect(document.querySelector('[data-compact-control-bar]')).not.toBeNull();
    expect(document.querySelector('[data-set-bar]')).toBeNull();
  });
});

describe('the Shortcuts tab', () => {
  const rows = () => [...document.querySelectorAll('[data-shortcut-keys]')];
  const setRow = () => rows().find((row) => /\bN\b/.test(row.textContent ?? '') && /Shift/.test(row.textContent ?? ''));

  it('lists Alt/Option + Shift + N with its description', () => {
    render(<ShortcutsTab />, null);
    const row = setRow();
    expect(row).toBeDefined();
    expect(row!.parentElement?.textContent).toContain('Set: cue the next track, then mix it in');
  });

  it('negative: no other row uses the N key', () => {
    render(<ShortcutsTab />, null);
    expect(rows().filter((row) => /(^|\W)N(\W|$)/.test(row.textContent ?? ''))).toHaveLength(1);
  });
});
