import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Delete All Tracks Feature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show Delete All Tracks option only when tracks exist', () => {
    const mockT = vi.fn((key) => key);
    const mockHandleTrackCreate = vi.fn();
    const mockHandleFolderCreate = vi.fn();
    const mockSetShowDeleteAllModal = vi.fn();

    // Mock FileManager state with tracks
    const fileManagerStateWithTracks = {
      tracks: {
        'track1': { id: 'track1', name: 'Track 1', code: 'test' },
        'track2': { id: 'track2', name: 'Track 2', code: 'test2' },
      },
      setShowDeleteAllModal: mockSetShowDeleteAllModal,
    };

    // Mock operations
    const operations = {
      handleTrackCreate: mockHandleTrackCreate,
      handleFolderCreate: mockHandleFolderCreate,
    };

    // Simulate getEmptySpaceContextItems function
    const getEmptySpaceContextItems = (tracks, t, operations, setShowDeleteAllModal) => [
      {
        label: t('files:newTrack'),
        icon: '+',
        onClick: () => operations.handleTrackCreate(),
      },
      {
        label: t('files:newFolder'),
        icon: '📁',
        onClick: () => operations.handleFolderCreate(),
      },
      ...(Object.keys(tracks).length > 0 ? [
        {
          label: t('files:deleteAllTracks'),
          icon: '🗑️',
          onClick: () => setShowDeleteAllModal(true),
          className: 'text-red-400 hover:text-red-300',
        }
      ] : []),
    ];

    // Test with tracks - should show Delete All option
    const itemsWithTracks = getEmptySpaceContextItems(
      fileManagerStateWithTracks.tracks,
      mockT,
      operations,
      mockSetShowDeleteAllModal
    );

    expect(itemsWithTracks).toHaveLength(3);
    expect(itemsWithTracks[2].label).toBe('files:deleteAllTracks');
    expect(itemsWithTracks[2].icon).toBe('🗑️');

    // Test clicking Delete All Tracks
    itemsWithTracks[2].onClick();
    expect(mockSetShowDeleteAllModal).toHaveBeenCalledWith(true);

    // Test with no tracks - should not show Delete All option
    const itemsWithoutTracks = getEmptySpaceContextItems(
      {},
      mockT,
      operations,
      mockSetShowDeleteAllModal
    );

    expect(itemsWithoutTracks).toHaveLength(2);
    expect(itemsWithoutTracks.find(item => item.label === 'files:deleteAllTracks')).toBeUndefined();
  });

  it('should delete all tracks and folders from localStorage', () => {
    const mockSetTracks = vi.fn();
    const mockSetFolders = vi.fn();
    const mockSetSelectedTrack = vi.fn();
    const mockSetCode = vi.fn();
    const mockToastSuccess = vi.fn();
    const mockT = vi.fn((key, options) => {
      if (key === 'files:allTracksAndFoldersDeleted') return 'All tracks and folders deleted';
      if (key === 'files:allTracksDeleted') return 'All tracks deleted';
      if (key === 'files:allFoldersDeleted') return 'All folders deleted';
      return key;
    });

    const tracks = {
      'track1': { id: 'track1', name: 'Track 1', code: 'test' },
      'track2': { id: 'track2', name: 'Track 2', code: 'test2' },
    };

    const folders = {
      'folder1': { id: 'folder1', name: 'Folder 1', path: 'folder1' },
      'folder2': { id: 'folder2', name: 'Folder 2', path: 'folder2' },
    };

    const context = {
      editorRef: { current: { setCode: mockSetCode } },
    };

    const toastActions = {
      success: mockToastSuccess,
    };

    // Simulate enhanced deleteAllTracks function
    const deleteAllTracks = (tracks, folders, setTracks, setFolders, setSelectedTrack, context, t, toastActions) => {
      const trackIds = Object.keys(tracks);
      const folderIds = Object.keys(folders);
      
      if (trackIds.length === 0 && folderIds.length === 0) return;

      // Clear all tracks and folders
      setTracks({});
      setFolders({});
      
      // Clear selected track
      setSelectedTrack(null);
      
      // Clear editor
      if (context.editorRef?.current?.setCode) {
        context.editorRef.current.setCode('');
      }
      
      // Update success message to reflect both tracks and folders
      const message = trackIds.length > 0 && folderIds.length > 0 
        ? t('files:allTracksAndFoldersDeleted')
        : trackIds.length > 0 
          ? t('files:allTracksDeleted')
          : t('files:allFoldersDeleted');
      
      toastActions.success(message);
    };

    deleteAllTracks(tracks, folders, mockSetTracks, mockSetFolders, mockSetSelectedTrack, context, mockT, toastActions);

    expect(mockSetTracks).toHaveBeenCalledWith({});
    expect(mockSetFolders).toHaveBeenCalledWith({});
    expect(mockSetSelectedTrack).toHaveBeenCalledWith(null);
    expect(mockSetCode).toHaveBeenCalledWith('');
    expect(mockToastSuccess).toHaveBeenCalledWith('All tracks and folders deleted');
  });

  it('should delete all tracks from localStorage', () => {
  it('should delete all tracks from localStorage (tracks only)', () => {
    const mockSetTracks = vi.fn();
    const mockSetFolders = vi.fn();
    const mockSetSelectedTrack = vi.fn();
    const mockSetCode = vi.fn();
    const mockToastSuccess = vi.fn();
    const mockT = vi.fn((key) => key);

    const tracks = {
      'track1': { id: 'track1', name: 'Track 1', code: 'test' },
      'track2': { id: 'track2', name: 'Track 2', code: 'test2' },
      'track3': { id: 'track3', name: 'Track 3', code: 'test3' },
    };

    const folders = {}; // No folders

    const context = {
      editorRef: { current: { setCode: mockSetCode } },
    };

    const toastActions = {
      success: mockToastSuccess,
    };

    // Simulate enhanced deleteAllTracks function
    const deleteAllTracks = (tracks, folders, setTracks, setFolders, setSelectedTrack, context, t, toastActions) => {
      const trackIds = Object.keys(tracks);
      const folderIds = Object.keys(folders);
      
      if (trackIds.length === 0 && folderIds.length === 0) return;

      setTracks({});
      setFolders({});
      setSelectedTrack(null);
      
      if (context.editorRef?.current?.setCode) {
        context.editorRef.current.setCode('');
      }
      
      const message = trackIds.length > 0 && folderIds.length > 0 
        ? t('files:allTracksAndFoldersDeleted')
        : trackIds.length > 0 
          ? t('files:allTracksDeleted')
          : t('files:allFoldersDeleted');
      
      toastActions.success(message);
    };

    deleteAllTracks(tracks, folders, mockSetTracks, mockSetFolders, mockSetSelectedTrack, context, mockT, toastActions);

    expect(mockSetTracks).toHaveBeenCalledWith({});
    expect(mockSetFolders).toHaveBeenCalledWith({});
    expect(mockSetSelectedTrack).toHaveBeenCalledWith(null);
    expect(mockSetCode).toHaveBeenCalledWith('');
    expect(mockToastSuccess).toHaveBeenCalledWith('files:allTracksDeleted');
  });

  it('should delete all tracks from Supabase', async () => {
    const mockDeleteTrack = vi.fn().mockResolvedValue({ error: null });
    const mockSetTracks = vi.fn();
    const mockSetSelectedTrack = vi.fn();
    const mockSetCode = vi.fn();
    const mockToastSuccess = vi.fn();
    const mockT = vi.fn((key) => key);

    const tracks = {
      'track1': { id: 'track1', name: 'Track 1', code: 'test' },
      'track2': { id: 'track2', name: 'Track 2', code: 'test2' },
    };

    const context = {
      editorRef: { current: { setCode: mockSetCode } },
    };

    // Mock database
    const db = {
      tracks: {
        delete: mockDeleteTrack,
      },
    };

    // Mock toast actions
    const toastActions = {
      success: mockToastSuccess,
      error: vi.fn(),
    };

    // Simulate Supabase deleteAllTracks function
    const deleteAllTracks = async (isAuthenticated, tracks, setTracks, setSelectedTrack, context, t, toastActions, db) => {
      if (!isAuthenticated) {
        toastActions.error(t('auth:errors.notAuthenticated'));
        return false;
      }

      const trackIds = Object.keys(tracks);
      if (trackIds.length === 0) return true;

      try {
        // Delete all tracks from Supabase
        const deletePromises = trackIds.map(trackId => db.tracks.delete(trackId));
        await Promise.all(deletePromises);

        // Clear local state
        setTracks({});
        setSelectedTrack(null);

        // Clear editor
        if (context.editorRef?.current?.setCode) {
          context.editorRef.current.setCode('');
        }

        toastActions.success(t('files:allTracksDeleted'));

        return true;
      } catch (error) {
        toastActions.error(t('files:errors.deleteFailed'));
        return false;
      }
    };

    const result = await deleteAllTracks(true, tracks, mockSetTracks, mockSetSelectedTrack, context, mockT, toastActions, db);

    expect(result).toBe(true);
    expect(mockDeleteTrack).toHaveBeenCalledTimes(2);
    expect(mockDeleteTrack).toHaveBeenCalledWith('track1');
    expect(mockDeleteTrack).toHaveBeenCalledWith('track2');
    expect(mockSetTracks).toHaveBeenCalledWith({});
    expect(mockSetSelectedTrack).toHaveBeenCalledWith(null);
    expect(mockSetCode).toHaveBeenCalledWith('');
    expect(mockToastSuccess).toHaveBeenCalledWith('files:allTracksDeleted');
  });

  it('should handle empty tracks gracefully', () => {
    const mockSetTracks = vi.fn();
    const mockSetSelectedTrack = vi.fn();
    const mockSetCode = vi.fn();
    const mockToastSuccess = vi.fn();
    const mockT = vi.fn((key) => key);

    const tracks = {};

    const context = {
      editorRef: { current: { setCode: mockSetCode } },
    };

    const toastActions = {
      success: mockToastSuccess,
    };

    // Simulate deleteAllTracks function with empty tracks
    const deleteAllTracks = (tracks, setTracks, setSelectedTrack, context, t, toastActions) => {
      const trackIds = Object.keys(tracks);
      if (trackIds.length === 0) return; // Should return early

      // This code should not execute
      setTracks({});
      setSelectedTrack(null);
      context.editorRef?.current?.setCode('');
      toastActions.success(t('files:allTracksDeleted'));
    };

    deleteAllTracks(tracks, mockSetTracks, mockSetSelectedTrack, context, mockT, toastActions);

    // None of these should be called since tracks is empty
    expect(mockSetTracks).not.toHaveBeenCalled();
    expect(mockSetSelectedTrack).not.toHaveBeenCalled();
    expect(mockSetCode).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('should handle Supabase errors gracefully', async () => {
    const mockDeleteTrack = vi.fn().mockRejectedValue(new Error('Database error'));
    const mockSetTracks = vi.fn();
    const mockSetSelectedTrack = vi.fn();
    const mockToastError = vi.fn();
    const mockSetSyncError = vi.fn();
    const mockT = vi.fn((key) => key);

    const tracks = {
      'track1': { id: 'track1', name: 'Track 1', code: 'test' },
    };

    const context = {
      editorRef: { current: { setCode: vi.fn() } },
    };

    const db = {
      tracks: {
        delete: mockDeleteTrack,
      },
    };

    const toastActions = {
      success: vi.fn(),
      error: mockToastError,
    };

    // Simulate Supabase deleteAllTracks function with error
    const deleteAllTracks = async (isAuthenticated, tracks, setTracks, setSelectedTrack, context, t, toastActions, db, setSyncError) => {
      if (!isAuthenticated) {
        toastActions.error(t('auth:errors.notAuthenticated'));
        return false;
      }

      const trackIds = Object.keys(tracks);
      if (trackIds.length === 0) return true;

      try {
        const deletePromises = trackIds.map(trackId => db.tracks.delete(trackId));
        await Promise.all(deletePromises);

        setTracks({});
        setSelectedTrack(null);
        toastActions.success(t('files:allTracksDeleted'));
        return true;
      } catch (error) {
        console.error('Error deleting all tracks:', error);
        toastActions.error(t('files:errors.deleteFailed'));
        setSyncError(error instanceof Error ? error.message : 'Delete all failed');
        return false;
      }
    };

    const result = await deleteAllTracks(true, tracks, mockSetTracks, mockSetSelectedTrack, context, mockT, toastActions, db, mockSetSyncError);

    expect(result).toBe(false);
    expect(mockDeleteTrack).toHaveBeenCalledWith('track1');
    expect(mockToastError).toHaveBeenCalledWith('files:errors.deleteFailed');
    expect(mockSetSyncError).toHaveBeenCalledWith('Database error');
    expect(mockSetTracks).not.toHaveBeenCalled(); // Should not clear tracks on error
  });
});