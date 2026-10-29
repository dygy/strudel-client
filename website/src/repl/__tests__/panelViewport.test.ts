/**
 * Mobile menu panel: on a phone the settings panel must not swallow the editor, must stay
 * closable, must not open by itself on load, and hover mode must not trap touch users.
 */
import { describe, expect, it } from 'vitest';
import {
  INITIAL_PANEL_SESSION,
  clampPanelWidth,
  effectivePanelLayout,
  isCompactViewport,
  overridesAfterClosePanel,
  overridesAfterCloseFiles,
  overridesAfterLoad,
  overridesAfterOpenFiles,
  overridesAfterOpenPanel,
  readPanelViewport,
  resolvePanelTrigger,
  type PanelTrigger,
} from '../components/panel/panelViewport';

describe('isCompactViewport', () => {
  it('treats phones in portrait as compact', () => {
    expect(isCompactViewport({ width: 390, height: 844 })).toBe(true);
    expect(isCompactViewport({ width: 360, height: 640 })).toBe(true);
    expect(isCompactViewport({ width: 767, height: 1024 })).toBe(true);
  });

  it('treats phones in landscape (short and narrower than a desktop) as compact', () => {
    expect(isCompactViewport({ width: 844, height: 390 })).toBe(true);
    expect(isCompactViewport({ width: 932, height: 430 })).toBe(true);
  });

  it('treats tablets in portrait (600px panel would leave ~220px of code) as compact', () => {
    expect(isCompactViewport({ width: 820, height: 1180 })).toBe(true);
    expect(isCompactViewport({ width: 768, height: 1024 })).toBe(true);
  });

  it('keeps landscape tablets and desktops on the side-by-side layout', () => {
    expect(isCompactViewport({ width: 1024, height: 768 })).toBe(false);
    expect(isCompactViewport({ width: 1180, height: 820 })).toBe(false);
    expect(isCompactViewport({ width: 900, height: 700 })).toBe(false);
    // 1024px and wider is never compact, even in portrait.
    expect(isCompactViewport({ width: 1080, height: 1920 })).toBe(false);
    expect(isCompactViewport({ width: 1440, height: 900 })).toBe(false);
    // A short but wide desktop window is not a phone.
    expect(isCompactViewport({ width: 1440, height: 450 })).toBe(false);
  });
});

describe('resolvePanelTrigger', () => {
  // The full truth table: only a desktop with a real hover keeps hover mode. Every row is
  // checked, so neither "return trigger" nor "always click" can pass.
  const rows: Array<[PanelTrigger, boolean, boolean, PanelTrigger]> = [
    // trigger, canHover, compact, expected
    ['hover', true, false, 'hover'],
    ['hover', false, false, 'click'], // touch: mouseleave never fires
    ['hover', true, true, 'click'], // compact: the sheet needs its close button
    ['hover', false, true, 'click'],
    ['click', true, false, 'click'],
    ['click', false, false, 'click'],
    ['click', true, true, 'click'],
    ['click', false, true, 'click'],
  ];
  it.each(rows)('%s with canHover=%s compact=%s resolves to %s', (trigger, canHover, compact, expected) => {
    expect(resolvePanelTrigger(trigger, { canHover, compact })).toBe(expected);
  });
});

describe('session-only panel overrides', () => {
  const persisted = (isPanelOpen: boolean, isFileManagerOpen = false) => ({ isPanelOpen, isFileManagerOpen });

  it('hides a persisted-open panel on a compact page load without touching the persisted value', () => {
    const o = overridesAfterLoad(INITIAL_PANEL_SESSION, { compact: true, isPanelOpen: true });
    expect(o.panelHidden).toBe(true);
    expect(effectivePanelLayout(persisted(true), o, true).panelOpen).toBe(false);
  });

  it('the load hide only applies while compact (a wide tab or a devtools reset shows the real choice)', () => {
    const o = overridesAfterLoad(INITIAL_PANEL_SESSION, { compact: true, isPanelOpen: true });
    expect(effectivePanelLayout(persisted(true), o, false).panelOpen).toBe(true);
  });

  it('leaves a desktop load alone', () => {
    const o = overridesAfterLoad(INITIAL_PANEL_SESSION, { compact: false, isPanelOpen: true });
    expect(o.panelHidden).toBe(false);
    expect(effectivePanelLayout(persisted(true), o, false).panelOpen).toBe(true);
  });

  it('runs once per page load', () => {
    const once = overridesAfterLoad(INITIAL_PANEL_SESSION, { compact: false, isPanelOpen: true });
    expect(overridesAfterLoad(once, { compact: true, isPanelOpen: true })).toBe(once);
  });

  it('opening the panel clears the load hide', () => {
    const loaded = overridesAfterLoad(INITIAL_PANEL_SESSION, { compact: true, isPanelOpen: true });
    const opened = overridesAfterOpenPanel(loaded, true);
    expect(effectivePanelLayout(persisted(true), opened, true).panelOpen).toBe(true);
    expect(overridesAfterClosePanel(opened).panelHidden).toBe(false);
  });

  it('on a phone the panel sheet and the file sidebar are mutually exclusive', () => {
    const both = persisted(true, true);
    const panelFirst = overridesAfterOpenPanel(INITIAL_PANEL_SESSION, true);
    expect(effectivePanelLayout(both, panelFirst, true)).toEqual({ panelOpen: true, filesOpen: false });
    const filesNext = overridesAfterOpenFiles(panelFirst, true);
    expect(effectivePanelLayout(both, filesNext, true)).toEqual({ panelOpen: false, filesOpen: true });
    expect(overridesAfterCloseFiles(filesNext).filesHidden).toBe(false);
  });

  it('on a desktop both stay open side by side', () => {
    const both = persisted(true, true);
    const o = overridesAfterOpenFiles(overridesAfterOpenPanel(INITIAL_PANEL_SESSION, false), false);
    expect(effectivePanelLayout(both, o, false)).toEqual({ panelOpen: true, filesOpen: true });
  });
});

describe('clampPanelWidth', () => {
  it('keeps the 600px desktop default on a wide screen', () => {
    expect(clampPanelWidth(600, 1440, 400)).toBe(600);
  });

  it('never lets the panel take more than 80% of the viewport', () => {
    expect(clampPanelWidth(1100, 1024, 400)).toBe(819.2);
    expect(clampPanelWidth(2000, 2000, 400)).toBe(1200);
  });

  it('never goes below the minimum width', () => {
    expect(clampPanelWidth(100, 1440, 400)).toBe(400);
  });
});

describe('readPanelViewport', () => {
  const fakeWindow = (width: number, height: number, hover: boolean) =>
    ({
      innerWidth: width,
      innerHeight: height,
      matchMedia: (query: string) => ({ matches: query === '(hover: hover)' ? hover : false }),
    }) as unknown as Window;

  it('reports the desktop layout when there is no window (SSR / prerender)', () => {
    expect(readPanelViewport(undefined)).toEqual({ compact: false, canHover: true, viewportWidth: 1440 });
  });

  it('reads size and hover capability from the window', () => {
    expect(readPanelViewport(fakeWindow(390, 844, false))).toEqual({
      compact: true,
      canHover: false,
      viewportWidth: 390,
    });
    expect(readPanelViewport(fakeWindow(1440, 900, true))).toEqual({
      compact: false,
      canHover: true,
      viewportWidth: 1440,
    });
  });
});
