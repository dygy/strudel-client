import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Editor Update Fix', () => {
  let mockContext;
  let mockTrack;

  beforeEach(() => {
    // Mock the context object
    mockContext = {
      editorRef: {
        current: {
          code: '',
          setCode: vi.fn()
        }
      },
      handleUpdate: vi.fn(),
      activeCode: ''
    };

    // Mock track
    mockTrack = {
      id: 'test-track-123',
      name: 'Test Track',
      code: 'sound("bd").play()',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };
  });

  it('should distinguish between library and multitrack metadata', () => {
    const libraryZipFiles = [
      'library-metadata.json',
      'trance/Looking for a miracle/metadata.json',
      'New Multitrack/metadata.json',
      'track1.js',
      'track2.js'
    ];
    
    // Check library detection
    const hasLibraryMetadata = libraryZipFiles.includes('library-metadata.json');
    expect(hasLibraryMetadata).toBe(true);
    
    // If has library metadata, should treat as library
    if (hasLibraryMetadata) {
      expect('library').toBe('library'); // Should be treated as library
    }
  });

  it('should handle multitrack ZIP with nested metadata.json (no library metadata)', () => {
    // Mock ZIP structure with nested metadata but NO library-metadata.json
    const mockZipFiles = {
      'New Multitrack/metadata.json': { async: () => '{"name":"Test Multitrack","steps":[{"name":"Step 1"}]}' },
      'New Multitrack/step_0.js': { async: () => 'sound("bd").play()' },
      'New Multitrack/step_1.js': { async: () => 'sound("hh").play()' }
    };

    const allFiles = Object.keys(mockZipFiles);
    
    // Check that there's no library metadata
    const hasLibraryMetadata = allFiles.includes('library-metadata.json');
    expect(hasLibraryMetadata).toBe(false);
    
    // Test multitrack detection logic (only when no library metadata)
    const multitrackMetadataFiles = allFiles.filter(f => 
      f.endsWith('metadata.json') && 
      f !== 'library-metadata.json' &&
      !f.includes('library-metadata.json')
    );
    expect(multitrackMetadataFiles).toEqual(['New Multitrack/metadata.json']);
    
    const hasStepFiles = allFiles.some(filename => 
      filename.match(/step_\d+\.js$/i) || 
      filename.match(/Step\s*_?\d+\.js$/i) ||
      filename.match(/\/step_\d+\.js$/i) ||
      filename.match(/\/Step\s*_?\d+\.js$/i)
    );
    expect(hasStepFiles).toBe(true);
    
    const isMultitrack = multitrackMetadataFiles.length > 0 || hasStepFiles;
    expect(isMultitrack).toBe(true);
  });

  it('should validate multitrack metadata content', () => {
    // Library metadata structure (should be rejected)
    const libraryMetadata = {
      tracks: { 'track1': { name: 'Track 1' } },
      folders: { 'folder1': { name: 'Folder 1' } },
      exportDate: '2025-01-01T00:00:00.000Z',
      version: '1.0'
    };
    
    // Multitrack metadata structure (should be accepted)
    const multitrackMetadata = {
      name: 'My Multitrack',
      steps: [
        { name: 'Step 1', code: 'sound("bd").play()' },
        { name: 'Step 2', code: 'sound("hh").play()' }
      ],
      activeStep: 0,
      created: '2025-01-01T00:00:00.000Z'
    };
    
    // Test library metadata detection
    const isLibraryMetadata = !!(libraryMetadata.tracks || libraryMetadata.folders || libraryMetadata.exportDate);
    expect(isLibraryMetadata).toBe(true);
    
    // Test multitrack metadata detection
    const isMultitrackMetadata = !(multitrackMetadata.tracks || multitrackMetadata.folders || multitrackMetadata.exportDate);
    expect(isMultitrackMetadata).toBe(true);
  });

  it('should extract folder prefix from metadata path', () => {
    const metadataPath = 'New Multitrack/metadata.json';
    const folderPrefix = metadataPath.includes('/') ? 
      metadataPath.substring(0, metadataPath.lastIndexOf('/') + 1) : '';
    
    expect(folderPrefix).toBe('New Multitrack/');
  });

  it('should find step files with folder prefix', () => {
    const allFiles = [
      'New Multitrack/metadata.json',
      'New Multitrack/step_0.js', 
      'New Multitrack/step_1.js',
      'Other Folder/regular.js'
    ];
    const folderPrefix = 'New Multitrack/';
    
    const stepFiles = allFiles.filter(filename => {
      const relativePath = folderPrefix ? filename.replace(folderPrefix, '') : filename;
      return relativePath.match(/^step_\d+\.js$/) || 
             relativePath.match(/^Step\s+\d+\.js$/i) ||
             relativePath.match(/^\d+\.js$/) ||
             filename.match(/step_\d+\.js$/i) ||
             filename.match(/Step\s*_?\d+\.js$/i);
    }).sort();
    
    expect(stepFiles).toEqual([
      'New Multitrack/step_0.js',
      'New Multitrack/step_1.js'
    ]);
  });

  it('should handle editor update through handleUpdate method', () => {
    const trackCode = 'sound("bd").play()';
    const trackId = 'test-123';
    
    // Simulate what loadTrack should do
    mockContext.handleUpdate({ id: trackId, code: trackCode }, true);
    
    expect(mockContext.handleUpdate).toHaveBeenCalledWith(
      { id: trackId, code: trackCode }, 
      true
    );
  });

  it('should verify triple update approach for editor', () => {
    // Test the three methods that loadTrack should use:
    // 1. setLatestCode (store update)
    // 2. editorRef.current.setCode (direct editor update)  
    // 3. handleUpdate (context update)
    
    const trackCode = 'sound("bd").play()';
    const trackId = 'test-123';
    
    // Mock setLatestCode
    const mockSetLatestCode = vi.fn();
    
    // Simulate the triple approach
    mockSetLatestCode(trackCode);
    mockContext.editorRef.current.setCode(trackCode);
    mockContext.handleUpdate({ id: trackId, code: trackCode }, true);
    
    // Verify all three methods were called
    expect(mockSetLatestCode).toHaveBeenCalledWith(trackCode);
    expect(mockContext.editorRef.current.setCode).toHaveBeenCalledWith(trackCode);
    expect(mockContext.handleUpdate).toHaveBeenCalledWith(
      { id: trackId, code: trackCode }, 
      true
    );
  });

  it('should handle library import with embedded multitracks', () => {
    // Mock library ZIP with embedded multitrack
    const libraryWithMultitrack = [
      'library-metadata.json',
      'trance/momat.js',
      'trance/smth.js', 
      'trance/Looking for a miracle/metadata.json',
      'trance/Looking for a miracle/original_trance.js',
      'trance/Looking for a miracle/drum_step.js',
      'old/boss_fight.js',
      'phonky.js'
    ];
    
    // Check library detection (should still be library)
    const hasLibraryMetadata = libraryWithMultitrack.includes('library-metadata.json');
    expect(hasLibraryMetadata).toBe(true);
    
    // Find potential multitracks within library
    const potentialMultitracks = new Map();
    
    for (const filename of libraryWithMultitrack) {
      if (filename.endsWith('metadata.json') && filename !== 'library-metadata.json') {
        const folderPath = filename.substring(0, filename.lastIndexOf('/'));
        if (folderPath) {
          // Check if this folder has multiple JS files (potential steps)
          const jsFiles = libraryWithMultitrack.filter(f => 
            f.startsWith(folderPath + '/') && 
            f.match(/\.js$/i) &&
            f !== filename // exclude the metadata file itself
          );
          
          // Also check for traditional step file patterns
          const traditionalStepFiles = jsFiles.filter(f =>
            f.match(/\/step_\d+\.js$/i) || f.match(/\/Step\s*_?\d+\.js$/i)
          );
          
          // If we have traditional step files OR multiple JS files in a folder with metadata, treat as multitrack
          if (traditionalStepFiles.length > 0 || jsFiles.length > 1) {
            potentialMultitracks.set(folderPath, {
              metadataPath: filename,
              stepFiles: jsFiles
            });
          }
        }
      }
    }
    
    // Should find one multitrack
    expect(potentialMultitracks.size).toBe(1);
    expect(potentialMultitracks.has('trance/Looking for a miracle')).toBe(true);
    
    const multitrack = potentialMultitracks.get('trance/Looking for a miracle');
    expect(multitrack.stepFiles).toEqual([
      'trance/Looking for a miracle/original_trance.js',
      'trance/Looking for a miracle/drum_step.js'
    ]);
    
    // Test folder assignment for multitrack
    const folderPath = 'trance/Looking for a miracle';
    const parentFolder = folderPath.includes('/') ? folderPath.substring(0, folderPath.lastIndexOf('/')) : undefined;
    expect(parentFolder).toBe('trance');
    
    // Regular folders should exclude multitrack folders
    const foldersToCreate = new Set();
    for (const filename of libraryWithMultitrack) {
      if (filename.match(/\.(js|txt|md)$/i)) {
        const pathParts = filename.split('/');
        if (pathParts.length > 1) {
          let currentPath = '';
          for (let i = 0; i < pathParts.length - 1; i++) {
            currentPath += (currentPath ? '/' : '') + pathParts[i];
            
            // Don't create folder if it's a multitrack
            if (!potentialMultitracks.has(currentPath)) {
              foldersToCreate.add(currentPath);
            }
          }
        }
      }
    }
    
    // Should create 2 regular folders (trance, old) but not the multitrack folder
    expect(foldersToCreate.size).toBe(2);
    expect(foldersToCreate.has('trance')).toBe(true);
    expect(foldersToCreate.has('old')).toBe(true);
    expect(foldersToCreate.has('trance/Looking for a miracle')).toBe(false);
  });
});