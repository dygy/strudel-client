import { useEffect, useLayoutEffect } from 'react';
import { map } from 'nanostores';
import { useStore } from '@nanostores/react';
import { setIsFileManagerOpen, setIsPanelOpened, useSettings } from '@src/settings';
import {
  INITIAL_PANEL_SESSION,
  effectivePanelLayout,
  overridesAfterClosePanel,
  overridesAfterCloseFiles,
  overridesAfterLoad,
  overridesAfterOpenFiles,
  overridesAfterOpenPanel,
  overridesAfterSelectTrack,
  resetStableViewportSize,
  usePanelViewport,
  type PanelSessionOverrides,
  type PanelViewport,
} from './panelViewport';

export { CONTROL_BAR_HEIGHT, CONTROL_BAR_HEIGHT_SHORT, isCompactViewport } from './panelViewport';

/** Session-only panel/sidebar hides for compact viewports. In memory, never persisted. */
export const panelSession = map<PanelSessionOverrides>({ ...INITIAL_PANEL_SESSION });

/** Test hook: forget the page-load check, any session hides and the last stable viewport size. */
export function resetPanelSession(): void {
  panelSession.set({ ...INITIAL_PANEL_SESSION });
  resetStableViewportSize();
}

/** An explicit user open: persisted, and clears any session hide. */
export function openPanel(compact: boolean): void {
  panelSession.set(overridesAfterOpenPanel(panelSession.get(), compact));
  setIsPanelOpened(true);
}

/** An explicit user close: persisted. */
export function closePanel(): void {
  panelSession.set(overridesAfterClosePanel(panelSession.get()));
  setIsPanelOpened(false);
}

export function openFileManager(compact: boolean): void {
  panelSession.set(overridesAfterOpenFiles(panelSession.get(), compact));
  setIsFileManagerOpen(true);
}

export function closeFileManager(): void {
  panelSession.set(overridesAfterCloseFiles(panelSession.get()));
  setIsFileManagerOpen(false);
}

/**
 * Hide the library drawer on a compact screen after a track is picked, or when the drawer is
 * dismissed (close button, backdrop, swipe). Session-only: the persisted `isFileManagerOpen`
 * keeps the wide-screen choice. A no-op on wide screens, where the sidebar stays as it is.
 */
export function closeFileManagerAfterSelect(compact: boolean): void {
  const current = panelSession.get();
  const next = overridesAfterSelectTrack(current, compact);
  if (next !== current) panelSession.set(next);
}

// useLayoutEffect warns during SSR; the panel renders client-only, but stay safe.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface PanelLayout extends PanelViewport {
  /** Whether the panel is shown (persisted choice minus compact session hides). */
  panelOpen: boolean;
  /** Whether the file sidebar is shown. */
  filesOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /** Desktop: persisted open/close. Compact: opens persisted, closes session-only (drawer). */
  toggleFileManager: () => void;
}

/** Shared by the panels, the header's files toggle and the editor layout. */
export function usePanelLayout(): PanelLayout {
  const { isPanelOpen, isFileManagerOpen } = useSettings();
  const viewport = usePanelViewport();
  const overrides = useStore(panelSession);
  const { compact } = viewport;

  // Before the first paint of the page load, so a phone never flashes the sheet.
  useIsomorphicLayoutEffect(() => {
    const current = panelSession.get();
    const next = overridesAfterLoad(current, { compact, isPanelOpen, isFileManagerOpen });
    if (next !== current) panelSession.set(next);
  }, []);

  const { panelOpen, filesOpen } = effectivePanelLayout({ isPanelOpen, isFileManagerOpen }, overrides, compact);

  return {
    ...viewport,
    panelOpen,
    filesOpen,
    openPanel: () => openPanel(compact),
    closePanel,
    toggleFileManager: () => {
      if (!filesOpen) openFileManager(compact);
      else if (compact) closeFileManagerAfterSelect(true);
      else closeFileManager();
    },
  };
}
