/**
 * Global Save Manager: what the page does with unsaved text as it goes away.
 *
 * It asks the file manager, through getters, because the hook and its state change on every render
 * and this is registered once. The open track is the file manager's selected track, not anything read
 * from the URL: a URL holds slugs and folders, and tracks are keyed by id.
 *
 * Everything here is synchronous up to the request: nothing after an await is sure to run on unload.
 */

import { flushTrackConflictDraft, hasOpenTrackConflict } from './trackConflict';

/** The part of the file manager hook this needs. Absent when signed out, on the embed page. */
export interface UnloadSaver {
  hasUnsavedEdits?: () => boolean;
  /**
   * Sends what can be sent and keeps a local copy. True if the text is safe either way. `leaving`: the
   * page is going, so a save answered from here on says nothing the next page doesn't need to know.
   */
  saveForUnload?: (options?: { leaving?: boolean }) => boolean;
  /** Resolves when the last such save has been answered. */
  unloadSaveSettled?: () => Promise<void>;
}

type Getter = () => UnloadSaver | null | undefined;

class GlobalSaveManager {
  private getFileManager: Getter | null = null;

  /** Register once, with a getter for the current file manager hook. */
  register(getFileManager: Getter) {
    this.getFileManager = getFileManager;
  }

  unregister() {
    this.getFileManager = null;
  }

  hasUnsavedChanges(): boolean {
    // A conflict's text is in its draft, and must not be saved over the other version.
    if (hasOpenTrackConflict()) return false;
    try {
      return this.getFileManager?.()?.hasUnsavedEdits?.() ?? false;
    } catch (error: unknown) {
      console.error('GlobalSaveManager: Error checking unsaved changes:', error);
      return false;
    }
  }

  /** True when nothing is at risk. Safe to call more than once for one page exit. */
  protectUnsavedWork({ leaving = false }: { leaving?: boolean } = {}): boolean {
    flushTrackConflictDraft();
    if (hasOpenTrackConflict()) return true;
    try {
      return this.getFileManager?.()?.saveForUnload?.({ leaving }) ?? true;
    } catch (error: unknown) {
      console.error('GlobalSaveManager: Could not protect unsaved work:', error);
      return false;
    }
  }

  /** For a sign-out, which outlives the save: resolves when it's answered, or after `timeoutMs`. */
  async unloadSaveSettled(timeoutMs = 2000): Promise<void> {
    const settled = this.getFileManager?.()?.unloadSaveSettled?.();
    if (settled) await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  }

  getStatus() {
    return {
      isRegistered: !!this.getFileManager,
      hasUnsavedChanges: this.hasUnsavedChanges(),
    };
  }
}

export const globalSaveManager = new GlobalSaveManager();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    // The browser's "leave this page?" only when the text is truly at risk, not on every reload.
    if (!globalSaveManager.protectUnsavedWork({ leaving: true })) {
      event.preventDefault();
      event.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    }
  });
  window.addEventListener('pagehide', () => {
    globalSaveManager.protectUnsavedWork({ leaving: true });
  });
  document.addEventListener('visibilitychange', () => {
    flushTrackConflictDraft();
    if (document.visibilityState === 'hidden') globalSaveManager.protectUnsavedWork();
  });
}
