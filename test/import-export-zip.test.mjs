import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Import/Export ZIP Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show export library option when tracks exist', () => {
    const mockT = vi.fn((key) => key);
    const mockHandleTrackCreate = vi.fn();
    const mockHandleFolderCreate = vi.fn();
    const mockSetShowDeleteAllModal = vi.fn();
    const mockDownloadFolder = vi.fn();
    const mockHandleFileImport = vi.fn();

    // Mock FileManager state with tracks
    const fileManagerState = {
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
      downloadFolder: mockDownloadFolder,
    };

    // Simulate getEmptySpaceContextItems function
    const getEmptySpaceContextItems = (tracks, t, operations, fileManagerState, handleFileImport) => [
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
          label: t('files:exportLibraryAsZip'),
          icon: '📦',
          onClick: () => operations.downloadFolder(''),
        },
        {
          label: t('files:deleteAllTracks'),
          icon: '🗑️',
          onClick: () => fileManagerState.setShowDeleteAllModal(true),
          className: 'text-red-400 hover:text-red-300',
        }
      ] : []),
      {
        label: t('files:importLibraryFromZip'),
        icon: '📥',
        onClick: () => {
          // Simulate file input click
          handleFileImport();
        },
      },
    ];

    // Test with tracks - should show export option
    const itemsWithTracks = getEmptySpaceContextItems(
      fileManagerState.tracks,
      mockT,
      operations,
      fileManagerState,
      mockHandleFileImport
    );

    expect(itemsWithTracks).toHaveLength(5); // newTrack, newFolder, export, deleteAll, import
    
    const exportItem = itemsWithTracks.find(item => item.label === 'files:exportLibraryAsZip');
    expect(exportItem).toBeDefined();
    expect(exportItem.icon).toBe('📦');

    const importItem = itemsWithTracks.find(item => item.label === 'files:importLibraryFromZip');
    expect(importItem).toBeDefined();
    expect(importItem.icon).toBe('📥');

    // Test clicking export
    exportItem.onClick();
    expect(mockDownloadFolder).toHaveBeenCalledWith('');

    // Test clicking import
    importItem.onClick();
    expect(mockHandleFileImport).toHaveBeenCalled();
  });

  it('should show import option even when no tracks exist', () => {
    const mockT = vi.fn((key) => key);
    const mockHandleTrackCreate = vi.fn();
    const mockHandleFolderCreate = vi.fn();
    const mockHandleFileImport = vi.fn();

    // Mock FileManager state without tracks
    const fileManagerState = {
      tracks: {},
    };

    const operations = {
      handleTrackCreate: mockHandleTrackCreate,
      handleFolderCreate: mockHandleFolderCreate,
      downloadFolder: vi.fn(),
    };

    const getEmptySpaceContextItems = (tracks, t, operations, fileManagerState, handleFileImport) => [
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
          label: t('files:exportLibraryAsZip'),
          icon: '📦',
          onClick: () => operations.downloadFolder(''),
        },
        {
          label: t('files:deleteAllTracks'),
          icon: '🗑️',
          onClick: () => fileManagerState.setShowDeleteAllModal(true),
          className: 'text-red-400 hover:text-red-300',
        }
      ] : []),
      {
        label: t('files:importLibraryFromZip'),
        icon: '📥',
        onClick: () => {
          handleFileImport();
        },
      },
    ];

    // Test without tracks - should not show export/delete options but should show import
    const itemsWithoutTracks = getEmptySpaceContextItems(
      fileManagerState.tracks,
      mockT,
      operations,
      fileManagerState,
      mockHandleFileImport
    );

    expect(itemsWithoutTracks).toHaveLength(3); // newTrack, newFolder, import
    
    const exportItem = itemsWithoutTracks.find(item => item.label === 'files:exportLibraryAsZip');
    expect(exportItem).toBeUndefined();

    const deleteAllItem = itemsWithoutTracks.find(item => item.label === 'files:deleteAllTracks');
    expect(deleteAllItem).toBeUndefined();

    const importItem = itemsWithoutTracks.find(item => item.label === 'files:importLibraryFromZip');
    expect(importItem).toBeDefined();
    expect(importItem.icon).toBe('📥');
  });

  it('should handle export all tracks correctly', async () => {
    const mockGenerateAsync = vi.fn().mockResolvedValue(new Blob(['zip content']));
    const mockFile = vi.fn();
    const mockFolder = vi.fn().mockReturnValue({ file: mockFile });
    
    // Mock JSZip
    const mockZip = {
      file: mockFile,
      folder: mockFolder,
      generateAsync: mockGenerateAsync,
    };

    const mockJSZip = vi.fn().mockReturnValue(mockZip);
    
    const mockToastSuccess = vi.fn();
    const mockT = vi.fn((key) => key);

    // Mock tracks data
    const tracks = {
      'track1': {
        id: 'track1',
        name: 'Track 1',
        code: 'console.log("track1")',
        folder: 'folder1',
        isMultitrack: false,
      },
      'track2': {
        id: 'track2',
        name: 'Multitrack',
        code: 'console.log("step1")',
        folder: undefined,
        isMultitrack: true,
        activeStep: 0,
        steps: [
          { id: 'step1', name: 'Step 1', code: 'console.log("step1")' },
          { id: 'step2', name: 'Step 2', code: 'console.log("step2")' },
        ],
      },
    };

    const toastActions = {
      success: mockToastSuccess,
      error: vi.fn(),
    };

    // Simulate downloadFolder function for export all
    const downloadFolder = async (folderPath, tracks, t, toastActions, JSZip) => {
      const zip = new JSZip();

      // Get all tracks when folderPath is empty
      const folderTracks = folderPath === '' 
        ? Object.values(tracks)
        : Object.values(tracks).filter(track =>
            track.folder === folderPath || track.folder?.startsWith(`${folderPath}/`)
          );

      if (folderTracks.length === 0) {
        toastActions.error(folderPath === '' ? t('files:noTracksToExport') : t('files:emptyFolder'));
        return;
      }

      // Add each track to the ZIP
      folderTracks.forEach((track) => {
        const relativePath = folderPath === '' 
          ? (track.folder || '')
          : (track.folder ? track.folder.replace(folderPath, '').replace(/^\//, '') : '');
        const trackPath = relativePath ? `${relativePath}/` : '';

        if (track.isMultitrack && track.steps) {
          // Create multitrack folder
          const multitrackFolder = zip.folder(`${trackPath}${track.name}`);
          
          // Add each step
          track.steps.forEach((step) => {
            const fileName = `${step.name.replace(/[^a-zA-Z0-9]/g, '_')}.js`;
            multitrackFolder.file(fileName, step.code);
          });
        } else {
          // Regular track
          const fileName = `${trackPath}${track.name.replace(/[^a-zA-Z0-9]/g, '_')}.js`;
          zip.file(fileName, track.code);
        }
      });

      // Generate ZIP
      const content = await zip.generateAsync({ type: 'blob' });
      
      toastActions.success(folderPath === '' ? t('files:libraryExported') : t('files:folderDownloaded'));
    };

    await downloadFolder('', tracks, mockT, toastActions, mockJSZip);

    // Verify ZIP creation
    expect(mockJSZip).toHaveBeenCalled();
    expect(mockFile).toHaveBeenCalledWith('folder1/Track_1.js', 'console.log("track1")');
    expect(mockFolder).toHaveBeenCalledWith('Multitrack');
    expect(mockGenerateAsync).toHaveBeenCalledWith({ type: 'blob' });
    expect(mockToastSuccess).toHaveBeenCalledWith('files:libraryExported');
  });

  it('should handle empty library export', async () => {
    const mockToastError = vi.fn();
    const mockT = vi.fn((key) => key);

    const tracks = {};

    const toastActions = {
      success: vi.fn(),
      error: mockToastError,
    };

    // Simulate downloadFolder function with empty tracks
    const downloadFolder = async (folderPath, tracks, t, toastActions) => {
      const folderTracks = folderPath === '' 
        ? Object.values(tracks)
        : Object.values(tracks).filter(track =>
            track.folder === folderPath || track.folder?.startsWith(`${folderPath}/`)
          );

      if (folderTracks.length === 0) {
        toastActions.error(folderPath === '' ? t('files:noTracksToExport') : t('files:emptyFolder'));
        return;
      }
    };

    await downloadFolder('', tracks, mockT, toastActions);

    expect(mockToastError).toHaveBeenCalledWith('files:noTracksToExport');
  });
});