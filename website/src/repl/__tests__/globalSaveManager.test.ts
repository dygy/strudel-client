/**
 * Tests for Global Save Manager - URL-Based Version
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock window.location for URL-based tests
const mockLocation = {
  pathname: '/repl/track-1',
  search: '',
  href: 'http://localhost/repl/track-1',
};

// Mock the global save manager by importing it after setting up mocks
const mockFileManagerHook = {
  selectedTrack: 'track-1', // This is now ignored in favor of URL
  tracks: {
    'track-1': {
      id: 'track-1',
      name: 'Test Track',
      code: '// original code',
    },
  },
  saveCurrentTrack: vi.fn(),
  saveSpecificTrack: vi.fn(),
};

const mockContext = {
  editorRef: {
    current: {
      code: '// modified code',
    },
  },
  activeCode: '// modified code',
};

describe('GlobalSaveManager', () => {
  let globalSaveManager: any;
  let originalLocation: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock window.location
    originalLocation = window.location;
    delete (window as any).location;
    window.location = mockLocation as any;

    // Reset the module
    vi.resetModules();

    // Import after mocks are set up
    const module = await import('../globalSaveManager');
    globalSaveManager = module.globalSaveManager;

    // Reset the manager state
    globalSaveManager.unregister();
  });

  afterEach(() => {
    globalSaveManager.unregister();

    // Restore window.location
    window.location = originalLocation;
  });

  it('should detect unsaved changes', () => {
    // Set URL to track-1
    window.location.pathname = '/repl/track-1';

    globalSaveManager.register(mockFileManagerHook, mockContext);

    expect(globalSaveManager.hasUnsavedChanges()).toBe(true);
  });

  it('should not detect changes when code is the same', () => {
    // Set URL to track-1
    window.location.pathname = '/repl/track-1';

    const sameCodeContext = {
      editorRef: {
        current: {
          code: '// original code',
        },
      },
    };

    globalSaveManager.register(mockFileManagerHook, sameCodeContext);

    expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
  });

  it('should perform emergency save successfully', async () => {
    // Set URL to track-1
    window.location.pathname = '/repl/track-1';

    mockFileManagerHook.saveSpecificTrack.mockResolvedValue(true);

    globalSaveManager.register(mockFileManagerHook, mockContext);

    const result = await globalSaveManager.performEmergencySave();

    expect(result).toBe(true);
    expect(mockFileManagerHook.saveSpecificTrack).toHaveBeenCalledWith('track-1', false);
  });

  it('should handle save failure gracefully', async () => {
    // Set URL to track-1
    window.location.pathname = '/repl/track-1';

    mockFileManagerHook.saveSpecificTrack.mockResolvedValue(false);

    globalSaveManager.register(mockFileManagerHook, mockContext);

    const result = await globalSaveManager.performEmergencySave();

    expect(result).toBe(false);
    expect(mockFileManagerHook.saveSpecificTrack).toHaveBeenCalledWith('track-1', false);
  });

  it('should return false when not registered', async () => {
    const result = await globalSaveManager.performEmergencySave();

    expect(result).toBe(false);
  });

  it('should provide correct status', () => {
    // Not registered
    let status = globalSaveManager.getStatus();
    expect(status.isRegistered).toBe(false);
    expect(status.hasUnsavedChanges).toBe(false);

    // Registered with URL track
    window.location.pathname = '/repl/track-1';
    globalSaveManager.register(mockFileManagerHook, mockContext);
    status = globalSaveManager.getStatus();
    expect(status.isRegistered).toBe(true);
    expect(status.hasUnsavedChanges).toBe(true);
    expect(status.currentTrackId).toBe('track-1');
    expect(status.source).toBe('URL-based');
  });

  it('should handle missing track gracefully', () => {
    // Set URL to non-existent track
    window.location.pathname = '/repl/non-existent-track';

    globalSaveManager.register(mockFileManagerHook, mockContext);

    expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
  });

  it('should handle missing code gracefully', () => {
    // Set URL to track-1
    window.location.pathname = '/repl/track-1';

    const noCodeContext = {
      editorRef: {
        current: {
          code: '',
        },
      },
    };

    globalSaveManager.register(mockFileManagerHook, noCodeContext);

    expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
  });

  describe('during a track conflict (spec 018)', () => {
    /** A conflict open on the track in the editor, through the same module the manager reads. */
    async function openConflict() {
      const { createTrackConflictController, setActiveTrackConflictController, trackConflictStore } =
        await import('../trackConflict');
      const { createTrackVersions } = await import('../trackVersion');
      const versions = createTrackVersions();
      versions.setOpenTrack('track-1');
      const storage = new Map<string, string>();
      const controller = createTrackConflictController({
        userId: 'u1',
        versions,
        storage: {
          getItem: (k: string) => storage.get(k) ?? null,
          setItem: (k: string, v: string) => void storage.set(k, v),
          removeItem: (k: string) => void storage.delete(k),
          key: () => null,
          length: 0,
        },
        readVersion: async () => ({ status: 'unknown' }),
        readTrack: async () => ({ status: 'unknown' }),
        getEditorCode: () => '// typed during the conflict',
        getLastSavedCode: () => '// original code',
        getLocalTrack: () => ({ name: 'Test Track', folder: null, isMultitrack: false, steps: [], activeStep: 0 }),
        setEditorCode: () => {},
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
        restored: false,
        busy: false,
        failed: false,
      });
      return {
        storage,
        cleanup: () => {
          setActiveTrackConflictController(null);
          trackConflictStore.set(null);
        },
      };
    }

    it('an emergency save writes nothing to the server, and keeps the text as a draft', async () => {
      window.location.pathname = '/repl/track-1';
      globalSaveManager.register(mockFileManagerHook, mockContext);
      const { storage, cleanup } = await openConflict();

      await expect(globalSaveManager.performEmergencySave()).resolves.toBe(true);

      expect(mockFileManagerHook.saveSpecificTrack).not.toHaveBeenCalled();
      expect(mockFileManagerHook.saveCurrentTrack).not.toHaveBeenCalled();
      expect(JSON.parse(storage.get('strudel-conflict-draft:track-1')!).code).toBe('// typed during the conflict');
      cleanup();
    });

    it('reports no unsaved changes: the draft holds them, so leaving asks nothing', async () => {
      window.location.pathname = '/repl/track-1';
      globalSaveManager.register(mockFileManagerHook, mockContext);
      const { cleanup } = await openConflict();
      expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
      cleanup();
      expect(globalSaveManager.hasUnsavedChanges()).toBe(true);
    });

    it('leaving the page stores the draft, even though no save would run', async () => {
      window.location.pathname = '/repl/track-1';
      globalSaveManager.register(mockFileManagerHook, mockContext);
      const { storage, cleanup } = await openConflict();
      window.dispatchEvent(new Event('pagehide'));
      expect(storage.get('strudel-conflict-draft:track-1')).toBeDefined();
      expect(mockFileManagerHook.saveSpecificTrack).not.toHaveBeenCalled();
      cleanup();
    });
  });

  it('should prevent concurrent saves', async () => {
    // Set URL to track-1
    window.location.pathname = '/repl/track-1';

    mockFileManagerHook.saveSpecificTrack.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(true), 100)),
    );

    globalSaveManager.register(mockFileManagerHook, mockContext);

    // Start two saves concurrently
    const save1 = globalSaveManager.performEmergencySave();
    const save2 = globalSaveManager.performEmergencySave();

    const [result1, result2] = await Promise.all([save1, save2]);

    // Only one should succeed (the first one)
    expect(result1).toBe(true);
    expect(result2).toBe(false);
    expect(mockFileManagerHook.saveSpecificTrack).toHaveBeenCalledTimes(1);
  });
});
