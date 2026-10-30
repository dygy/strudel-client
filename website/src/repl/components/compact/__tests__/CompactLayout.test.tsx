// @vitest-environment jsdom
/**
 * @spec: 016-responsive-repl-layout (2.1, 2.2, 2.4, 2.5)
 * The REPL shell on compact screens, rendered: a title bar with "More" instead of the desktop
 * header, a bottom control bar, the library as a drawer that starts closed, and an editor that
 * keeps its DOM node through rotations. On a desktop the shell is as before.
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

// Everything around the shell is stubbed; the shell (ReplEditor, Header, the compact components,
// Code and the panel layout store) is real.
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));
vi.mock('@strudel/webaudio', () => ({ getAudioContext: () => ({}) }));
vi.mock('@src/repl/components/Loader', () => ({ default: () => null }));
vi.mock('@src/repl/components/ExportDialog', () => ({ ExportDialog: () => null }));
vi.mock('@src/repl/components/UserFacingErrorMessage', () => ({ default: () => null }));
vi.mock('@src/repl/components/WelcomeScreen', () => ({ WelcomeScreen: () => <div data-welcome="" /> }));
vi.mock('@src/components/GlobalToastContainer', () => ({ GlobalToastContainer: () => null }));
vi.mock('@src/components/auth/AuthButton', () => ({ AuthButton: () => <span data-auth-button="" /> }));
vi.mock('@src/user_pattern_utils', () => ({ userPattern: {} }));
vi.mock('@src/lib/slugUtils', () => ({ findTrackByFolderAndSlug: () => null }));
vi.mock('@src/repl/globalSaveManager', () => ({ globalSaveManager: { register: () => {}, unregister: () => {} } }));
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
// The library itself is not under test: a stub that can "pick a track" like the real FileTree row.
vi.mock('@src/repl/components/sidebar/FileManagerRefactored', () => ({
  FileManagerRefactored: ({ onAfterTrackSelect }: { onAfterTrackSelect?: () => void }) => (
    <div data-file-manager="">
      <button data-pick-track="" onClick={() => onAfterTrackSelect?.()}>
        pick
      </button>
    </div>
  ),
}));

import type { Root } from 'react-dom/client';

// isolate:false shares the module cache across files: a file that ran earlier may already hold
// Header / the More menu bound to the real AuthButton (and other modules mocked above), so the
// mocks would not apply. Load fresh copies — React and react-dom too, so the tree renders with
// one React.
vi.resetModules();
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { parseBoolean, setIsFileManagerOpen, setIsPanelOpened, settingsMap } = await import('@src/settings');
const { default: ReplEditor } = await import('../../ReplEditor');
const { resetPanelSession } = await import('../../panel/panelLayout');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const makeContext = () => ({
  containerRef: { current: null },
  editorRef: { current: null },
  init: vi.fn(),
  started: false,
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
});

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

function renderRepl() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<ReplEditor context={context as any} fileManagerHook={{}} />));
  return container;
}

const $ = <T extends Element = HTMLElement>(selector: string) => container!.querySelector<T>(selector);
const click = (selector: string) => act(() => $<HTMLElement>(selector)!.click());
const controlBar = () => $('[data-compact-control-bar]');
const titleBar = () => $('[data-compact-title-bar]');
// Found by a title the desktop header always had, so these checks also hold before spec 016.
const desktopHeader = () => $('button[title="Recording options"]');
const drawerOpen = () => $('[data-library-drawer]')?.getAttribute('data-open') === 'true';
const persistedFilesOpen = () => parseBoolean(settingsMap.get().isFileManagerOpen);

const originalSize = { width: window.innerWidth, height: window.innerHeight };

beforeEach(() => {
  context = makeContext();
  resetPanelSession();
  setIsPanelOpened(false);
  setIsFileManagerOpen(false);
  settingsMap.setKey('isZen', false);
  settingsMap.setKey('panelPosition', 'right');
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  setViewport(originalSize.width, originalSize.height);
  resetPanelSession();
});

describe('REPL shell on a phone (390x844)', () => {
  beforeEach(() => setViewport(390, 844));

  it('shows the bottom control bar and the title bar instead of the desktop header', () => {
    renderRepl();
    expect(controlBar()).not.toBeNull();
    expect(titleBar()).not.toBeNull();
    expect(desktopHeader()).toBeNull();
  });

  it('the control bar holds Play, Update, Library and Settings, each 44x44 with a label', () => {
    renderRepl();
    const buttons = [...controlBar()!.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((b) => Object.keys(b.dataset)[0])).toEqual([
      'barPlay',
      'barUpdate',
      'barLibrary',
      'barSettings',
    ]);
    for (const button of buttons) {
      expect(button.className).toMatch(/\bmin-h-11\b/);
      expect(button.className).toMatch(/\bmin-w-11\b/);
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('is 56px tall, and 48px on a short (landscape phone) screen, so both bars stay <= 25%', () => {
    renderRepl();
    expect(controlBar()!.className).toMatch(/(^|\s)min-h-14(\s|$)/);
    expect(controlBar()!.className).toContain('[@media(max-height:499px)]:min-h-12');
    expect($('[data-compact-title-row]')!.className).toMatch(/(^|\s)h-11(\s|$)/);
  });

  // Review #5: nothing under the notch, status bar or home indicator (env() is 0 elsewhere).
  it('keeps the bars and the code inside the safe area', () => {
    renderRepl();
    expect(titleBar()!.className).toContain('pt-[env(safe-area-inset-top)]');
    expect(controlBar()!.className).toContain('pb-[env(safe-area-inset-bottom)]');
    const column = titleBar()!.parentElement!;
    expect(column.className).toContain('pl-[env(safe-area-inset-left)]');
    expect(column.className).toContain('pr-[env(safe-area-inset-right)]');
  });

  it('Play and Update call the same handlers as the desktop buttons; Update shows the dirty glow', () => {
    renderRepl();
    click('[data-bar-play]');
    click('[data-bar-update]');
    expect(context.handleTogglePlay).toHaveBeenCalledTimes(1);
    expect(context.handleEvaluate).toHaveBeenCalledTimes(1);
    expect($('[data-bar-update]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('the editor spans the width: no closed panel strip and no inline sidebar beside it', () => {
    renderRepl();
    expect($('#code')).not.toBeNull();
    expect($('[data-vertical-panel]')).toBeNull();
    expect($('.cursor-col-resize')).toBeNull(); // the desktop ResizableSidebar handle
    expect(drawerOpen()).toBe(false);
  });

  it('Settings opens the panel sheet and closes it again', () => {
    renderRepl();
    click('[data-bar-settings]');
    expect($('[data-vertical-panel]')).not.toBeNull();
    click('[data-bar-settings]');
    expect($('[data-vertical-panel]')).toBeNull();
  });

  describe('the More menu', () => {
    const openMore = () => click('[data-compact-more]');
    const menu = () => $('[data-compact-more-menu]');

    it('lists record audio, record screen, preview, share and the account entry', () => {
      renderRepl();
      expect(menu()).toBeNull();
      openMore();
      expect(menu()).not.toBeNull();
      for (const item of ['record-audio', 'record-screen', 'preview', 'share']) {
        expect($(`[data-more-${item}]`)).not.toBeNull();
      }
      expect(menu()!.querySelector('[data-auth-button]')).not.toBeNull();
    });

    it.each([
      ['record-audio', 'handleRecordToggle'],
      ['record-screen', 'handleScreenRecordToggle'],
      ['preview', 'handlePreviewToggle'],
      ['share', 'handleShare'],
    ] as const)('%s calls context.%s, as on the desktop', (item, handler) => {
      renderRepl();
      openMore();
      click(`[data-more-${item}]`);
      expect(context[handler]).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape and on a pointerdown outside it', () => {
      renderRepl();
      openMore();
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(menu()).toBeNull();
      openMore();
      act(() => {
        $('#code')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      });
      expect(menu()).toBeNull();
    });

    it('has no preview entry without a mixer', () => {
      context = { ...makeContext(), mixer: undefined } as ReturnType<typeof makeContext>;
      renderRepl();
      openMore();
      expect($('[data-more-preview]')).toBeNull();
    });
  });

  describe('the library drawer', () => {
    it('starts closed on a compact load even when the library was left open, without persisting it', () => {
      setIsFileManagerOpen(true);
      renderRepl();
      expect(drawerOpen()).toBe(false);
      expect(persistedFilesOpen()).toBe(true);
    });

    it('opens with Library and closes with its close button', () => {
      renderRepl();
      click('[data-bar-library]');
      expect(drawerOpen()).toBe(true);
      click('[data-library-close]');
      expect(drawerOpen()).toBe(false);
    });

    it('closes with a tap on the backdrop', () => {
      renderRepl();
      click('[data-bar-library]');
      click('[data-library-backdrop]');
      expect(drawerOpen()).toBe(false);
    });

    it('closes after a track is picked, and the persisted (desktop) choice stays open', () => {
      renderRepl();
      click('[data-bar-library]');
      click('[data-pick-track]');
      expect(drawerOpen()).toBe(false);
      expect(persistedFilesOpen()).toBe(true);
    });

    it('keeps the library mounted while closed (the tree and its save paths never unmount)', () => {
      renderRepl();
      const library = $('[data-file-manager]');
      click('[data-bar-library]');
      click('[data-library-close]');
      expect($('[data-file-manager]')).toBe(library);
    });

    it('is exclusive with the settings sheet', () => {
      renderRepl();
      click('[data-bar-settings]');
      click('[data-bar-library]');
      expect(drawerOpen()).toBe(true);
      expect($('[data-vertical-panel]')).toBeNull();
      click('[data-bar-settings]');
      expect($('[data-vertical-panel]')).not.toBeNull();
      expect(drawerOpen()).toBe(false);
    });
  });
});

describe('REPL shell on a tablet in portrait (820x1180)', () => {
  it('uses the compact shell', () => {
    setViewport(820, 1180);
    renderRepl();
    expect(controlBar()).not.toBeNull();
    expect(desktopHeader()).toBeNull();
  });
});

describe('REPL shell on a desktop (1440x900)', () => {
  beforeEach(() => setViewport(1440, 900));

  it('renders the desktop header, side panel and sidebar; no compact bars or drawer', () => {
    setIsPanelOpened(true);
    setIsFileManagerOpen(true);
    renderRepl();
    expect(desktopHeader()).not.toBeNull();
    expect(controlBar()).toBeNull();
    expect(titleBar()).toBeNull();
    expect($('[data-library-drawer]')).toBeNull();
    expect($('[data-vertical-panel]')).not.toBeNull();
    expect($('.cursor-col-resize')).not.toBeNull();
  });

  it('the REPL column keeps exactly its desktop classes (no safe-area padding)', () => {
    renderRepl();
    expect(desktopHeader()!.closest('header')!.parentElement!.className).toBe('h-full flex flex-col relative');
  });

  it('keeps the closed 48px panel strip beside the editor', () => {
    renderRepl();
    expect($('[data-vertical-panel]')).not.toBeNull();
  });
});

// Review #1: an upright Android tablet resizes the layout viewport when the keyboard opens.
describe('the on-screen keyboard never changes the layout (820x1180 tablet)', () => {
  let input: HTMLInputElement | null = null;
  afterEach(() => {
    input?.remove();
    input = null;
  });
  const focusInput = () => {
    input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
  };

  it('typing (an input focused) + a height-only shrink keeps the compact layout and the drawer open', () => {
    setViewport(820, 1180);
    renderRepl();
    click('[data-bar-library]');
    focusInput();
    rotate(820, 700); // a 480px keyboard: the raw size would be the desktop layout
    expect(controlBar()).not.toBeNull();
    expect(desktopHeader()).toBeNull();
    expect(drawerOpen()).toBe(true);
    rotate(820, 1180); // keyboard closed
    expect(controlBar()).not.toBeNull();
  });

  it('a real rotation (the width changes) still switches, even while typing', () => {
    setViewport(820, 1180);
    renderRepl();
    focusInput();
    rotate(1180, 820);
    expect(controlBar()).toBeNull();
    expect(desktopHeader()).not.toBeNull();
  });

  it('without focus a height-only resize is a real resize (a desktop window made shorter)', () => {
    setViewport(820, 1180);
    renderRepl();
    rotate(820, 700);
    expect(controlBar()).toBeNull();
  });
});

describe('switching layouts never remounts the editor', () => {
  it('rotating 390x844 -> 844x390 -> 1440x900 -> 390x844 keeps the same #code node', () => {
    setViewport(390, 844);
    renderRepl();
    const editor = $('#code');
    expect(editor).not.toBeNull();
    expect(controlBar()).not.toBeNull();

    rotate(844, 390);
    expect(controlBar()).not.toBeNull();
    expect($('#code')).toBe(editor);

    rotate(1440, 900);
    expect(controlBar()).toBeNull();
    expect(desktopHeader()).not.toBeNull();
    expect($('#code')).toBe(editor);

    rotate(390, 844);
    expect(controlBar()).not.toBeNull();
    expect($('#code')).toBe(editor);
    expect(editor!.isConnected).toBe(true);
    // CodeMirror was created once, never torn down and rebuilt.
    expect(context.init).toHaveBeenCalledTimes(1);
  });

  it('opening and closing the drawer and the sheet keeps the same #code node', () => {
    setViewport(390, 844);
    renderRepl();
    const editor = $('#code');
    click('[data-bar-library]');
    click('[data-library-close]');
    click('[data-bar-settings]');
    click('[data-bar-settings]');
    expect($('#code')).toBe(editor);
    expect(context.init).toHaveBeenCalledTimes(1);
  });
});
