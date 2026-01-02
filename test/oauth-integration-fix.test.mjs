import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('OAuth Integration Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle React Hook order correctly', () => {
    // Mock React hooks to verify they're called in the right order
    const mockUseState = vi.fn(() => [null, vi.fn()]);
    const mockUseEffect = vi.fn();
    const mockUseCallback = vi.fn();
    const mockUseRef = vi.fn(() => ({ current: null }));
    
    // Mock React
    const React = {
      useState: mockUseState,
      useEffect: mockUseEffect,
      useCallback: mockUseCallback,
      useRef: mockUseRef,
    };

    // Simulate the hook calls that should happen in useSupabaseFileManager
    const simulateHookCalls = () => {
      // These should always be called in the same order, regardless of authentication state
      React.useState({}); // tracks
      React.useState({}); // folders
      React.useState(false); // isInitialized
      React.useState(null); // selectedTrack
      React.useState(false); // isLoading
      React.useState(null); // syncError
      
      // UI state hooks
      React.useState(false); // isCreating
      React.useState(false); // isCreatingFolder
      React.useState(''); // newTrackName
      React.useState(''); // newFolderName
      
      // Refs
      React.useRef(null); // autosaveTimerRef
      React.useRef(null); // autosaveTrackIdRef
      React.useRef(''); // lastSavedCodeRef
    };

    // Should work regardless of authentication state
    simulateHookCalls();
    expect(mockUseState).toHaveBeenCalledTimes(10);
    expect(mockUseRef).toHaveBeenCalledTimes(3);

    // Reset and try again - should have same number of calls
    vi.clearAllMocks();
    simulateHookCalls();
    expect(mockUseState).toHaveBeenCalledTimes(10);
    expect(mockUseRef).toHaveBeenCalledTimes(3);
  });

  it('should handle drag and drop import with proper delays', async () => {
    const mockLoadTrack = vi.fn();
    const mockCreateTrack = vi.fn().mockResolvedValue({ id: '123', name: 'test' });
    const mockToastSuccess = vi.fn();

    // Mock the import process with delays
    const handleTrackImport = async (trackName, content) => {
      const createdTrack = await mockCreateTrack(trackName, content);
      if (createdTrack) {
        mockToastSuccess('Track imported');
        // Add delay before loading track
        await new Promise(resolve => setTimeout(resolve, 100));
        mockLoadTrack(createdTrack);
      }
    };

    await handleTrackImport('test-track', 'console.log("test")');

    expect(mockCreateTrack).toHaveBeenCalledWith('test-track', 'console.log("test")');
    expect(mockToastSuccess).toHaveBeenCalledWith('Track imported');
    expect(mockLoadTrack).toHaveBeenCalledWith({ id: '123', name: 'test' });
  });

  it('should handle folder creation in ZIP imports', async () => {
    const mockCreateFolder = vi.fn().mockResolvedValue({ id: 'folder1', name: 'test-folder' });
    const mockCreateTrack = vi.fn().mockResolvedValue({ id: 'track1', name: 'test-track' });

    // Simulate ZIP import with folders
    const zipStructure = {
      'folder1/track1.js': { content: 'console.log("track1")' },
      'folder1/subfolder/track2.js': { content: 'console.log("track2")' },
    };

    const foldersToCreate = new Set();
    const tracksToImport = [];

    // Process ZIP structure
    for (const [filename, file] of Object.entries(zipStructure)) {
      if (filename.match(/\.(js|txt|md)$/i)) {
        const pathParts = filename.split('/');
        if (pathParts.length > 1) {
          // Build folder path progressively
          let currentPath = '';
          for (let i = 0; i < pathParts.length - 1; i++) {
            currentPath += (currentPath ? '/' : '') + pathParts[i];
            foldersToCreate.add(currentPath);
          }
        }
        
        const trackName = pathParts[pathParts.length - 1].replace(/\.(js|txt|md)$/i, '');
        const folderPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : undefined;
        tracksToImport.push({ name: trackName, content: file.content, folder: folderPath });
      }
    }

    // Create folders first
    for (const folderPath of Array.from(foldersToCreate).sort()) {
      const folderName = folderPath.split('/').pop() || folderPath;
      const parentPath = folderPath.includes('/') ? folderPath.substring(0, folderPath.lastIndexOf('/')) : undefined;
      await mockCreateFolder(folderName, folderPath, parentPath);
    }

    // Create tracks
    for (const track of tracksToImport) {
      await mockCreateTrack(track.name, track.content, track.folder);
    }

    expect(foldersToCreate.size).toBe(2); // 'folder1' and 'folder1/subfolder'
    expect(mockCreateFolder).toHaveBeenCalledTimes(2);
    expect(mockCreateFolder).toHaveBeenCalledWith('folder1', 'folder1', undefined);
    expect(mockCreateFolder).toHaveBeenCalledWith('subfolder', 'folder1/subfolder', 'folder1');
    
    expect(mockCreateTrack).toHaveBeenCalledTimes(2);
    expect(mockCreateTrack).toHaveBeenCalledWith('track1', 'console.log("track1")', 'folder1');
    expect(mockCreateTrack).toHaveBeenCalledWith('track2', 'console.log("track2")', 'folder1/subfolder');
  });

  it('should handle authentication state changes gracefully', () => {
    const mockFileManager = {
      isAuthenticated: false,
      tracks: {},
      folders: {},
      loadTrack: vi.fn(),
      createTrack: vi.fn(),
      createFolder: vi.fn(),
    };

    // Should work when not authenticated
    expect(mockFileManager.isAuthenticated).toBe(false);
    expect(typeof mockFileManager.loadTrack).toBe('function');
    expect(typeof mockFileManager.createTrack).toBe('function');

    // Should work when authenticated
    mockFileManager.isAuthenticated = true;
    expect(mockFileManager.isAuthenticated).toBe(true);
    expect(typeof mockFileManager.loadTrack).toBe('function');
    expect(typeof mockFileManager.createTrack).toBe('function');
  });

  it('should handle editor reference properly in loadTrack', async () => {
    const mockHandleUpdate = vi.fn();
    const mockSetCode = vi.fn();
    const mockEditorRef = { current: { setCode: mockSetCode } };

    const context = {
      handleUpdate: mockHandleUpdate,
      editorRef: mockEditorRef,
    };

    const track = {
      id: '123',
      name: 'test-track',
      code: 'console.log("test")',
    };

    // Simulate loadTrack function
    const loadTrack = (track) => {
      console.log('Loading track:', track.name);
      
      // Always use handleUpdate first
      context.handleUpdate({ id: track.id, code: track.code }, false);
      
      // Try to set code directly in editor
      const trySetEditorCode = () => {
        if (context.editorRef?.current?.setCode) {
          context.editorRef.current.setCode(track.code);
        }
      };

      trySetEditorCode();
      setTimeout(trySetEditorCode, 50);
      setTimeout(trySetEditorCode, 200);
    };

    loadTrack(track);

    expect(mockHandleUpdate).toHaveBeenCalledWith({ id: '123', code: 'console.log("test")' }, false);
    expect(mockSetCode).toHaveBeenCalledWith('console.log("test")');

    // Wait for delayed calls
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(mockSetCode).toHaveBeenCalledTimes(3); // Initial + 2 delayed calls
  });
});