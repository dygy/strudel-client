import { useEffect, useState } from 'react';

/**
 * Narrow-viewport decisions for the menu panel, kept pure so they can be unit tested.
 *
 * Below 768px (Tailwind `md`) the desktop panel (600px default, 400px minimum) cannot sit next
 * to the editor without squeezing it to nothing, so the panel becomes a full-width overlay sheet.
 * Between 768 and 1023px the side-by-side layout only works on a landscape screen with room to
 * spare: a phone in landscape (e.g. 844x390, too short) and a tablet in portrait (e.g. 820x1180,
 * 600px panel leaves ~220px of code, less with the file sidebar open) are compact too. Windows
 * 1024px and wider are never compact, so the desktop layout is untouched.
 */
export const COMPACT_MAX_WIDTH = 768;
export const COMPACT_LANDSCAPE_MAX_HEIGHT = 500;
export const COMPACT_LANDSCAPE_MAX_WIDTH = 1024;

/** Height (px) of the compact bottom control bar; 44px buttons plus padding (spec 016). */
export const CONTROL_BAR_HEIGHT = 56;
/**
 * On a phone held sideways (shorter than COMPACT_LANDSCAPE_MAX_HEIGHT) the bar is 48px, so the
 * 44px title bar plus the bar stay within 25% of a 390px-tall screen (spec 016 2.4).
 */
export const CONTROL_BAR_HEIGHT_SHORT = 48;

export interface ViewportSize {
  width: number;
  height: number;
}

export function isCompactViewport({ width, height }: ViewportSize): boolean {
  if (width < COMPACT_MAX_WIDTH) return true;
  if (width >= COMPACT_LANDSCAPE_MAX_WIDTH) return false;
  const shortLandscape = height < COMPACT_LANDSCAPE_MAX_HEIGHT;
  const portrait = height > width;
  return shortLandscape || portrait;
}

export type PanelTrigger = 'click' | 'hover';

/**
 * Hover-to-open needs a real hover: on touch devices `mouseleave` never fires, and the hover mode
 * only offers a pin (no close). Without hover, or on a compact viewport, it behaves like click.
 */
export function resolvePanelTrigger(
  trigger: PanelTrigger,
  { canHover, compact }: { canHover: boolean; compact: boolean },
): PanelTrigger {
  return trigger === 'hover' && canHover && !compact ? 'hover' : 'click';
}

/**
 * Session-only (never persisted) hides used on compact viewports. The persisted settings keep the
 * user's real choice, so a phone tab or a devtools device-mode reload never changes what a wide
 * desktop tab shows (@nanostores/persistent syncs settings across tabs).
 * - panelHidden: the panel was hidden by the compact page load, or by opening the file sidebar.
 * - filesHidden: the file sidebar was hidden because the panel sheet was opened over it.
 * Both only apply while the viewport is compact.
 */
export interface PanelSessionOverrides {
  panelHidden: boolean;
  filesHidden: boolean;
  loadChecked: boolean;
}

export const INITIAL_PANEL_SESSION: PanelSessionOverrides = {
  panelHidden: false,
  filesHidden: false,
  loadChecked: false,
};

export interface PersistedPanelState {
  isPanelOpen: boolean;
  isFileManagerOpen: boolean;
}

/** What is actually shown, given the persisted choice, the session hides and the viewport. */
export function effectivePanelLayout(
  persisted: PersistedPanelState,
  overrides: PanelSessionOverrides,
  compact: boolean,
): { panelOpen: boolean; filesOpen: boolean } {
  return {
    panelOpen: persisted.isPanelOpen && !(compact && overrides.panelHidden),
    filesOpen: persisted.isFileManagerOpen && !(compact && overrides.filesHidden),
  };
}

/**
 * Once per page load: on a phone neither the panel nor the library drawer opens by itself,
 * whatever was persisted (the persisted choice is kept for wide screens).
 */
export function overridesAfterLoad(
  overrides: PanelSessionOverrides,
  {
    compact,
    isPanelOpen,
    isFileManagerOpen = false,
  }: { compact: boolean; isPanelOpen: boolean; isFileManagerOpen?: boolean },
): PanelSessionOverrides {
  if (overrides.loadChecked) return overrides;
  return {
    ...overrides,
    loadChecked: true,
    panelHidden: overrides.panelHidden || (compact && isPanelOpen),
    filesHidden: overrides.filesHidden || (compact && isFileManagerOpen),
  };
}

/**
 * A single track was picked in the library (or the drawer was dismissed): on a phone the drawer
 * gets out of the way so the code shows. Session-only; on a wide screen nothing changes.
 */
export function overridesAfterSelectTrack(overrides: PanelSessionOverrides, compact: boolean): PanelSessionOverrides {
  return compact ? { ...overrides, filesHidden: true } : overrides;
}

/** The user opened the panel: it shows; on a phone the sheet hides the file sidebar for now. */
export function overridesAfterOpenPanel(overrides: PanelSessionOverrides, compact: boolean): PanelSessionOverrides {
  return { ...overrides, panelHidden: false, filesHidden: compact ? true : overrides.filesHidden };
}

/** The user closed the panel (that choice is persisted by the caller). */
export function overridesAfterClosePanel(overrides: PanelSessionOverrides): PanelSessionOverrides {
  return { ...overrides, panelHidden: false };
}

/** The user opened the file sidebar: it shows; on a phone it hides the panel sheet for now. */
export function overridesAfterOpenFiles(overrides: PanelSessionOverrides, compact: boolean): PanelSessionOverrides {
  return { ...overrides, filesHidden: false, panelHidden: compact ? true : overrides.panelHidden };
}

/** The user closed the file sidebar (persisted by the caller). */
export function overridesAfterCloseFiles(overrides: PanelSessionOverrides): PanelSessionOverrides {
  return { ...overrides, filesHidden: false };
}

/** The rendered desktop panel width never exceeds 80% of the viewport (and 1200px). */
export function clampPanelWidth(width: number, viewportWidth: number, minWidth: number): number {
  const maxWidth = Math.max(minWidth, Math.min(1200, viewportWidth * 0.8));
  return Math.max(minWidth, Math.min(maxWidth, width));
}

export interface PanelViewport {
  compact: boolean;
  canHover: boolean;
  viewportWidth: number;
}

/** SSR has no window: report the desktop layout, the client re-reads on mount. */
const SSR_VIEWPORT: PanelViewport = { compact: false, canHover: true, viewportWidth: 1440 };

export function readPanelViewport(win: Window | undefined): PanelViewport {
  if (!win) return SSR_VIEWPORT;
  const canHover = typeof win.matchMedia === 'function' ? win.matchMedia('(hover: hover)').matches : true;
  const size = stableViewportSize(win);
  return {
    compact: isCompactViewport(size),
    canHover,
    viewportWidth: size.width,
  };
}

/** An element the on-screen keyboard opens for (text inputs, textareas, CodeMirror). */
export function isEditableElement(el: Element | null | undefined): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return !(el as HTMLTextAreaElement).readOnly;
  if (tag !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  const noKeyboard = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'];
  return !input.readOnly && !noKeyboard.includes(input.type);
}

/**
 * The size the layout class is decided from (spec 016 review #1). Opening the on-screen keyboard
 * shrinks only the height (Android with `interactive-widget=resizes-content`), and on an upright
 * tablet (768-1023 wide) that would flip portrait compact into the desktop layout, which unmounts
 * the focused input and closes the keyboard again. So while an editable element has focus, a
 * height-only shrink keeps the last stable size. Any width change (a real rotation or a window
 * resize) and any growth are taken as they come.
 */
export function nextStableSize(
  previous: ViewportSize | null,
  measured: ViewportSize,
  editableFocused: boolean,
): ViewportSize {
  if (previous && editableFocused && measured.width === previous.width && measured.height < previous.height) {
    return previous;
  }
  return measured;
}

// Shared by every usePanelViewport() instance, so a component mounted while the keyboard is open
// (the settings sheet, the drawer) gets the same class as the rest of the page.
let lastStableSize: ViewportSize | null = null;

/** Test hook: forget the last stable (non-keyboard) size. */
export function resetStableViewportSize(): void {
  lastStableSize = null;
}

function stableViewportSize(win: Window): ViewportSize {
  const measured = { width: win.innerWidth, height: win.innerHeight };
  const focused = isEditableElement(win.document?.activeElement);
  lastStableSize = nextStableSize(lastStableSize, measured, focused);
  return lastStableSize;
}

const getWindow = (): Window | undefined => (typeof window !== 'undefined' ? window : undefined);

/** Tracks the compact/hover state across resize, orientation and input-device changes. */
export function usePanelViewport(): PanelViewport {
  const [viewport, setViewport] = useState<PanelViewport>(() => readPanelViewport(getWindow()));

  useEffect(() => {
    const win = getWindow();
    if (!win) return;
    const update = () => {
      const next = readPanelViewport(win);
      setViewport((prev) =>
        prev.compact === next.compact && prev.canHover === next.canHover && prev.viewportWidth === next.viewportWidth
          ? prev
          : next,
      );
    };
    update();
    win.addEventListener('resize', update);
    win.addEventListener('orientationchange', update);
    const hoverQuery = typeof win.matchMedia === 'function' ? win.matchMedia('(hover: hover)') : null;
    hoverQuery?.addEventListener?.('change', update);
    return () => {
      win.removeEventListener('resize', update);
      win.removeEventListener('orientationchange', update);
      hoverQuery?.removeEventListener?.('change', update);
    };
  }, []);

  return viewport;
}
