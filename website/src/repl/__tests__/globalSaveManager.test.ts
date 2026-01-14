/**
 * Tests for Global Save Manager - URL-Based Version
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock window.location for URL-based tests
const mockLocation = {
  pathname: '/repl/track-1',
  search: '',
  href: 'http://localhost/repl/track-1'
};

// Mock the global save manager by importing it after setting up mocks
const mockFileManagerHook = {
  selectedTrack: 'track-1', // This is now ignored in favor of URL
  tracks: {
    'track-1': {
      id: 'track-1',
      name: 'Test Track',
      code: '// original code'
    }
  },
  saveCurrentTrack: vi.fn(),
  saveSpecificTrack: vi.fn()
};

const mockContext = {
  editorRef: {
    current: {
      code: '// modified code'
    }
  },
  activeCode: '// modified code'
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
          code: '// original code'
        }
      }
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
          code: ''
        }
      }
    };
    
    globalSaveManager.register(mockFileManagerHook, noCodeContext);
    
    expect(globalSaveManager.hasUnsavedChanges()).toBe(false);
  });

  it('should prevent concurrent saves', async () => {
    // Set URL to track-1
    window.location.pathname = '/repl/track-1';
    
    mockFileManagerHook.saveSpecificTrack.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve(true), 100))
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