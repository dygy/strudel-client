// @vitest-environment jsdom
/**
 * Mobile menu panel, rendered: on a phone the panel is a closable full-width sheet that never
 * opens by itself on load (without overwriting the persisted desktop choice) and gives way to the
 * file sidebar; on a desktop it is the 600px side panel as before.
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

// The tab bodies (and repl/util, which lazy-imports every @strudel package) are not under test.
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));
vi.mock('../SettingsTab', () => ({ SettingsTab: () => <div>settings tab</div> }));
vi.mock('../SoundsTab', () => ({ SoundsTab: () => <div>sounds tab</div> }));
vi.mock('../PatternsTab', () => ({ PatternsTab: () => <div>patterns tab</div> }));
vi.mock('../WelcomeTab', () => ({ WelcomeTab: () => <div>welcome tab</div> }));
vi.mock('../EnhancedReference', () => ({ EnhancedReference: () => <div>reference tab</div> }));
vi.mock('../FilesTab', () => ({ FilesTab: () => <div>files tab</div> }));
vi.mock('../ConsoleTab', () => ({ ConsoleTab: () => <div>console tab</div> }));
vi.mock('../ShortcutsTab', () => ({ ShortcutsTab: () => <div>shortcuts tab</div> }));
vi.mock('../../useLogger', () => ({ useLogger: () => {} }));
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseBoolean, setActiveFooter, setIsFileManagerOpen, setIsPanelOpened, settingsMap } from '@src/settings';
import { VerticalPanel } from '../Panel';
import { openFileManager, resetPanelSession } from '../panelLayout';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const context = {
  started: false,
  handleTogglePlay: () => {},
  handleEvaluate: () => {},
  handleShuffle: () => {},
  handleShare: () => {},
};

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};

const persistedOpen = () => parseBoolean(settingsMap.get().isPanelOpen);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderPanel() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<VerticalPanel context={context} />));
  return container;
}

const sheet = () => container!.querySelector('[data-panel-sheet]');
const closeButton = () => container!.querySelector<HTMLButtonElement>('[data-panel-close]');
const openButton = () => container!.querySelector<HTMLButtonElement>('[data-panel-open]');
const sidePanel = () =>
  [...container!.querySelectorAll<HTMLElement>('nav')].find((nav) => nav.className.includes('flex-shrink-0'));

// Found by its glyph, not by attributes added with this fix, so the desktop tests also pass on the
// pre-fix Panel.tsx (they pin that the desktop panel did not change).
const desktopClose = () =>
  [...(sidePanel()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === '×');

const originalSize = { width: window.innerWidth, height: window.innerHeight };

beforeEach(() => {
  resetPanelSession();
  setActiveFooter('shortcuts');
  setIsPanelOpened(true);
  setIsFileManagerOpen(false);
  settingsMap.setKey('togglePanelTrigger', 'click');
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  setViewport(originalSize.width, originalSize.height);
  resetPanelSession();
});

describe('VerticalPanel on a phone (390x844)', () => {
  beforeEach(() => setViewport(390, 844));

  it('does not open on page load, and does not overwrite the persisted (desktop) choice', () => {
    renderPanel();
    expect(sheet()).toBeNull();
    expect(openButton()).not.toBeNull();
    expect(persistedOpen()).toBe(true);
  });

  it('opens as a full-width sheet with a close button, never as the 600px side panel', () => {
    renderPanel();
    act(() => openButton()!.click());
    expect(sheet()).not.toBeNull();
    expect(sidePanel()).toBeUndefined();
    expect(container!.querySelector('nav[style*="600px"]')).toBeNull();
    expect(closeButton()).not.toBeNull();
    // 44px touch target
    expect(closeButton()!.className).toMatch(/\bh-11\b/);
    expect(closeButton()!.className).toMatch(/\bw-11\b/);
  });

  it('the close button closes the sheet and the explicit close is persisted', () => {
    renderPanel();
    act(() => openButton()!.click());
    act(() => closeButton()!.click());
    expect(sheet()).toBeNull();
    expect(openButton()).not.toBeNull();
    expect(persistedOpen()).toBe(false);
  });

  it('opening the file sidebar hides the sheet for now without persisting a close', () => {
    renderPanel();
    act(() => openButton()!.click());
    expect(sheet()).not.toBeNull();
    act(() => openFileManager(true));
    expect(sheet()).toBeNull();
    expect(persistedOpen()).toBe(true);
  });

  it('hover mode on a phone still offers the close button', () => {
    settingsMap.setKey('togglePanelTrigger', 'hover');
    renderPanel();
    act(() => openButton()!.click());
    expect(closeButton()).not.toBeNull();
  });
});

describe('VerticalPanel on a tablet in portrait (820x1180)', () => {
  it('uses the sheet, not a 600px panel that leaves ~220px of code', () => {
    setViewport(820, 1180);
    renderPanel();
    act(() => openButton()!.click());
    expect(sheet()).not.toBeNull();
    expect(sidePanel()).toBeUndefined();
  });
});

describe('VerticalPanel on a desktop (1440x900)', () => {
  beforeEach(() => setViewport(1440, 900));

  it('renders the persisted-open 600px side panel on load, unchanged', () => {
    renderPanel();
    expect(sheet()).toBeNull();
    const nav = sidePanel();
    expect(nav).toBeDefined();
    expect(nav!.style.width).toBe('600px');
    expect(desktopClose()).toBeDefined();
  });

  it('after the window shrinks, dragging starts from the drawn (clamped) width', () => {
    renderPanel();
    const handle = () => container!.querySelector<HTMLElement>('.cursor-col-resize')!;
    const mouse = (type: string, target: EventTarget, clientX: number) =>
      act(() => {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX }));
      });
    // Widen to 1100px on the 1440px screen.
    mouse('mousedown', handle(), 1000);
    mouse('mousemove', document, 500);
    mouse('mouseup', document, 500);
    expect(sidePanel()!.style.width).toBe('1100px');
    // Shrink the window to 1024px: the panel is drawn at 80% = 819.2px.
    act(() => {
      setViewport(1024, 900);
      window.dispatchEvent(new Event('resize'));
    });
    expect(sidePanel()!.style.width).toBe('819.2px');
    // A 10px drag to narrow it must take effect right away (it used to start from 1100px).
    mouse('mousedown', handle(), 900);
    mouse('mousemove', document, 910);
    mouse('mouseup', document, 910);
    expect(sidePanel()!.style.width).toBe('809.2px');
  });

  it('closing it collapses to the 48px strip and persists', () => {
    renderPanel();
    act(() => desktopClose()!.click());
    expect(sidePanel()!.style.width).toBe('48px');
    expect(persistedOpen()).toBe(false);
  });
});
