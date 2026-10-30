// @vitest-environment jsdom
/**
 * @spec: 016-responsive-repl-layout (2.2, 2.4, 2.5)
 * Acceptance-level checks of the compact REPL shell with the real library (FileManagerRefactored,
 * its operations hook and FileTree) inside the drawer:
 * - an unsaved edit survives the drawer, the settings sheet, the More menu and rotations, and the
 *   emergency/autosave path still saves it to the same track;
 * - picking another track in the drawer runs save-before-switch before the drawer closes, and the
 *   new track only loads after that save;
 * - the admin read-only view on a phone offers no rename, delete or create actions;
 * - on a 1440x900 desktop none of the compact elements render.
 */
import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage` (undefined without --localstorage-file), which
// shadows jsdom's; settings.ts reads it at import time, so point it at jsdom's before imports.
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

// Boundaries only: Supabase, the heavy @strudel packages and the parts of the shell not under
// test. ReplEditor, Header, the compact components, the panel layout store, FileManagerRefactored,
// useFileManagerOperations, FileTree, WorkingContextMenu and globalSaveManager are real.
vi.mock('@src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => {
      throw new Error('no Supabase in tests');
    },
  },
}));
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false, confirmDialog: async () => true }));
vi.mock('@strudel/webaudio', () => ({ getAudioContext: () => ({}) }));
vi.mock('@src/repl/components/Loader', () => ({ default: () => null }));
vi.mock('@src/repl/components/ExportDialog', () => ({ ExportDialog: () => null }));
vi.mock('@src/repl/components/UserFacingErrorMessage', () => ({ default: () => null }));
vi.mock('@src/repl/components/WelcomeScreen', () => ({ WelcomeScreen: () => <div data-welcome="" /> }));
vi.mock('@src/components/GlobalToastContainer', () => ({ GlobalToastContainer: () => null }));
vi.mock('@src/components/auth/AuthButton', () => ({ AuthButton: () => <span data-auth-button="" /> }));
vi.mock('@src/user_pattern_utils', () => ({
  userPattern: {},
  getActivePattern: () => '',
  setActivePattern: () => {},
}));
vi.mock('@src/hooks/useTracks', () => ({
  useTracks: () => ({
    isInitialized: true,
    hasTracks: true,
    isLoading: false,
    initializeWithSSR: () => {},
    initializeWithCoordination: () => {},
    loadFromAPI: async () => {},
  }),
}));
vi.mock('@src/repl/components/panel/Panel', () => ({
  VerticalPanel: () => <div data-vertical-panel="" />,
  HorizontalPanel: () => <div data-horizontal-panel="" />,
}));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The vitest config runs files with isolate:false, so the module cache is shared across files.
// CompactLayout.test.tsx mocks FileManagerRefactored, while this file needs the real one. So this
// file loads the shell fresh, after its own mocks, and resets the cache again when done, so
// neither file reuses the other's ReplEditor.
let ReplEditor: typeof import('../../ReplEditor').default;
let settings: typeof import('@src/settings');
let panelLayout: typeof import('../../panel/panelLayout');
let LONG_PRESS_MS: number;
let globalSaveManager: typeof import('../../../globalSaveManager').globalSaveManager;

beforeAll(async () => {
  vi.resetModules();
  ReplEditor = (await import('../../ReplEditor')).default;
  settings = await import('@src/settings');
  panelLayout = await import('../../panel/panelLayout');
  LONG_PRESS_MS = (await import('../../ui/WorkingContextMenu')).LONG_PRESS_MS;
  globalSaveManager = (await import('../../../globalSaveManager')).globalSaveManager;
});
afterAll(() => {
  vi.resetModules();
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const SAVED_CODE = 's("bd sd")';
const EDITED_CODE = 's("bd sd hh")';

/**
 * A stand-in for StrudelMirror: init() mounts an editable node into #code (as CodeMirror does)
 * and exposes `code` on editorRef, which is what the save paths read.
 */
const makeContext = () => {
  const context = {
    containerRef: { current: null as HTMLElement | null },
    editorRef: { current: null as null | { code: string; setCode: ReturnType<typeof vi.fn> } },
    init: vi.fn(() => {
      const content = document.createElement('div');
      content.className = 'cm-content';
      content.contentEditable = 'true';
      content.textContent = SAVED_CODE;
      context.containerRef.current!.appendChild(content);
      context.editorRef.current = { code: SAVED_CODE, setCode: vi.fn() };
    }),
    started: true,
    isDirty: true,
    handleTogglePlay: vi.fn(),
    handleEvaluate: vi.fn(),
    handleShuffle: vi.fn(),
    handleShare: vi.fn(),
    handleUpdate: vi.fn(),
    mixer: {},
    isPreviewing: false,
    handlePreviewToggle: vi.fn(),
    isRecording: false,
    handleRecordToggle: vi.fn(),
    isScreenRecording: false,
    handleScreenRecordToggle: vi.fn(),
    isScreenRecordingSupported: true,
  };
  return context;
};

const libraryTracks = () => ({
  a: { id: 'a', name: 'alpha', code: SAVED_CODE, created: '', modified: '', isMultitrack: false },
  b: { id: 'b', name: 'beta', code: 'note("c e g")', created: '', modified: '', isMultitrack: false },
});

/** The shape useSupabaseFileManager returns, with the save/load paths as spies. */
const makeFileManagerHook = (overrides: Record<string, unknown> = {}) => {
  const noop = () => {};
  return {
    tracks: libraryTracks(),
    folders: {},
    selectedTrack: 'a',
    activePattern: 'alpha',
    isDragOver: false,
    saveStatus: 'saved',
    isCreating: false,
    isCreatingFolder: false,
    isCreatingStep: false,
    newTrackName: '',
    newFolderName: '',
    newStepName: '',
    newItemParentPath: '',
    selectedStepTrack: null,
    trackToDelete: null,
    folderToDelete: null,
    renamingTrack: null,
    renamingFolder: null,
    renamingStep: null,
    renameValue: '',
    showDeleteModal: false,
    showDeleteFolderModal: false,
    folderContents: { subfolders: [], tracks: [] },
    isDeletingTrackRef: { current: false },
    isDeletingFolderRef: { current: new Set() },
    setTracks: noop,
    setFolders: noop,
    setSelectedTrack: noop,
    setNewTrackName: noop,
    setNewFolderName: noop,
    setNewItemParentPath: noop,
    setIsCreating: noop,
    setIsCreatingFolder: noop,
    setIsCreatingStep: noop,
    setNewStepName: noop,
    setSelectedStepTrack: noop,
    setTrackToDelete: noop,
    setShowDeleteModal: noop,
    setFolderToDelete: noop,
    setShowDeleteFolderModal: noop,
    setFolderContents: noop,
    setRenamingTrack: noop,
    setRenamingFolder: noop,
    setRenamingStep: noop,
    setRenameValue: noop,
    loadTrack: vi.fn(),
    saveCurrentTrack: vi.fn(async () => true),
    saveSpecificTrack: vi.fn(async () => true),
    createTrack: vi.fn(),
    createFolder: vi.fn(),
    deleteTrack: vi.fn(),
    ...overrides,
  };
};

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};
const rotate = (width: number, height: number) =>
  act(() => {
    setViewport(width, height);
    window.dispatchEvent(new Event('resize'));
  });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let context = makeContext();

function renderRepl(fileManagerHook: unknown, readOnly = false) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(<ReplEditor context={context as any} fileManagerHook={fileManagerHook} readOnly={readOnly} />),
  );
  return container;
}

const $ = <T extends Element = HTMLElement>(selector: string) => container!.querySelector<T>(selector);
const click = (selector: string) => act(() => $<HTMLElement>(selector)!.click());
const drawer = () => $('[data-library-drawer]');
const drawerOpen = () => drawer()?.getAttribute('data-open') === 'true';
/** A row's name inside the drawer (the leaf element showing exactly this text). */
const rowName = (text: string) =>
  [...drawer()!.querySelectorAll<HTMLElement>('*')].find(
    (el) => el.textContent?.trim() === text && el.children.length === 0,
  )!;
const menuLabels = () =>
  [...document.querySelectorAll<HTMLButtonElement>('div.fixed button')].map((b) => b.textContent?.trim() ?? '');
// Labels are i18n keys or English depending on when the resources load; match both forms.
const EDIT_ACTION = /rename|delete|duplicate|convert|new ?track|new ?folder|create/i;

const typeEdit = () => {
  context.containerRef.current!.querySelector('.cm-content')!.textContent = EDITED_CODE;
  context.editorRef.current!.code = EDITED_CODE;
};

const originalSize = { width: window.innerWidth, height: window.innerHeight };
const originalPath = window.location.pathname;

beforeEach(() => {
  context = makeContext();
  panelLayout.resetPanelSession();
  settings.setIsPanelOpened(false);
  settings.setIsFileManagerOpen(false);
  settings.settingsMap.setKey('isZen', false);
  settings.settingsMap.setKey('panelPosition', 'right');
  window.history.replaceState(null, '', '/repl/a');
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  setViewport(originalSize.width, originalSize.height);
  panelLayout.resetPanelSession();
  vi.useRealTimers();
  window.history.replaceState(null, '', originalPath);
});

describe('an unsaved edit on a compact screen (spec 016 2.5)', () => {
  // @regression: the editor must never remount when the layout changes (lost-work risk).
  it('survives the drawer, the sheet, the More menu and 390x844 -> 844x390 -> 1440x900, then saves to the same track', async () => {
    setViewport(390, 844);
    const hook = makeFileManagerHook();
    renderRepl(hook);
    const editor = $('#code');
    const content = editor!.querySelector('.cm-content');
    typeEdit();
    expect(globalSaveManager.hasUnsavedChanges()).toBe(true);

    click('[data-bar-library]');
    expect(drawerOpen()).toBe(true);
    click('[data-library-backdrop]');
    click('[data-bar-library]');
    click('[data-library-close]');
    click('[data-bar-settings]');
    click('[data-bar-settings]');
    click('[data-compact-more]');
    expect($('[data-compact-more-menu]')).not.toBeNull();
    click('[data-compact-more]');
    rotate(844, 390);
    expect($('[data-compact-control-bar]')).not.toBeNull();
    rotate(1440, 900);
    expect($('[data-compact-control-bar]')).toBeNull();

    // Same editor node, same content node, same text; nothing reset the code.
    expect($('#code')).toBe(editor);
    expect(editor!.querySelector('.cm-content')).toBe(content);
    expect(content!.textContent).toBe(EDITED_CODE);
    expect(context.editorRef.current!.code).toBe(EDITED_CODE);
    expect(context.editorRef.current!.setCode).not.toHaveBeenCalled();
    expect(context.init).toHaveBeenCalledTimes(1);
    // No track was loaded or switched by the layout changes.
    expect(hook.loadTrack).not.toHaveBeenCalled();
    expect(hook.saveCurrentTrack).not.toHaveBeenCalled();

    // The save path is still wired to the same library and context: it saves track "a".
    expect(globalSaveManager.hasUnsavedChanges()).toBe(true);
    await expect(globalSaveManager.performEmergencySave()).resolves.toBe(true);
    expect(hook.saveSpecificTrack).toHaveBeenCalledTimes(1);
    expect(hook.saveSpecificTrack).toHaveBeenCalledWith('a', false);
  });

  it('without an edit there is nothing to save after the same toggles (the check is not vacuous)', async () => {
    setViewport(390, 844);
    const hook = makeFileManagerHook();
    renderRepl(hook);
    click('[data-bar-library]');
    click('[data-library-close]');
    rotate(844, 390);
    expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
    await globalSaveManager.performEmergencySave();
    expect(hook.saveSpecificTrack).not.toHaveBeenCalled();
  });
});

describe('picking another track in the drawer (spec 016 2.2, 2.5)', () => {
  beforeEach(() => setViewport(390, 844));

  // @regression: the drawer close must never jump ahead of save-before-switch.
  // Review #4: the drawer closes only once the pick (save, then load) has finished.
  it('saves the open track first, loads the new track only after the save, then closes the drawer', async () => {
    const order: string[] = [];
    let finishSave!: (ok: boolean) => void;
    const hook = makeFileManagerHook({
      saveCurrentTrack: vi.fn(() => {
        order.push('save');
        return new Promise<boolean>((resolve) => (finishSave = resolve));
      }),
      loadTrack: vi.fn(() => order.push('load')),
    });
    renderRepl(hook);
    typeEdit();
    click('[data-bar-library]');
    const stopListening = panelLayout.panelSession.listen(() => order.push('close'));
    try {
      act(() => rowName('beta').click());

      expect(order).toEqual(['save']);
      expect(hook.saveCurrentTrack).toHaveBeenCalledWith(false);
      expect(drawerOpen()).toBe(true);
      expect(hook.loadTrack).not.toHaveBeenCalled();

      await act(async () => finishSave(true));
    } finally {
      stopListening();
    }
    expect(order).toEqual(['save', 'load', 'close']);
    expect(drawerOpen()).toBe(false);
    expect(hook.loadTrack).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    expect(window.location.pathname).toBe('/repl/beta');
  });

  it('re-picking the open track does not save over it, but still closes the drawer', async () => {
    const hook = makeFileManagerHook();
    renderRepl(hook);
    click('[data-bar-library]');
    await act(async () => rowName('alpha').click());
    expect(hook.saveCurrentTrack).not.toHaveBeenCalled();
    expect(drawerOpen()).toBe(false);
  });
});

describe('the admin read-only view on a phone (spec 016 2.5)', () => {
  beforeEach(() => {
    setViewport(390, 844);
    vi.useFakeTimers();
  });

  const longPress = (el: Element) => {
    act(() => {
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 1,
          pointerType: 'touch',
          clientX: 20,
          clientY: 20,
        }),
      );
    });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
  };

  it('editable: a long press in the drawer offers rename and delete, and the create header is there', () => {
    renderRepl(makeFileManagerHook(), false);
    click('[data-bar-library]');
    expect(drawer()!.querySelector('#file-import-input')).not.toBeNull();
    longPress(rowName('alpha'));
    expect(menuLabels().filter((l) => EDIT_ACTION.test(l)).length).toBeGreaterThanOrEqual(3);
  });

  it('read-only: a long press in the drawer offers no rename, delete or create; no create header', () => {
    renderRepl(makeFileManagerHook(), true);
    click('[data-bar-library]');
    expect(drawerOpen()).toBe(true);
    // The library header (new track / new folder / import) is not rendered.
    expect(drawer()!.querySelector('#file-import-input')).toBeNull();
    longPress(rowName('alpha'));
    const labels = menuLabels();
    expect(labels).toHaveLength(3); // load, download, info
    expect(labels.filter((l) => EDIT_ACTION.test(l))).toEqual([]);
  });

  it('read-only: the control bar and the More menu hold no edit-only actions', () => {
    renderRepl(makeFileManagerHook(), true);
    const bar = [...$('[data-compact-control-bar]')!.querySelectorAll<HTMLButtonElement>('button')];
    expect(bar.map((b) => Object.keys(b.dataset)[0])).toEqual(['barPlay', 'barUpdate', 'barLibrary', 'barSettings']);
    click('[data-compact-more]');
    const items = [...$('[data-compact-more-menu]')!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((i) => Object.keys(i.dataset)[0])).toEqual([
      'moreRecordAudio',
      'moreRecordScreen',
      'morePreview',
      'moreShare',
    ]);
    expect(items.filter((i) => EDIT_ACTION.test(i.textContent ?? ''))).toEqual([]);
  });
});

describe('a 1440x900 desktop (spec 016 2.5)', () => {
  const COMPACT_SELECTORS = [
    '[data-compact-control-bar]',
    '[data-compact-title-bar]',
    '[data-compact-more]',
    '[data-compact-more-menu]',
    '[data-compact-track-name]',
    '[data-library-drawer]',
    '[data-library-backdrop]',
    '[data-library-close]',
    '[data-bar-play]',
    '[data-bar-update]',
    '[data-bar-library]',
    '[data-bar-settings]',
  ];
  const compactElements = () => COMPACT_SELECTORS.filter((s) => $(s) !== null);

  beforeEach(() => {
    settings.setIsPanelOpened(true);
    settings.setIsFileManagerOpen(true);
  });

  it('renders none of the compact elements, with the library and the panel open', () => {
    setViewport(1440, 900);
    renderRepl(makeFileManagerHook());
    expect(compactElements()).toEqual([]);
    // The desktop chrome is there instead.
    expect($('button[title="Recording options"]')).not.toBeNull();
    expect($('.cursor-col-resize')).not.toBeNull();
    expect($('[data-vertical-panel]')).not.toBeNull();
  });

  it('a 390x844 phone renders the compact elements (the selectors are live)', () => {
    setViewport(390, 844);
    renderRepl(makeFileManagerHook());
    expect(compactElements()).toEqual(
      expect.arrayContaining(['[data-compact-control-bar]', '[data-compact-title-bar]', '[data-library-drawer]']),
    );
    expect($('button[title="Recording options"]')).toBeNull();
  });
});
