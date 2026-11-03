/**
 * The page-exit handlers and what they ask of the file manager.
 * @vitest-environment jsdom
 *
 * Regression (data loss): this was keyed on the URL, and only ever worked in a test that named the
 * URL segment after a track id. `hasUnsavedChanges()` was false on every real URL, so nothing saved.
 * The real hook is in sidebar/hooks/__tests__/useSupabaseFileManager-unload.test.tsx; here it's the wiring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// isolate:false: the module attaches its page listeners when it loads, to the window of that moment,
// which may be another file's. A fresh copy listens to this file's window. Each test gets one, and
// the old copies are unregistered, so they do nothing when the events reach them too.
let globalSaveManager: typeof import('../globalSaveManager').globalSaveManager;
let createTrackConflictController: typeof import('../trackConflict').createTrackConflictController;
let setActiveTrackConflictController: typeof import('../trackConflict').setActiveTrackConflictController;
let trackConflictStore: typeof import('../trackConflict').trackConflictStore;
let createTrackVersions: typeof import('../trackVersion').createTrackVersions;

beforeEach(async () => {
  vi.resetModules();
  ({ globalSaveManager } = await import('../globalSaveManager'));
  ({ createTrackConflictController, setActiveTrackConflictController, trackConflictStore } =
    await import('../trackConflict'));
  ({ createTrackVersions } = await import('../trackVersion'));
});

const saver = (overrides = {}) => ({ hasUnsavedEdits: () => true, saveForUnload: vi.fn(() => true), ...overrides });

afterEach(() => {
  globalSaveManager.unregister();
  setActiveTrackConflictController(null);
  trackConflictStore.set(null);
});

describe('GlobalSaveManager', () => {
  it('reads the file manager through its getter, so it never sees an old hook', () => {
    let current = saver({ hasUnsavedEdits: () => false });
    globalSaveManager.register(() => current);
    expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
    current = saver();
    expect(globalSaveManager.hasUnsavedChanges()).toBe(true);
    expect(globalSaveManager.protectUnsavedWork()).toBe(true);
    expect(current.saveForUnload).toHaveBeenCalledOnce();
  });

  it('with nothing registered (embed) or no saver (signed out) nothing is at risk', () => {
    expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
    expect(globalSaveManager.protectUnsavedWork()).toBe(true);
    globalSaveManager.register(() => ({}));
    expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
    expect(globalSaveManager.protectUnsavedWork()).toBe(true);
    globalSaveManager.register(() => null);
    expect(globalSaveManager.protectUnsavedWork()).toBe(true);
  });

  it('reports the work at risk if protecting it throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    globalSaveManager.register(() =>
      saver({
        saveForUnload: () => {
          throw new Error('boom');
        },
      }),
    );
    expect(globalSaveManager.protectUnsavedWork()).toBe(false);
    vi.restoreAllMocks();
  });

  describe('the page events', () => {
    const fire = (name: string, target: EventTarget = window) => {
      const event = new Event(name, { cancelable: true });
      target.dispatchEvent(event);
      return event;
    };

    it('pagehide protects the work, and says the page is leaving', () => {
      const current = saver();
      globalSaveManager.register(() => current);
      fire('pagehide');
      expect(current.saveForUnload).toHaveBeenCalledWith({ leaving: true });
    });

    it('visibilitychange protects it when hidden, and not when visible', () => {
      const current = saver();
      globalSaveManager.register(() => current);
      const state = vi.spyOn(document, 'visibilityState', 'get');
      state.mockReturnValue('visible');
      fire('visibilitychange', document);
      expect(current.saveForUnload).not.toHaveBeenCalled();
      state.mockReturnValue('hidden');
      fire('visibilitychange', document);
      expect(current.saveForUnload).toHaveBeenCalledWith({ leaving: false });
      state.mockRestore();
    });

    it('beforeunload asks nothing when the text is safe', () => {
      globalSaveManager.register(() => saver());
      expect(fire('beforeunload').defaultPrevented).toBe(false);
    });

    it('beforeunload asks the user only when it could not be kept anywhere', () => {
      globalSaveManager.register(() => saver({ saveForUnload: () => false }));
      expect(fire('beforeunload').defaultPrevented).toBe(true);
    });
  });

  describe('during a track conflict (spec 018)', () => {
    function openConflict() {
      const versions = createTrackVersions();
      versions.setOpenTrack('track-1');
      const storage = new Map<string, string>();
      const controller = createTrackConflictController({
        userId: 'u1',
        tabId: 'tab-1',
        versions,
        storage: {
          getItem: (k: string) => storage.get(k) ?? null,
          setItem: (k: string, v: string) => void storage.set(k, v),
          removeItem: (k: string) => void storage.delete(k),
          key: (i: number) => [...storage.keys()][i] ?? null,
          get length() {
            return storage.size;
          },
        },
        readVersion: async () => ({ status: 'unknown' }),
        readTrack: async () => ({ status: 'unknown' }),
        getEditorCode: () => '// typed during the conflict',
        getLastSavedCode: () => '// original code',
        getLocalTrack: () => ({ name: 'Test Track', folder: null, isMultitrack: false, steps: [], activeStep: 0 }),
        setEditorCode: () => {},
        showDraft: () => {},
        saveCode: async () => {},
        applySynced: () => {},
        recreate: async () => false,
        removeLocal: () => {},
      });
      setActiveTrackConflictController(controller);
      trackConflictStore.set({
        trackId: 'track-1',
        trackName: 'Test Track',
        kind: 'changed',
        busy: false,
        failed: false,
      });
      return storage;
    }

    it('protecting the work asks the file manager for nothing, and keeps the text as a draft', () => {
      const current = saver();
      globalSaveManager.register(() => current);
      const storage = openConflict();
      expect(globalSaveManager.protectUnsavedWork()).toBe(true);
      expect(current.saveForUnload).not.toHaveBeenCalled();
      expect(JSON.parse(storage.get('strudel-conflict-draft:track-1:tab-1')!).code).toBe(
        '// typed during the conflict',
      );
    });

    it('reports no unsaved changes: the draft holds them', () => {
      globalSaveManager.register(() => saver());
      openConflict();
      expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
    });
  });
});
