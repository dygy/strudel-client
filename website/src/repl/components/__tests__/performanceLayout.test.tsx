// @vitest-environment jsdom
/**
 * @spec: 030-performance-mode (2.1 enter/leave, 2.2 layout, 2.5 guard installed; tech §2.2, §2.3, §2.4)
 * The performance view in the real REPL shell: Alt+Shift+P (even in the editor) opens and closes it;
 * the header, sidebar/drawer, panel and compact bar are HIDDEN but stay mounted
 * (zen mode unmounts; this must not), while the track-conflict notice stays visible; the #code element is the same node before, during and after;
 * the font size goes on the root as --perf-font-size; the header's Perform button and the compact
 * More menu's Perform item open it; the close-tab guard is installed with the REPL.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

const meter = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));

vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));
vi.mock('@strudel/webaudio', () => ({ getAudioContext: () => ({}) }));
vi.mock('@src/repl/performance/levelMeter', () => ({
  METER_FLOOR_DB: -60,
  openLevelMeter: meter.open,
  // A full MeterDisplay: the strip draws it once a frame runs (the clocks tests let frames run).
  meterBallistics: (_prev: unknown, reading: { peakDb: [number, number]; over: boolean }) => ({
    peakDb: reading.peakDb,
    holdDb: reading.peakDb,
    holdAgeMs: [0, 0],
    clip: reading.over,
    clipAgeMs: reading.over ? 0 : Infinity,
  }),
}));
vi.mock('@src/repl/components/Loader', () => ({ default: () => null }));
vi.mock('@src/repl/components/ExportDialog', () => ({ ExportDialog: () => null }));
vi.mock('@src/repl/components/UserFacingErrorMessage', () => ({ default: () => <div data-user-error="" /> }));
vi.mock('@src/repl/components/WelcomeScreen', () => ({ WelcomeScreen: () => <div data-welcome="" /> }));
vi.mock('@src/components/GlobalToastContainer', () => ({ GlobalToastContainer: () => null }));
vi.mock('@src/components/auth/AuthButton', () => ({ AuthButton: () => <span data-auth-button="" /> }));
vi.mock('@src/user_pattern_utils', () => ({ userPattern: {} }));
vi.mock('@src/lib/slugUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/lib/slugUtils')>()),
  findTrackByFolderAndSlug: () => null,
}));
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
vi.mock('@src/repl/components/sidebar/FileManagerRefactored', () => ({
  FileManagerRefactored: () => <div data-file-manager="" />,
}));
vi.mock('@src/repl/components/TrackConflictNotice', () => ({
  TrackConflictNotice: () => <div data-conflict-notice="" />,
}));

import type { Root } from 'react-dom/client';

vi.resetModules();
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { default: i18n } = await import('@src/i18n/i18n');
const { setIsFileManagerOpen, setIsPanelOpened, settingsMap } = await import('@src/settings');
const { default: ReplEditor } = await import('../ReplEditor');
const { resetPanelSession } = await import('../panel/panelLayout');
const store = await import('../../performance/performanceStore');
const clock = await import('../../performance/performanceClock');
const { createTestEditor } = await import('../../../../../packages/codemirror/test/editorFixture.mjs');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let started = false;
const makeContext = (over: Record<string, unknown> = {}) => ({
  containerRef: { current: null as HTMLElement | null },
  editorRef: {
    current: {
      repl: {
        scheduler: {
          get started() {
            return started;
          },
        },
      },
    },
  },
  init: vi.fn(),
  started: false,
  isDirty: false,
  handleTogglePlay: vi.fn(),
  handleEvaluate: vi.fn(),
  handleShuffle: vi.fn(),
  handleShare: vi.fn(),
  handleUpdate: vi.fn(),
  trackIds: () => ({ editor: 't1', playing: null }),
  ...over,
});

type Context = ReturnType<typeof makeContext>;

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};
const originalSize = { width: window.innerWidth, height: window.innerHeight };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderRepl({ readOnly = false, context = makeContext() }: { readOnly?: boolean; context?: Context } = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const fileManagerHook = { selectedTrack: 't1', tracks: { t1: { name: 'Night drive' } } };
  act(() =>
    root!.render(<ReplEditor context={context as never} fileManagerHook={fileManagerHook} readOnly={readOnly} />),
  );
  return container;
}

const $ = <T extends Element = HTMLElement>(selector: string) => container!.querySelector<T>(selector);
// ReplEditor's root (the context provider renders no element of its own).
const replRoot = () => container!.firstElementChild as HTMLElement;
const isHidden = (el: Element | null) => {
  for (let node = el; node && node !== container; node = node.parentElement) {
    if (node.classList.contains('hidden')) return true;
  }
  return false;
};
const perfKey = (target: EventTarget) => {
  const event = new KeyboardEvent('keydown', {
    code: 'KeyP',
    key: '∏',
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings', 'common']);
  started = false;
  meter.open.mockReset().mockImplementation(() => ({
    read: () => ({ peakDb: [-Infinity, -Infinity], rmsDb: [-Infinity, -Infinity], over: false }),
    close: meter.close,
  }));
  meter.close.mockReset();
  resetPanelSession();
  setIsPanelOpened(true);
  setIsFileManagerOpen(true);
  settingsMap.setKey('isZen', false);
  settingsMap.setKey('panelPosition', 'right');
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  setViewport(originalSize.width, originalSize.height);
  resetPanelSession();
  setIsPanelOpened(false);
  setIsFileManagerOpen(false);
  store.performanceOpen.set(false);
  store.performanceFontSize.set('28');
  clock.resetClockStore();
});

describe('performance view on a desktop (1440x900)', () => {
  beforeEach(() => setViewport(1440, 900));

  it('Alt+Shift+P in the editor opens it, and again closes it; nothing typed', () => {
    renderRepl();
    expect(replRoot().getAttribute('data-performance')).toBeNull();
    expect($('[data-performance-strip]')).toBeNull();
    const event = perfKey($('#code')!);
    expect(event.defaultPrevented).toBe(true);
    expect(replRoot().getAttribute('data-performance')).toBe('true');
    expect($('[data-performance-strip]')).not.toBeNull();
    perfKey($('#code')!);
    expect(replRoot().getAttribute('data-performance')).toBeNull();
    expect($('[data-performance-strip]')).toBeNull();
  });

  it('hides the header, sidebar and panel, but keeps them mounted', () => {
    renderRepl();
    const before = {
      header: $('header'),
      sidebar: $('[data-file-manager]'),
      panel: $('[data-vertical-panel]'),
    };
    for (const el of Object.values(before)) {
      expect(el).not.toBeNull();
      expect(isHidden(el)).toBe(false);
    }
    act(() => store.openPerformance());
    for (const [name, el] of Object.entries(before)) {
      // The same element, still in the document, only hidden.
      expect(container!.contains(el), `${name} stays mounted`).toBe(true);
      expect(isHidden(el), `${name} is hidden`).toBe(true);
    }
    expect(isHidden($('[data-performance-strip]'))).toBe(false);
    expect(isHidden($('#code'))).toBe(false);
    // Evaluation errors still show.
    expect(isHidden($('[data-user-error]'))).toBe(false);
    act(() => store.closePerformance());
    for (const el of Object.values(before)) {
      expect(container!.contains(el)).toBe(true);
      expect(isHidden(el)).toBe(false);
    }
  });

  // Review #3: the notice is the only sign that saving is paused, so it stays on stage.
  it('keeps the track-conflict notice visible while the view is open', () => {
    renderRepl();
    const notice = $('[data-conflict-notice]');
    expect(notice).not.toBeNull();
    act(() => store.openPerformance());
    expect($('[data-conflict-notice]')).toBe(notice);
    expect(isHidden(notice)).toBe(false);
  });

  it('keeps a bottom panel mounted too', () => {
    settingsMap.setKey('panelPosition', 'bottom');
    renderRepl();
    const panel = $('[data-horizontal-panel]');
    act(() => store.openPerformance());
    expect(container!.contains(panel)).toBe(true);
    expect(isHidden(panel)).toBe(true);
  });

  it('the editor (#code) is the same node before, during and after, and never re-initialises', () => {
    renderRepl();
    const code = $('#code');
    for (let i = 0; i < 10; i++) {
      act(() => store.togglePerformance());
      expect($('#code')).toBe(code);
    }
    expect($('#code')).toBe(code);
  });

  it('sets --perf-font-size on the root from the stored size', () => {
    store.performanceFontSize.set('40');
    renderRepl();
    act(() => store.openPerformance());
    expect(replRoot().style.getPropertyValue('--perf-font-size')).toBe('40px');
    act(() => $<HTMLButtonElement>('[data-perf-bigger]')!.click());
    expect(replRoot().style.getPropertyValue('--perf-font-size')).toBe('44px');
  });

  it('shows the open track as Now; Exit closes', () => {
    renderRepl();
    act(() => store.openPerformance());
    expect($('[data-perf-now]')!.textContent).toBe('Now: Night drive');
    act(() => $<HTMLButtonElement>('[data-perf-exit]')!.click());
    expect(store.performanceOpen.get()).toBe(false);
  });

  it('the header Perform button opens it', () => {
    renderRepl();
    const button = $('[data-perform-button]')!.closest('button')!;
    expect(button.getAttribute('title')).toBe('Perform (Alt+Shift+P)');
    act(() => button.click());
    expect(store.performanceOpen.get()).toBe(true);
  });

  it('opens in the read-only admin view too', () => {
    renderRepl({ readOnly: true });
    perfKey(document.body);
    expect(store.performanceOpen.get()).toBe(true);
    expect($('[data-performance-strip]')).not.toBeNull();
  });

  it('the level meter tap exists only while the view is open', () => {
    renderRepl();
    expect(meter.open).not.toHaveBeenCalled();
    act(() => store.openPerformance());
    expect(meter.open).toHaveBeenCalledTimes(1);
    act(() => store.closePerformance());
    expect(meter.close).toHaveBeenCalledTimes(1);
  });

  it('installs the close-tab guard with the REPL: cancelled only while the main scheduler plays', () => {
    renderRepl();
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    started = true;
    expect(unload()).toBe(true);
    act(() => root!.unmount());
    root = null;
    expect(unload()).toBe(false);
  });
});

describe('performance view on a phone (390x844)', () => {
  beforeEach(() => setViewport(390, 844));

  it('hides the title bar, drawer and control bar but keeps them mounted', () => {
    renderRepl();
    const titleBar = $('[data-compact-title-bar]');
    const controlBar = $('[data-compact-control-bar]');
    const drawer = $('[data-library-drawer]');
    expect([titleBar, controlBar, drawer].every(Boolean)).toBe(true);
    act(() => store.openPerformance());
    for (const el of [titleBar, controlBar, drawer]) {
      expect(container!.contains(el)).toBe(true);
      expect(isHidden(el)).toBe(true);
    }
  });

  it('the More menu has a Perform item that opens the view', () => {
    renderRepl();
    act(() => $<HTMLButtonElement>('[data-compact-more]')!.click());
    const item = $<HTMLButtonElement>('[data-more-perform]')!;
    expect(item.textContent).toContain('Perform');
    act(() => item.click());
    expect(store.performanceOpen.get()).toBe(true);
    expect($('[data-compact-more-menu]')).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------------ */
/*  Feature testing (task 4.1): the acceptance criteria the slices above leave open.                */
/* ------------------------------------------------------------------------------------------------ */

type TestEditor = ReturnType<typeof createTestEditor>;

// CodeMirror measures text with Range rects, which jsdom lacks; and every editor is destroyed after
// its test, so no measure frame runs against a detached view in a later test (isolate:false).
const editors: TestEditor[] = [];
const rangeProto = Range.prototype as unknown as Record<string, unknown>;
const hadRects = typeof rangeProto.getClientRects === 'function';
beforeEach(() => {
  if (!hadRects) {
    rangeProto.getClientRects = () => [] as unknown as DOMRectList;
    rangeProto.getBoundingClientRect = () => new DOMRect();
  }
});
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.view.destroy());
  if (!hadRects) {
    delete rangeProto.getClientRects;
    delete rangeProto.getBoundingClientRect;
  }
});

/** A context whose init() builds a real CodeMirror (with history) in #code, the way StrudelMirror does. */
function contextWithEditor({ doc = 'note("c e g")', readOnly = false, over = {} } = {}) {
  const box: { editor: TestEditor | null; keydowns: KeyboardEvent[] } = { editor: null, keydowns: [] };
  const context = makeContext(over);
  context.init.mockImplementation(() => {
    box.editor = createTestEditor({
      parent: context.containerRef.current!,
      doc,
      readOnly,
      onKeyDown: (event: KeyboardEvent) => box.keydowns.push(event),
    });
    editors.push(box.editor);
  });
  return { context, box };
}

const keyIn = (target: EventTarget, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

describe('030 §2.1 the editor is the same editor (real CodeMirror)', () => {
  beforeEach(() => setViewport(1440, 900));
  it('Alt+Shift+P in the editor never reaches CodeMirror, and the text stays as it was', () => {
    const { context, box } = contextWithEditor();
    renderRepl({ context });
    const editor = box.editor!;
    perfKey(editor.view.contentDOM);
    expect(store.performanceOpen.get()).toBe(true);
    perfKey(editor.view.contentDOM);
    expect(store.performanceOpen.get()).toBe(false);
    expect(box.keydowns).toHaveLength(0);
    expect(editor.text()).toBe('note("c e g")');
  });

  it('other Alt+Shift letters and Ctrl/Cmd+Alt+Shift+P reach CodeMirror and open nothing', () => {
    const { context, box } = contextWithEditor();
    renderRepl({ context });
    const target = box.editor!.view.contentDOM;
    const events = [
      keyIn(target, { code: 'KeyO', key: 'Ø', altKey: true, shiftKey: true }),
      keyIn(target, { code: 'KeyP', key: 'P', altKey: true, shiftKey: true, ctrlKey: true }),
      keyIn(target, { code: 'KeyP', key: 'P', altKey: true, shiftKey: true, metaKey: true }),
      keyIn(target, { code: 'KeyP', key: 'π', altKey: true }),
    ];
    expect(box.keydowns).toHaveLength(4);
    expect(events.every((event) => !event.defaultPrevented)).toBe(true);
    expect(store.performanceOpen.get()).toBe(false);
  });

  it('edits before and during the view survive leaving, and Undo walks back through both', () => {
    const { context, box } = contextWithEditor({ doc: 's("bd")' });
    renderRepl({ context });
    const editor = box.editor!;
    editor.type('.fast(2)'); // unsaved, before the view
    perfKey(editor.view.contentDOM);
    expect(replRoot().getAttribute('data-performance')).toBe('true');
    editor.type('.gain(0.8)'); // during the view
    act(() => $<HTMLButtonElement>('[data-perf-exit]')!.click());
    expect(store.performanceOpen.get()).toBe(false);
    // The same CodeMirror, still in #code, never rebuilt.
    expect(context.init).toHaveBeenCalledTimes(1);
    expect($('#code')!.contains(editor.view.dom)).toBe(true);
    expect(editor.text()).toBe('s("bd").fast(2).gain(0.8)');
    editor.undo();
    expect(editor.text()).toBe('s("bd").fast(2)');
    editor.undo();
    expect(editor.text()).toBe('s("bd")');
  });

  it('an editor rebuilt on enter would lose the history (the guard above is not vacuous)', () => {
    // The negative: the same edits in a fresh editor have nothing to undo past the new doc.
    const parent = document.createElement('div');
    const fresh = createTestEditor({ parent, doc: 's("bd").fast(2).gain(0.8)' });
    expect(fresh.undo()).toBe(false);
    expect(fresh.text()).toBe('s("bd").fast(2).gain(0.8)');
    fresh.view.destroy();
  });
});

describe('030 §2.1 enter and leave 10 times: nothing about the music changes', () => {
  beforeEach(() => setViewport(1440, 900));

  it('while playing: no Play/Stop, no Update or evaluate, no re-init; every meter tap opened is closed', () => {
    started = true;
    const context = makeContext({ started: true });
    renderRepl({ context });
    const code = $('#code')!;
    for (let i = 0; i < 10; i++) {
      // Alternate the three ways in and out: the key, the header button, Exit, the store.
      if (i % 2 === 0) perfKey(code);
      else act(() => $('[data-perform-button]')!.closest('button')!.click());
      expect(store.performanceOpen.get()).toBe(true);
      if (i % 2 === 0) act(() => $<HTMLButtonElement>('[data-perf-exit]')!.click());
      else perfKey(document.body);
      expect(store.performanceOpen.get()).toBe(false);
    }
    expect(context.handleTogglePlay).not.toHaveBeenCalled();
    expect(context.handleEvaluate).not.toHaveBeenCalled();
    expect(context.handleUpdate).not.toHaveBeenCalled();
    expect(context.init).toHaveBeenCalledTimes(1);
    expect(meter.open).toHaveBeenCalledTimes(10);
    expect(meter.close).toHaveBeenCalledTimes(10);
    expect($('#code')).toBe(code);
  });

  it('the spies are wired: the strip Play and Update do reach the handlers', () => {
    const context = makeContext({ started: true });
    renderRepl({ context });
    act(() => store.openPerformance());
    const [play, update] = [...$('[data-performance-strip]')!.querySelectorAll('button')];
    act(() => play.click());
    expect(context.handleTogglePlay).toHaveBeenCalledTimes(1);
    expect(context.handleEvaluate).not.toHaveBeenCalled();
    act(() => update.click());
    expect(context.handleEvaluate).toHaveBeenCalledTimes(1);
    expect(context.handleTogglePlay).toHaveBeenCalledTimes(1);
  });
});

describe('030 §2.2 the strip Play/Stop and Update are the header buttons', () => {
  beforeEach(() => setViewport(1440, 900));

  it('same titles and the same handlers, header vs strip', () => {
    const context = makeContext({ started: true });
    renderRepl({ context });
    const headerButtons = [...$('header')!.querySelectorAll('button')];
    const headerStop = headerButtons.find((b) => b.getAttribute('title') === 'Stop (Ctrl+P)')!;
    const headerUpdate = headerButtons.find((b) => b.getAttribute('title') === 'Update (Ctrl+U)')!;
    act(() => headerStop.click());
    act(() => headerUpdate.click());
    act(() => store.openPerformance());
    const [stripStop, stripUpdate] = [...$('[data-performance-strip]')!.querySelectorAll('button')];
    expect(stripStop.getAttribute('title')).toBe(headerStop.getAttribute('title'));
    expect(stripUpdate.getAttribute('title')).toBe(headerUpdate.getAttribute('title'));
    act(() => stripStop.click());
    act(() => stripUpdate.click());
    expect(context.handleTogglePlay).toHaveBeenCalledTimes(2);
    expect(context.handleEvaluate).toHaveBeenCalledTimes(2);
  });
});

describe('030 §2.1 browser full screen, through the REPL', () => {
  const html = document.documentElement as HTMLElement & { requestFullscreen?: unknown };
  let fullscreenElement: Element | null = null;
  beforeEach(() => {
    setViewport(1440, 900);
    fullscreenElement = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = null;
      }),
    });
  });
  afterEach(() => {
    delete (html as { requestFullscreen?: unknown }).requestFullscreen;
    delete (document as { fullscreenElement?: unknown }).fullscreenElement;
    delete (document as { exitFullscreen?: unknown }).exitFullscreen;
    vi.restoreAllMocks();
  });

  it('a refused full screen leaves the view open over the window, and nothing is reported', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    html.requestFullscreen = vi.fn(() => Promise.reject(new TypeError('Permissions check failed')));
    renderRepl();
    perfKey(document.body);
    await act(async () => {
      await Promise.resolve();
    });
    expect(html.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(store.performanceOpen.get()).toBe(true);
    expect(replRoot().getAttribute('data-performance')).toBe('true');
    expect(error).not.toHaveBeenCalled();
  });

  it('leaving the browser full screen (Esc) brings the normal view back', async () => {
    html.requestFullscreen = vi.fn(async () => {
      fullscreenElement = html;
    });
    renderRepl();
    perfKey(document.body);
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.performanceOpen.get()).toBe(true);
    fullscreenElement = null;
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(store.performanceOpen.get()).toBe(false);
    expect($('[data-performance-strip]')).toBeNull();
  });

  it('a full screen change while the view stays in full screen does not close it', async () => {
    html.requestFullscreen = vi.fn(async () => {
      fullscreenElement = html;
    });
    renderRepl();
    perfKey(document.body);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(store.performanceOpen.get()).toBe(true);
  });
});

describe('030 §2.2 admin read-only view', () => {
  beforeEach(() => setViewport(1440, 900));

  it('the view opens and the editor stays read-only (same editor, no rebuild)', () => {
    const { context, box } = contextWithEditor({ readOnly: true });
    renderRepl({ readOnly: true, context });
    const editor = box.editor!;
    expect(editor.readOnly()).toBe(true);
    perfKey(editor.view.contentDOM);
    expect($('[data-performance-strip]')).not.toBeNull();
    expect(editor.readOnly()).toBe(true);
    expect(editor.view.contentDOM.getAttribute('contenteditable')).toBe('false');
    expect(context.init).toHaveBeenCalledTimes(1);
  });

  it('an editable REPL stays editable in the view (no lock)', () => {
    const { context, box } = contextWithEditor();
    renderRepl({ context });
    act(() => store.openPerformance());
    expect(box.editor!.readOnly()).toBe(false);
    expect(box.editor!.view.contentDOM.getAttribute('contenteditable')).toBe('true');
  });
});

describe('030 §2.2 the view font size is its own', () => {
  beforeEach(() => setViewport(1440, 900));

  it('A+ three times: 40 px in the view, still 40 after a reload, and the normal fontSize setting unchanged', () => {
    const normal = settingsMap.get().fontSize;
    renderRepl();
    act(() => store.openPerformance());
    for (let i = 0; i < 3; i++) act(() => $<HTMLButtonElement>('[data-perf-bigger]')!.click());
    expect(replRoot().style.getPropertyValue('--perf-font-size')).toBe('40px');
    expect(settingsMap.get().fontSize).toBe(normal);
    // "Reload": the view is not remembered, the size is.
    act(() => root!.unmount());
    container!.remove();
    store.performanceOpen.set(false);
    renderRepl();
    expect(replRoot().getAttribute('data-performance')).toBeNull();
    act(() => store.openPerformance());
    expect($('[data-perf-font-size]')!.textContent).toBe('40');
    expect(replRoot().style.getPropertyValue('--perf-font-size')).toBe('40px');
    expect(settingsMap.get().fontSize).toBe(normal);
  });

  it('the size applies only under the open view (Repl.css scopes it to data-performance)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(__dirname, '../../Repl.css'), 'utf8');
    const uses = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .filter((rule) => rule.includes('--perf-font-size'));
    expect(uses.length).toBeGreaterThan(0);
    for (const rule of uses) expect(rule.trim().startsWith("[data-performance='true']")).toBe(true);
    renderRepl();
    expect(replRoot().getAttribute('data-performance')).toBeNull();
  });
});

describe('030 §2.3 the clocks count whether or not the view is open', () => {
  let now = 0;
  beforeEach(() => {
    setViewport(1440, 900);
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const advance = (ms: number) => {
    for (let left = ms; left > 0; left -= 250) {
      now += 250;
      act(() => vi.advanceTimersByTime(250));
    }
  };

  it('90 s of play with the view closed: opening it shows set time 1:30', () => {
    renderRepl({ context: makeContext({ started: true }) });
    advance(90_000);
    expect(store.performanceOpen.get()).toBe(false);
    expect(clock.formatClock(clock.clockStore.get().setMs)).toBe('1:30');
    act(() => store.openPerformance());
    expect($('[data-perf-set-time-value]')!.textContent).toBe('1:30');
  });

  it('stopped: nothing counts, open or closed', () => {
    renderRepl({ context: makeContext({ started: false }) });
    advance(30_000);
    act(() => store.openPerformance());
    advance(30_000);
    expect($('[data-perf-set-time-value]')!.textContent).toBe('0:00');
    expect($('[data-perf-track-time-value]')!.textContent).toBe('0:00');
  });
});

describe('030 §2.5 the close-tab guard ignores the headphone preview', () => {
  beforeEach(() => setViewport(1440, 900));
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('only the preview playing (main scheduler stopped): not cancelled', () => {
    started = false;
    renderRepl({ context: makeContext({ isPreviewing: true, started: false }) });
    expect(unload()).toBe(false);
  });

  it('the main output playing while previewing: cancelled', () => {
    started = true;
    renderRepl({ context: makeContext({ isPreviewing: true, started: true }) });
    expect(unload()).toBe(true);
  });
});
