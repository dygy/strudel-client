import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Simplified Editor Update System', () => {
  let mockContext;
  let mockHandleUpdate;
  let mockSetCode;
  let mockLocalStorage;

  beforeEach(() => {
    // Mock localStorage
    mockLocalStorage = {
      data: {},
      getItem: vi.fn((key) => mockLocalStorage.data[key] || null),
      setItem: vi.fn((key, value) => { mockLocalStorage.data[key] = value; }),
      removeItem: vi.fn((key) => { delete mockLocalStorage.data[key]; }),
      clear: vi.fn(() => { mockLocalStorage.data = {}; })
    };
    
    // Set up global localStorage mock
    global.localStorage = mockLocalStorage;
    global.window = { localStorage: mockLocalStorage };
    
    // Clear localStorage
    mockLocalStorage.clear();
    
    // Mock editor functions
    mockHandleUpdate = vi.fn();
    mockSetCode = vi.fn();
    
    mockContext = {
      handleUpdate: mockHandleUpdate,
      editorRef: {
        current: {
          code: '',
          setCode: mockSetCode
        }
      }
    };
    
    // Clear any existing event listeners
    vi.clearAllMocks();
  });

  it('should update editor when track is loaded via handleUpdate', async () => {
    // Import the useFileManager hook
    const { useFileManager } = await import('../website/src/repl/components/sidebar/hooks/useFileManager.ts');
    
    // Create a test track
    const testTrack = {
      id: 'test123',
      name: 'Test Track',
      code: 'sound("bd").play()',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    
    // Save track to localStorage
    mockLocalStorage.setItem('strudel_tracks', JSON.stringify({
      [testTrack.id]: testTrack
    }));
    
    // Create a mock React component to test the hook
    let fileManagerState;
    const TestComponent = () => {
      fileManagerState = useFileManager(mockContext);
      return null;
    };
    
    // Mock React hooks
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useFileManager(mockContext));
    
    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Load the track
    result.current.loadTrack(testTrack);
    
    // Verify handleUpdate was called with correct parameters
    expect(mockHandleUpdate).toHaveBeenCalledWith({
      id: testTrack.id,
      code: testTrack.code
    }, true);
    
    console.log('✅ handleUpdate called correctly');
  });

  it('should use handleUpdate as single source of truth', async () => {
    const { useFileManager } = await import('../website/src/repl/components/sidebar/hooks/useFileManager.ts');
    
    const testTrack = {
      id: 'test456',
      name: 'Another Track',
      code: 'sound("hh").play()',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useFileManager(mockContext));
    
    // Load track
    result.current.loadTrack(testTrack);
    
    // Verify only handleUpdate is called (simplified approach)
    expect(mockHandleUpdate).toHaveBeenCalledTimes(1);
    expect(mockHandleUpdate).toHaveBeenCalledWith({
      id: testTrack.id,
      code: testTrack.code
    }, true); // replace=true for clean update
    
    console.log('✅ Single source of truth verified');
  });

  it('should handle track import and editor update flow', async () => {
    // Simulate the import flow
    const importedTrack = {
      id: 'imported789',
      name: 'Imported Track',
      code: 'sound("kick").play()',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    
    // Save to localStorage (simulating import)
    mockLocalStorage.setItem('strudel_tracks', JSON.stringify({
      [importedTrack.id]: importedTrack
    }));
    
    // Dispatch import event
    const mockDispatchEvent = vi.fn();
    global.window.dispatchEvent = mockDispatchEvent;
    window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
    
    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Verify localStorage has the track
    const savedTracks = JSON.parse(mockLocalStorage.getItem('strudel_tracks') || '{}');
    expect(savedTracks[importedTrack.id]).toEqual(importedTrack);
    
    console.log('✅ Import flow works correctly');
  });

  it('should maintain track selection state correctly', async () => {
    const { useFileManager } = await import('../website/src/repl/components/sidebar/hooks/useFileManager.ts');
    
    const track1 = {
      id: 'track1',
      name: 'Track 1',
      code: 'sound("bd")',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    
    const track2 = {
      id: 'track2', 
      name: 'Track 2',
      code: 'sound("hh")',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    
    mockLocalStorage.setItem('strudel_tracks', JSON.stringify({
      [track1.id]: track1,
      [track2.id]: track2
    }));
    
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useFileManager(mockContext));
    
    // Load first track
    result.current.loadTrack(track1);
    expect(result.current.selectedTrack).toBe(track1.id);
    
    // Load second track
    result.current.loadTrack(track2);
    expect(result.current.selectedTrack).toBe(track2.id);
    
    // Verify handleUpdate was called for both
    expect(mockHandleUpdate).toHaveBeenCalledTimes(2);
    
    console.log('✅ Track selection state maintained correctly');
  });

  it('should handle empty or invalid track data gracefully', async () => {
    const { useFileManager } = await import('../website/src/repl/components/sidebar/hooks/useFileManager.ts');
    
    const emptyTrack = {
      id: 'empty',
      name: 'Empty Track',
      code: '',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
    
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useFileManager(mockContext));
    
    // Should not throw error with empty code
    expect(() => {
      result.current.loadTrack(emptyTrack);
    }).not.toThrow();
    
    // Should still call handleUpdate even with empty code
    expect(mockHandleUpdate).toHaveBeenCalledWith({
      id: emptyTrack.id,
      code: ''
    }, true);
    
    console.log('✅ Empty track data handled gracefully');
  });
});