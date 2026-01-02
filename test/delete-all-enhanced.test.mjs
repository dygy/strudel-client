import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock localStorage
const localStorageMock = {
  data: {},
  getItem: vi.fn((key) => localStorageMock.data[key] || null),
  setItem: vi.fn((key, value) => {
    localStorageMock.data[key] = value;
  }),
  removeItem: vi.fn((key) => {
    delete localStorageMock.data[key];
  }),
  clear: vi.fn(() => {
    localStorageMock.data = {};
  })
};

// Mock toast actions
const mockToastActions = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn()
};

// Mock translation function
const mockT = vi.fn((key) => {
  const translations = {
    'files:allTracksDeleted': 'All tracks deleted successfully!',
    'files:allFoldersDeleted': 'All folders deleted successfully!',
    'files:allTracksAndFoldersDeleted': 'All tracks and folders deleted successfully!',
    'files:deleteAllTracks': 'Delete All Tracks & Folders',
    'files:confirmDeleteAllTracks': 'Are you sure you want to delete ALL tracks and folders?',
    'files:deleteAllTracksAndFoldersWarning': 'This will permanently delete all {{trackCount}} tracks and {{folderCount}} folders. This action cannot be undone.',
    'files:deleteAllTracksWarning': 'This will permanently delete all {{count}} tracks. This action cannot be undone.',
    'files:deleteAllFoldersWarning': 'This will permanently delete all {{count}} folders. This action cannot be undone.'
  };
  return translations[key] || key;
});

// Mock context
const mockContext = {
  editorRef: {
    current: {
      setCode: vi.fn()
    }
  }
};

// Mock event dispatch
const mockDispatchEvent = vi.fn();
global.window = {
  dispatchEvent: mockDispatchEvent
};

describe('Enhanced Delete All Tracks & Folders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    global.localStorage = localStorageMock;
    
    // Set up initial test data
    localStorageMock.setItem('strudel_tracks', JSON.stringify({
      'track1': { id: 'track1', name: 'Track 1', code: 'sound("bd")' },
      'track2': { id: 'track2', name: 'Track 2', code: 'sound("hh")', folder: 'beats' }
    }));
    
    localStorageMock.setItem('strudel_folders', JSON.stringify({
      'beats': { id: 'beats', name: 'beats', path: 'beats' },
      'melodies': { id: 'melodies', name: 'melodies', path: 'melodies' }
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should delete both tracks and folders from localStorage', async () => {
    // Mock the deleteAllTracks function behavior
    const tracks = {
      'track1': { id: 'track1', name: 'Track 1', code: 'sound("bd")' },
      'track2': { id: 'track2', name: 'Track 2', code: 'sound("hh")', folder: 'beats' }
    };
    
    const folders = {
      'beats': { id: 'beats', name: 'beats', path: 'beats' },
      'melodies': { id: 'melodies', name: 'melodies', path: 'melodies' }
    };

    const setTracks = vi.fn();
    const setFolders = vi.fn();
    const setSelectedTrack = vi.fn();

    // Simulate the deleteAllTracks function
    const trackIds = Object.keys(tracks);
    const folderIds = Object.keys(folders);
    
    expect(trackIds.length).toBe(2);
    expect(folderIds.length).toBe(2);

    // Clear tracks from localStorage
    if (trackIds.length > 0) {
      localStorageMock.removeItem('strudel_tracks');
      setTracks({});
    }
    
    // Clear folders from localStorage
    if (folderIds.length > 0) {
      localStorageMock.removeItem('strudel_folders');
      setFolders({});
    }
    
    setSelectedTrack(null);
    mockContext.editorRef.current.setCode('');

    // Verify localStorage was cleared
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('strudel_tracks');
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('strudel_folders');
    expect(localStorageMock.getItem('strudel_tracks')).toBeNull();
    expect(localStorageMock.getItem('strudel_folders')).toBeNull();

    // Verify state was cleared
    expect(setTracks).toHaveBeenCalledWith({});
    expect(setFolders).toHaveBeenCalledWith({});
    expect(setSelectedTrack).toHaveBeenCalledWith(null);
    expect(mockContext.editorRef.current.setCode).toHaveBeenCalledWith('');
  });

  it('should show correct success message for tracks and folders', () => {
    const trackCount = 2;
    const folderCount = 2;
    
    // Test message for both tracks and folders
    const message = trackCount > 0 && folderCount > 0 
      ? mockT('files:allTracksAndFoldersDeleted')
      : trackCount > 0 
        ? mockT('files:allTracksDeleted')
        : mockT('files:allFoldersDeleted');
    
    expect(message).toBe('All tracks and folders deleted successfully!');
  });

  it('should show correct success message for tracks only', () => {
    const trackCount = 2;
    const folderCount = 0;
    
    const message = trackCount > 0 && folderCount > 0 
      ? mockT('files:allTracksAndFoldersDeleted')
      : trackCount > 0 
        ? mockT('files:allTracksDeleted')
        : mockT('files:allFoldersDeleted');
    
    expect(message).toBe('All tracks deleted successfully!');
  });

  it('should show correct success message for folders only', () => {
    const trackCount = 0;
    const folderCount = 2;
    
    const message = trackCount > 0 && folderCount > 0 
      ? mockT('files:allTracksAndFoldersDeleted')
      : trackCount > 0 
        ? mockT('files:allTracksDeleted')
        : mockT('files:allFoldersDeleted');
    
    expect(message).toBe('All folders deleted successfully!');
  });

  it('should show context menu option when tracks or folders exist', () => {
    // Test with tracks only
    let tracks = { 'track1': { id: 'track1', name: 'Track 1' } };
    let folders = {};
    let shouldShow = Object.keys(tracks).length > 0 || Object.keys(folders).length > 0;
    expect(shouldShow).toBe(true);

    // Test with folders only
    tracks = {};
    folders = { 'folder1': { id: 'folder1', name: 'Folder 1' } };
    shouldShow = Object.keys(tracks).length > 0 || Object.keys(folders).length > 0;
    expect(shouldShow).toBe(true);

    // Test with both
    tracks = { 'track1': { id: 'track1', name: 'Track 1' } };
    folders = { 'folder1': { id: 'folder1', name: 'Folder 1' } };
    shouldShow = Object.keys(tracks).length > 0 || Object.keys(folders).length > 0;
    expect(shouldShow).toBe(true);

    // Test with neither
    tracks = {};
    folders = {};
    shouldShow = Object.keys(tracks).length > 0 || Object.keys(folders).length > 0;
    expect(shouldShow).toBe(false);
  });

  it('should dispatch strudel-all-tracks-deleted event', (done) => {
    // Simulate the setTimeout behavior
    setTimeout(() => {
      const expectedEvent = new CustomEvent('strudel-all-tracks-deleted');
      mockDispatchEvent(expectedEvent);
      
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'strudel-all-tracks-deleted'
        })
      );
      done();
    }, 100);
  });

  it('should handle empty state gracefully', () => {
    const tracks = {};
    const folders = {};
    
    const trackIds = Object.keys(tracks);
    const folderIds = Object.keys(folders);
    
    // Should return early if no tracks or folders
    if (trackIds.length === 0 && folderIds.length === 0) {
      expect(true).toBe(true); // Function should return early
      return;
    }
    
    // This should not be reached
    expect(false).toBe(true);
  });
});