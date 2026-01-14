import React from 'react';
import { FileTree } from './FileTree';
import { InfoModal } from '../ui/InfoModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { formatDateTimeIntl } from '@src/i18n/dateFormat';
import { useTranslation } from '@src/i18n';
import { toastActions } from '@src/stores/toastStore';
import { batch, db } from '@src/lib/secureApi';
import { DEFAULT_TRACK_CODE } from '@src/constants/defaultCode';
import { generateTrackUrlPath } from '@src/lib/slugUtils';
import { setActivePattern } from '@src/user_pattern_utils';

// Import our new components and hooks
import { useFileManagerOperations } from './hooks/useFileManagerOperations';
import { FileManagerHeader } from './components/FileManagerHeader';
import { FileManagerFooter } from './components/FileManagerFooter';
import { DragDropOverlay } from './components/DragDropOverlay';
import { ImportConflictModal } from '../ui/ImportConflictModal';
import type { ImportConflict } from '../ui/ImportConflictModal.types';
import type { Track } from './types/fileManager';
import { nanoid } from 'nanoid';

interface ReplContext {
  activeCode?: string;
  editorRef?: React.RefObject<{ code: string; setCode?: (code: string) => void }>;
  handleUpdate: (update: { id?: string; code: string; [key: string]: any }, replace?: boolean) => void;
  trackRouter?: any;
}

interface FileManagerProps {
  context: ReplContext;
  fileManagerHook?: any; // Optional override for the file manager hook (e.g., Supabase version)
}

export function FileManagerRefactored({ context, fileManagerHook }: FileManagerProps) {
  const { t, i18n } = useTranslation(['files', 'common', 'tabs', 'auth']);

  // Only use Supabase FileManager - no localStorage fallback
  const fileManagerState = fileManagerHook;

  // UI state for modals - MUST be called before any conditional returns
  const [showInfoModal, setShowInfoModal] = React.useState(false);
  const [infoModalData, setInfoModalData] = React.useState<{
    title: string;
    items: Array<{ label: string; value: string }>
  }>({ title: '', items: [] });

  // Import conflict state
  const [importConflicts, setImportConflicts] = React.useState<ImportConflict[]>([]);
  const [currentConflictIndex, setCurrentConflictIndex] = React.useState(0);
  const [showConflictModal, setShowConflictModal] = React.useState(false);
  const [conflictResolution, setConflictResolution] = React.useState<'overwrite' | 'skip' | null>(null);
  const [pendingImports, setPendingImports] = React.useState<Array<{
    type: 'track' | 'multitrack';
    name: string;
    code: string;
    folder?: string;
    isMultitrack?: boolean;
    steps?: any[];
    activeStep?: number;
  }>>([]);

  // Always call the operations hook, but with safe defaults when no fileManagerState
  const operations = useFileManagerOperations(fileManagerState ? {
    ...fileManagerState,
    context,
    t,
    deleteTrack: fileManagerState.deleteTrack,
  } : {
    // Provide safe defaults when fileManagerState is null
    tracks: {},
    folders: {},
    selectedTrack: null,
    trackToDelete: null,
    newTrackName: '',
    newFolderName: '',
    newItemParentPath: '',
    newStepName: '',
    renamingTrack: null,
    renamingFolder: null,
    renamingStep: null,
    renameValue: '',
    folderToDelete: null,
    setTracks: () => {},
    setFolders: () => {},
    setSelectedTrack: () => {},
    setNewTrackName: () => {},
    setNewFolderName: () => {},
    setNewItemParentPath: () => {},
    setIsCreating: () => {},
    setIsCreatingFolder: () => {},
    setIsCreatingStep: () => {},
    setNewStepName: () => {},
    setSelectedStepTrack: () => {},
    setTrackToDelete: () => {},
    setShowDeleteModal: () => {},
    setFolderToDelete: () => {},
    setShowDeleteFolderModal: () => {},
    setFolderContents: () => {},
    setRenamingTrack: () => {},
    setRenamingFolder: () => {},
    setRenamingStep: () => {},
    setRenameValue: () => {},
    loadTrack: () => {},
    saveCurrentTrack: async () => false,
    createTrack: undefined,
    createFolder: undefined,
    updateFolder: undefined,
    deleteTrack: undefined,
    isDeletingTrackRef: { current: false },
    isDeletingFolderRef: { current: new Set() },
    context,
    t,
  });

  // If no fileManagerHook (unauthenticated), show sign-in prompt
  if (!fileManagerState) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-lineHighlight">
        <div className="mb-6">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-xl font-semibold text-foreground mb-2">
            {t('auth:signInRequired')}
          </h3>
          <p className="text-gray-400 mb-6">
            {t('auth:signInDescription')}
          </p>
        </div>
        <div className="text-sm text-gray-500">
          <p>{t('common:clickAuthButtonToSignIn')}</p>
        </div>
      </div>
    );
  }

  // At this point we know fileManagerState exists and operations has real data

  // Don't show any loading states or authentication messages
  // Just use the regular FileManager functionality

  const handleTrackInfo = (track: any) => {
    setInfoModalData({
      title: `${t('files:trackProperties')} - ${track.name}`,
      items: [
        { label: t('files:name'), value: track.name },
        { label: t('files:created'), value: formatDateTimeIntl(new Date(track.created), i18n.language) },
        { label: t('files:modified'), value: formatDateTimeIntl(new Date(track.modified), i18n.language) },
        { label: t('files:linesOfCode'), value: track.code.split('\n').length.toString() },
        { label: t('files:characters'), value: track.code.length.toString() },
        { label: t('files:size'), value: `${(new Blob([track.code]).size / 1024).toFixed(2)} KB` },
        { label: t('files:folder'), value: track.folder || t('files:rootFolder') },
      ]
    });
    setShowInfoModal(true);
  };

  const getEmptySpaceContextItems = () => [
    {
      label: t('files:newTrack'),
      icon: <span>+</span>,
      onClick: () => operations.handleTrackCreate(),
    },
    {
      label: t('files:newFolder'),
      icon: <span>📁</span>,
      onClick: () => operations.handleFolderCreate(),
    },
    ...(Object.keys(fileManagerState.tracks).length > 0 || Object.keys(fileManagerState.folders).length > 0 ? [
      {
        label: t('files:exportLibraryAsZip'),
        icon: <span>📦</span>,
        onClick: () => operations.downloadFolder(''),
      },
      {
        label: t('files:deleteAllTracks'),
        icon: <span>🗑️</span>,
        onClick: () => fileManagerState.setShowDeleteAllModal(true),
        className: 'text-red-400 hover:text-red-300',
      }
    ] : []),
    {
      label: t('files:importLibraryFromZip'),
      icon: <span>📥</span>,
      onClick: () => {
        const input = document.getElementById('library-import-input') as HTMLInputElement;
        if (input) {
          input.onchange = (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (files && files[0]) {
              handleFileImport(files[0]);
            }
          };
          input.click();
        }
      },
    },
  ];

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fileManagerState.setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fileManagerState.setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fileManagerState.setIsDragOver(false);

    // Check if we have items (supports folders) or just files
    const items = e.dataTransfer.items;

    if (items) {
      // Use DataTransferItemList API for folder support
      const entries: FileSystemEntry[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          // TypeScript doesn't have types for webkitGetAsEntry, so we cast
          const entry = (item as any).webkitGetAsEntry?.();
          if (entry) {
            entries.push(entry);
          }
        }
      }

      try {
        for (const entry of entries) {
          if (entry.isDirectory) {
            await handleFolderDrop(entry as FileSystemDirectoryEntry);
          } else if (entry.isFile) {
            const file = await getFileFromEntry(entry as FileSystemFileEntry);
            if (file) {
              await handleFileImport(file);
            }
          }
        }
      } catch (error) {
        console.error('Error handling dropped items:', error);
        toastActions.error(t('files:errors.importFailed'));
      }
    } else {
      // Fallback to files API
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      try {
        for (const file of files) {
          await handleFileImport(file);
        }
      } catch (error) {
        console.error('Error handling dropped files:', error);
        toastActions.error(t('files:errors.importFailed'));
      }
    }
  };

  // Helper to get File from FileSystemFileEntry
  const getFileFromEntry = (entry: FileSystemFileEntry): Promise<File> => {
    return new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });
  };

  // Handle folder drop (check if it's a multitrack)
  const handleFolderDrop = async (dirEntry: FileSystemDirectoryEntry) => {
    console.log('Folder dropped:', dirEntry.name);

    try {
      // Read folder contents
      const entries = await readDirectory(dirEntry);

      // Check if this is a multitrack folder (has metadata.json)
      const hasMetadata = entries.some(e => e.isFile && e.name === 'metadata.json');

      if (hasMetadata) {
        console.log('Detected multitrack folder:', dirEntry.name);
        await handleMultitrackFolderImport(dirEntry, entries);
      } else {
        // Regular folder - show info
        toastActions.info(t('files:folderImportNotSupported'));
      }
    } catch (error) {
      console.error('Error handling folder drop:', error);
      toastActions.error(t('files:errors.importFailed'));
    }
  };

  // Read directory entries
  const readDirectory = (dirEntry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> => {
    return new Promise((resolve, reject) => {
      const reader = dirEntry.createReader();
      const entries: FileSystemEntry[] = [];

      const readEntries = () => {
        reader.readEntries((results) => {
          if (results.length === 0) {
            resolve(entries);
          } else {
            entries.push(...results);
            readEntries(); // Continue reading if there are more entries
          }
        }, reject);
      };

      readEntries();
    });
  };

  // Import multitrack from folder
  const handleMultitrackFolderImport = async (
    dirEntry: FileSystemDirectoryEntry,
    entries: FileSystemEntry[]
  ) => {
    try {
      // Read metadata.json
      const metadataEntry = entries.find(e => e.isFile && e.name === 'metadata.json') as FileSystemFileEntry;
      if (!metadataEntry) {
        toastActions.error(t('files:invalidMultitrackFile'));
        return;
      }

      const metadataFile = await getFileFromEntry(metadataEntry);
      const metadataText = await metadataFile.text();
      const metadata = JSON.parse(metadataText);

      // Validate metadata
      if (metadata.tracks || metadata.folders || metadata.exportDate) {
        toastActions.error(t('files:invalidMultitrackFile'));
        return;
      }

      const trackName = metadata.name || metadata.trackName || dirEntry.name;

      // Find step files
      const stepFiles = entries
        .filter(e => e.isFile && e.name.match(/\.(js|txt)$/i))
        .filter(e => e.name !== 'metadata.json')
        .sort((a, b) => a.name.localeCompare(b.name));

      if (stepFiles.length === 0) {
        toastActions.error(t('files:noValidStepsFound'));
        return;
      }

      // Read all step files
      const steps: any[] = [];
      for (let i = 0; i < stepFiles.length; i++) {
        const stepEntry = stepFiles[i] as FileSystemFileEntry;
        const stepFile = await getFileFromEntry(stepEntry);
        const stepContent = await stepFile.text();
        const stepName = metadata.steps?.[i]?.name || `Step ${i + 1}`;

        steps.push({
          id: `step_${i}`,
          name: stepName,
          code: stepContent,
          created: metadata.steps?.[i]?.created || new Date().toISOString(),
          modified: metadata.steps?.[i]?.modified || new Date().toISOString(),
        });
      }

      // Check for conflicts
      const existingTrack = checkTrackExists(trackName);

      if (existingTrack) {
        // Show conflict modal
        setImportConflicts([{
          type: 'multitrack',
          name: trackName,
          path: existingTrack.folder || '',
          existingItem: {
            created: existingTrack.created,
            modified: existingTrack.modified,
          },
          newItem: {
            stepsCount: steps.length,
          }
        }]);
        setPendingImports([{
          type: 'multitrack',
          name: trackName,
          code: steps[0]?.code || '',
          folder: existingTrack.folder,
          isMultitrack: true,
          steps,
          activeStep: metadata.activeStep || 0,
        }]);
        setCurrentConflictIndex(0);
        setShowConflictModal(true);
        return;
      }

      // No conflict, import directly
      if (fileManagerHook && fileManagerHook.isAuthenticated && fileManagerHook.createTrack) {
        const createdTrack = await fileManagerHook.createTrack(
          trackName,
          steps[0]?.code || '',
          undefined,
          true,
          steps,
          metadata.activeStep || 0
        );

        if (createdTrack) {
          toastActions.success(t('files:multitrackImported', { name: trackName }));

          await new Promise(resolve => setTimeout(resolve, 100));
          fileManagerHook.loadTrack(createdTrack);

          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
          }, 150);
        }
      } else {
        toastActions.error(t('auth:signInRequired'));
      }
    } catch (error) {
      console.error('Error importing multitrack folder:', error);
      toastActions.error(t('files:multitrackImportFailed'));
    }
  };

  const handleFileImport = async (file: File) => {
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.zip')) {
      await handleZipImport(file);
    } else if (fileName.endsWith('.js') || fileName.endsWith('.txt') || fileName.endsWith('.md')) {
      await handleTrackImport(file);
    } else {
      toastActions.warning(t('files:invalidFileType'));
    }
  };

  // Helper to check if track name exists
  const checkTrackExists = (name: string, folder?: string): Track | null => {
    const tracksArray = Object.values(fileManagerState.tracks);
    return tracksArray.find(track =>
      track.name === name && (track.folder || null) === (folder || null)
    ) || null;
  };

  // Handle conflict resolution
  const handleConflictResolution = async (resolution: 'overwrite' | 'skip' | 'overwriteAll' | 'skipAll') => {
    if (resolution === 'overwriteAll') {
      setConflictResolution('overwrite');
      setShowConflictModal(false);
      // Process all pending imports with overwrite
      await processPendingImports('overwrite');
    } else if (resolution === 'skipAll') {
      setConflictResolution('skip');
      setShowConflictModal(false);
      // Process all pending imports with skip
      await processPendingImports('skip');
    } else {
      // Handle single conflict
      const currentImport = pendingImports[currentConflictIndex];
      if (resolution === 'overwrite' && currentImport) {
        await importTrackWithOverwrite(currentImport);
      }

      // Move to next conflict or finish
      if (currentConflictIndex < importConflicts.length - 1) {
        setCurrentConflictIndex(currentConflictIndex + 1);
      } else {
        setShowConflictModal(false);
        setImportConflicts([]);
        setPendingImports([]);
        setCurrentConflictIndex(0);
        setConflictResolution(null);
      }
    }
  };

  const importTrackWithOverwrite = async (importData: typeof pendingImports[0]) => {
    if (!fileManagerHook || !fileManagerHook.isAuthenticated) return;

    try {
      // Find existing track
      const existing = checkTrackExists(importData.name, importData.folder);

      if (existing) {
        // Update existing track
        const { data, error } = await db.tracks.update(existing.id, {
          code: importData.code,
          isMultitrack: importData.isMultitrack,
          steps: importData.steps,
          activeStep: importData.activeStep,
        });

        if (!error && data) {
          toastActions.success(t('files:trackImported', { name: importData.name }));
        }
      } else {
        // Create new track
        await fileManagerHook.createTrack(
          importData.name,
          importData.code,
          importData.folder,
          importData.isMultitrack,
          importData.steps,
          importData.activeStep
        );
        toastActions.success(t('files:trackImported', { name: importData.name }));
      }
    } catch (error) {
      console.error('Error importing track:', error);
      toastActions.error(t('files:errors.importFailed'));
    }
  };

  const processPendingImports = async (defaultResolution: 'overwrite' | 'skip') => {
    for (let i = 0; i < pendingImports.length; i++) {
      const importData = pendingImports[i];
      const conflict = importConflicts[i];

      if (conflict && defaultResolution === 'overwrite') {
        await importTrackWithOverwrite(importData);
      } else if (!conflict) {
        // No conflict, just import
        await importTrackWithOverwrite(importData);
      }
      // If skip, do nothing
    }

    // Cleanup
    setImportConflicts([]);
    setPendingImports([]);
    setCurrentConflictIndex(0);
    setConflictResolution(null);

    // Refresh data
    if (fileManagerHook.loadDataFromSupabase) {
      await fileManagerHook.loadDataFromSupabase();
    }
  };

  const handleTrackImport = async (file: File) => {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (event) => {
        try {
          const content = event.target?.result as string;
          const trackName = file.name.replace(/\.(js|txt|md)$/, '');

          // Check if track already exists
          const existingTrack = checkTrackExists(trackName);

          if (existingTrack) {
            // Show conflict modal
            setImportConflicts([{
              type: 'track',
              name: trackName,
              path: existingTrack.folder || '',
              existingItem: {
                created: existingTrack.created,
                modified: existingTrack.modified,
              },
              newItem: {
                size: new Blob([content]).size,
              }
            }]);
            setPendingImports([{
              type: 'track',
              name: trackName,
              code: content,
              folder: existingTrack.folder,
            }]);
            setCurrentConflictIndex(0);
            setShowConflictModal(true);
            resolve();
            return;
          }

          // No conflict, proceed with import
          if (fileManagerHook && fileManagerHook.isAuthenticated && fileManagerHook.createTrack) {
            console.log('FileManager - Importing track to Supabase:', trackName, 'code length:', content.length);
            const createdTrack = await fileManagerHook.createTrack(trackName, content);
            if (createdTrack) {
              console.log('FileManager - Track created in database:', createdTrack.id, 'code length:', createdTrack.code?.length);
              toastActions.success(t('files:trackImported', { name: trackName }));

              await new Promise(resolve => setTimeout(resolve, 300));

              const trackUrl = generateTrackUrlPath(createdTrack.name, createdTrack.folder, fileManagerState.folders);
              window.history.pushState({}, '', trackUrl);

              const trackPath = trackUrl.replace('/repl/', '');
              setActivePattern(trackPath);

              fileManagerHook.loadTrack(createdTrack);

              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
              }, 150);
            } else {
              console.error('FileManager - Failed to create track in database');
            }
          } else {
            console.error('FileManager - User not authenticated, cannot import track');
            toastActions.error(t('auth:signInRequired'));
          }

          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
          }, 150);

          resolve();
        } catch (error) {
          console.error('Error importing track:', error);
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const handleZipImport = async (file: File) => {
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(file);

      // Debug: Log all files in the ZIP
      const allFiles = Object.keys(zipContent.files);
      console.log('ZIP Import Debug - Files in ZIP:', allFiles);

      // Check if this is a library export (has library-metadata.json)
      const hasLibraryMetadata = allFiles.includes('library-metadata.json');
      console.log('ZIP Import Debug - Has library metadata:', hasLibraryMetadata);

      // If it has library metadata, it's ALWAYS a library, regardless of what's inside
      if (hasLibraryMetadata) {
        console.log('ZIP Import Debug - Treating as library (has library-metadata.json)');
        await handleLibraryImport(zipContent);
        return;
      }

      // Only check for multitrack if it's NOT a library
      // Look for multitrack-specific metadata.json files (not library-metadata.json)
      const multitrackMetadataFiles = allFiles.filter(f =>
        f.endsWith('metadata.json') &&
        f !== 'library-metadata.json' &&
        !f.includes('library-metadata.json')
      );
      console.log('ZIP Import Debug - Found multitrack metadata files:', multitrackMetadataFiles);

      // For single multitrack detection, check if we have exactly one metadata file at root level
      const rootMetadataFiles = multitrackMetadataFiles.filter(f => !f.includes('/'));
      const hasRootMetadata = rootMetadataFiles.length === 1;

      // Check for step files pattern at root level only (for single multitrack)
      const hasRootStepFiles = allFiles.some(filename =>
        !filename.includes('/') && (
          filename.match(/^step_\d+\.js$/i) ||
          filename.match(/^Step\s*_?\d+\.js$/i)
        )
      );
      console.log('ZIP Import Debug - Has root step files pattern:', hasRootStepFiles);
      console.log('ZIP Import Debug - Has root metadata:', hasRootMetadata);

      // Only treat as single multitrack if we have root-level metadata OR root-level step files
      const isSingleMultitrack = hasRootMetadata || hasRootStepFiles;
      console.log('ZIP Import Debug - Detected as single multitrack:', isSingleMultitrack);

      if (isSingleMultitrack) {
        console.log('ZIP Import Debug - Treating as single multitrack');
        await handleMultitrackImport(zipContent, rootMetadataFiles[0]);
      } else {
        console.log('ZIP Import Debug - Treating as library (no library metadata but contains multiple items)');
        await handleLibraryImport(zipContent);
      }
    } catch (error) {
      console.error('Error importing ZIP file:', error);
      toastActions.error(t('files:invalidLibraryFile'));
    }
  };

  const handleMultitrackImport = async (zipContent: any, metadataPath?: string) => {
    try {
      let metadataFile = null;
      let metadata: any = {};
      let trackName = 'Imported Multitrack';
      let folderPrefix = '';

      // Try to find and load metadata.json
      if (metadataPath) {
        metadataFile = zipContent.file(metadataPath);
        folderPrefix = metadataPath.includes('/') ? metadataPath.substring(0, metadataPath.lastIndexOf('/') + 1) : '';
      }

      if (metadataFile) {
        const metadataContent = await metadataFile.async('text');
        metadata = JSON.parse(metadataContent);

        // Validate that this is actually multitrack metadata (not library metadata)
        if (metadata.tracks || metadata.folders || metadata.exportDate) {
          console.log('Multitrack Debug - This appears to be library metadata, not multitrack metadata');
          // Fall back to library import
          await handleLibraryImport(zipContent);
          return;
        }

        trackName = metadata.name || metadata.trackName || 'Imported Multitrack';
        console.log('Multitrack Debug - Found metadata:', metadata, 'folderPrefix:', folderPrefix);
      } else {
        console.log('Multitrack Debug - No metadata.json, detecting steps from files');
      }

      const steps: any[] = [];
      const allFiles = Object.keys(zipContent.files);

      // Find step files with different patterns, considering folder prefix
      let stepFiles = allFiles.filter(filename => {
        // Remove folder prefix if it exists
        const relativePath = folderPrefix ? filename.replace(folderPrefix, '') : filename;
        return relativePath.match(/^step_\d+\.js$/) ||
               relativePath.match(/^Step\s+\d+\.js$/i) ||
               relativePath.match(/^\d+\.js$/) ||
               filename.match(/step_\d+\.js$/i) ||
               filename.match(/Step\s*_?\d+\.js$/i);
      }).sort();

      console.log('Multitrack Debug - Found step files:', stepFiles);

      if (stepFiles.length === 0) {
        console.log('Multitrack Debug - No step files found, falling back to library import');
        await handleLibraryImport(zipContent);
        return;
      }

      // Load all step files
      for (let i = 0; i < stepFiles.length; i++) {
        const stepFile = zipContent.file(stepFiles[i]);
        if (stepFile) {
          const stepContent = await stepFile.async('text');
          const stepName = metadata.steps?.[i]?.name || `Step ${i + 1}`;

          steps.push({
            id: `step_${i}`,
            name: stepName,
            code: stepContent,
            created: metadata.steps?.[i]?.created || new Date().toISOString(),
            modified: metadata.steps?.[i]?.modified || new Date().toISOString(),
          });
        }
      }

      if (steps.length === 0) {
        console.log('Multitrack Debug - No valid steps created, falling back to library import');
        await handleLibraryImport(zipContent);
        return;
      }

      console.log('Multitrack Debug - Created steps:', steps.length);

      const multitrackData = {
        id: nanoid(), // Use proper UUID
        name: trackName,
        code: steps[0]?.code || '',
        created: metadata.created || new Date().toISOString(),
        modified: metadata.modified || new Date().toISOString(),
        isMultitrack: true,
        steps,
        activeStep: metadata.activeStep || 0,
      };

      // Import multitrack to appropriate storage
      if (fileManagerHook && fileManagerHook.isAuthenticated && fileManagerHook.createTrack) {
        // Import to Supabase with full multitrack data
        const createdTrack = await fileManagerHook.createTrack(
          multitrackData.name,
          multitrackData.code,
          undefined, // folder
          multitrackData.isMultitrack,
          multitrackData.steps,
          multitrackData.activeStep
        );
        if (createdTrack) {
          toastActions.success(t('files:multitrackImported', { name: multitrackData.name }));
          // Load the imported track
          await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
          fileManagerHook.loadTrack(createdTrack);

          // Dispatch event to notify other components that tracks were imported
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
          }, 150);
        }
      } else {
        console.error('FileManager - User not authenticated, cannot import multitrack');
        toastActions.error(t('auth:signInRequired'));
      }

      // Dispatch event to notify other components that tracks were imported
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
      }, 150);
    } catch (error) {
      console.error('Error importing multitrack:', error);
      // Fall back to library import on error
      console.log('Multitrack Debug - Error occurred, falling back to library import');
      await handleLibraryImport(zipContent);
    }
  };

  const handleLibraryImport = async (zipContent: any) => {
    try {
      console.log('Library Import - Starting batch import process');

      // Collect all data first, then send in one batch
      const tracksToImport: any[] = [];
      const foldersToImport: any[] = [];
      const foldersToCreate = new Set<string>();

      // First pass: identify potential multitracks within the library
      const allFiles = Object.keys(zipContent.files);

      // Look for folders that might be multitracks (have metadata.json + multiple JS files)
      const potentialMultitracks = new Map<string, { metadataPath: string; stepFiles: string[] }>();

      for (const filename of allFiles) {
        if (filename.endsWith('metadata.json') && filename !== 'library-metadata.json') {
          const folderPath = filename.substring(0, filename.lastIndexOf('/'));
          if (folderPath) {
            // Check if this folder has multiple JS files (potential steps)
            const jsFiles = allFiles.filter(f =>
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
                stepFiles: jsFiles // Use all JS files as potential steps
              });
              console.log('Library Import - Found potential multitrack:', folderPath, 'with', jsFiles.length, 'files');
            }
          }
        }
      }

      // Second pass: collect all folder paths that need to be created (excluding multitrack folders)
      for (const [filename, file] of Object.entries(zipContent.files)) {
        const fileObj = file as any;
        if (filename.match(/\.(js|txt|md)$/i) && !fileObj.dir) {
          const pathParts = filename.split('/');
          if (pathParts.length > 1) {
            // Build folder path progressively, but skip if it's part of a multitrack
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

      // Prepare folders for batch creation (deduplicated)
      const uniqueFolders = new Set<string>();
      for (const folderPath of Array.from(foldersToCreate).sort()) {
        if (!uniqueFolders.has(folderPath)) {
          uniqueFolders.add(folderPath);
          const folderName = folderPath.split('/').pop() || folderPath;
          const parentPath = folderPath.includes('/') ? folderPath.substring(0, folderPath.lastIndexOf('/')) : undefined;

          foldersToImport.push({
            name: folderName,
            path: folderPath,
            parent: parentPath,
          });

          console.log(`📁 DEBUG - Preparing folder: "${folderName}" with path: "${folderPath}"`);
        }
      }

      // Third pass: prepare multitracks for batch creation (deduplicated)
      const processedMultitracks = new Set<string>();
      for (const [folderPath, multitrackInfo] of Array.from(potentialMultitracks.entries())) {
        if (processedMultitracks.has(folderPath)) {
          console.log('Library Import - Skipping duplicate multitrack:', folderPath);
          continue;
        }
        processedMultitracks.add(folderPath);

        try {
          console.log('Library Import - Processing multitrack:', folderPath);

          // Load metadata
          const metadataFile = zipContent.file(multitrackInfo.metadataPath);
          let metadata: any = {};
          let trackName = folderPath.split('/').pop() || 'Imported Multitrack';

          if (metadataFile) {
            const metadataContent = await metadataFile.async('text');
            metadata = JSON.parse(metadataContent);

            // Skip if this looks like library metadata
            if (metadata.tracks || metadata.folders || metadata.exportDate) {
              console.log('Library Import - Skipping', folderPath, '- appears to be library metadata');
              continue;
            }

            trackName = metadata.name || metadata.trackName || trackName;
          }

          // Load step files
          const steps: any[] = [];
          const sortedStepFiles = multitrackInfo.stepFiles.sort();

          for (let i = 0; i < sortedStepFiles.length; i++) {
            const stepFile = zipContent.file(sortedStepFiles[i]);
            if (stepFile) {
              const stepContent = await stepFile.async('text');
              const stepName = metadata.steps?.[i]?.name || `Step ${i + 1}`;

              steps.push({
                id: `step_${i}`,
                name: stepName,
                code: stepContent,
                created: metadata.steps?.[i]?.created || new Date().toISOString(),
                modified: metadata.steps?.[i]?.modified || new Date().toISOString(),
              });
            }
          }

          if (steps.length > 0) {
            // Calculate the correct folder path for the multitrack
            let parentFolder: string | undefined = undefined;
            if (folderPath.includes('/')) {
              parentFolder = folderPath.substring(0, folderPath.lastIndexOf('/'));
            }

            tracksToImport.push({
              name: trackName,
              code: steps[0]?.code || '',
              folder: parentFolder,
              isMultitrack: true,
              steps,
              activeStep: metadata.activeStep || 0,
            });

            console.log(`🎵 DEBUG - Preparing multitrack: "${trackName}" for folder: "${parentFolder || 'root'}"`);
          }
        } catch (error) {
          console.error('Library Import - Error processing multitrack:', folderPath, error);
        }
      }

      // Fourth pass: prepare regular tracks for batch creation (excluding multitrack step files, deduplicated)
      const processedTracks = new Set<string>();
      for (const [filename, file] of Object.entries(zipContent.files)) {
        const fileObj = file as any;
        if (filename.match(/\.(js|txt|md)$/i) && !fileObj.dir) {
          // Skip if this file is part of a multitrack
          const isPartOfMultitrack = Array.from(potentialMultitracks.values()).some(mt =>
            mt.stepFiles.includes(filename) || filename === mt.metadataPath
          );

          if (isPartOfMultitrack) {
            console.log('Library Import - Skipping multitrack file:', filename);
            continue;
          }

          const pathParts = filename.split('/');
          const trackName = pathParts[pathParts.length - 1].replace(/\.(js|txt|md)$/i, '');
          const folderPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : undefined;

          // Create unique key to prevent duplicates
          const trackKey = `${trackName}:${folderPath || 'root'}`;
          if (processedTracks.has(trackKey)) {
            console.log('Library Import - Skipping duplicate track:', trackKey);
            continue;
          }
          processedTracks.add(trackKey);

          const content = await fileObj.async('text');

          tracksToImport.push({
            name: trackName,
            code: content,
            folder: folderPath,
          });

          console.log(`📄 DEBUG - Preparing track: "${trackName}" for folder: "${folderPath || 'root'}"`);
        }
      }

      console.log('Library Import - Prepared for batch import:', {
        tracks: tracksToImport.length,
        folders: foldersToImport.length
      });

      // Perform batch import to Supabase (authentication required)
      if (!fileManagerHook || !fileManagerHook.isAuthenticated) {
        console.error('Library Import - User not authenticated');
        toastActions.error(t('auth:signInRequired'));
        return;
      }

      // Use batch import for Supabase
      console.log('Library Import - Sending batch import to Supabase...');
      const { data: result, error } = await batch.importLibrary({
        tracks: tracksToImport,
        folders: foldersToImport
      });

      if (error) {
        console.error('Library Import - Batch import failed:', error);
        toastActions.error(t('files:errors.importFailed'));
        return;
      }

      if (result && result.success) {
        const { tracksCreated, foldersCreated, totalCreated, errors } = result.results;

        console.log('Library Import - Batch import completed:', result.results);

        // DEBUG: Log the data structure before refresh
        console.log('🔍 DEBUG - Data before refresh:', {
          tracksToImport: tracksToImport.length,
          foldersToImport: foldersToImport.length,
          sampleTracks: tracksToImport.slice(0, 2).map(t => ({ name: t.name, folder: t.folder })),
          sampleFolders: foldersToImport.slice(0, 2).map(f => ({ name: f.name, path: f.path }))
        });

        // Show success message
        let message = '';
        if (tracksCreated > 0 && foldersCreated > 0) {
          message = `${tracksCreated} tracks and ${foldersCreated} folders imported!`;
        } else if (tracksCreated > 0) {
          message = `${tracksCreated} tracks imported!`;
        } else if (foldersCreated > 0) {
          message = `${foldersCreated} folders imported!`;
        } else {
          message = `${totalCreated} items imported!`;
        }

        if (errors && errors.length > 0) {
          console.warn('Library Import - Some errors occurred:', errors);
          message += ` (${errors.length} errors)`;
        }

        toastActions.success(message);

        // Refresh data from Supabase
        console.log('Library Import - Refreshing data from Supabase...');
        if (fileManagerHook.loadDataFromSupabase) {
          await fileManagerHook.loadDataFromSupabase();

          // Give React more time to process state updates and re-render
          await new Promise(resolve => setTimeout(resolve, 500));

          console.log('Library Import - Data refresh completed, UI should now show updated structure');
        }

        // Dispatch event to notify other components
        setTimeout(() => {
          console.log('Library Import - Dispatching strudel-tracks-imported event');
          window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
        }, 300);
      }
    } catch (error) {
      console.error('Library Import - Error:', error);
      toastActions.error(t('files:errors.importFailed'));
    }
  };

  return (
    <div
      className={`h-full flex flex-col bg-lineHighlight text-foreground relative ${
        fileManagerState.isDragOver ? 'bg-blue-900/20 border-2 border-blue-500 border-dashed' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <DragDropOverlay isDragOver={fileManagerState.isDragOver} t={t} />

      <FileManagerHeader
        t={t}
        isCreating={fileManagerState.isCreating}
        isCreatingFolder={fileManagerState.isCreatingFolder}
        isCreatingStep={fileManagerState.isCreatingStep}
        newTrackName={fileManagerState.newTrackName}
        newFolderName={fileManagerState.newFolderName}
        newStepName={fileManagerState.newStepName}
        selectedStepTrack={fileManagerState.selectedStepTrack}
        setNewTrackName={fileManagerState.setNewTrackName}
        setNewFolderName={fileManagerState.setNewFolderName}
        setNewStepName={fileManagerState.setNewStepName}
        onCreateTrack={async () => {
          if (fileManagerState.createTrack) {
            // Use Supabase file manager's createTrack function
            const newTrack = await fileManagerState.createTrack(
              fileManagerState.newTrackName.trim(),
              DEFAULT_TRACK_CODE,
              fileManagerState.newItemParentPath || undefined
            );
            if (newTrack) {
              fileManagerState.setNewTrackName('');
              fileManagerState.setNewItemParentPath('');
              fileManagerState.setIsCreating(false);
              // Load the newly created track
              if (fileManagerState.loadTrack) {
                fileManagerState.loadTrack(newTrack);
              }
            }
          } else {
            // Fallback to operations if Supabase not available
            operations.createNewTrack();
          }
        }}
        onCreateFolder={async () => {
          if (fileManagerState.createFolder) {
            // Use Supabase file manager's createFolder function
            const folderName = fileManagerState.newFolderName.trim();
            const parentPath = fileManagerState.newItemParentPath;
            const folderPath = parentPath ? `${parentPath}/${folderName}` : folderName;

            const newFolder = await fileManagerState.createFolder(folderName, folderPath, parentPath);
            if (newFolder) {
              fileManagerState.setNewFolderName('');
              fileManagerState.setNewItemParentPath('');
              fileManagerState.setIsCreating(false);
            }
          } else {
            // Fallback to operations if Supabase not available
            operations.createNewFolder();
          }
        }}
        onAddStep={operations.addStep}
        onCancelCreate={operations.cancelCreate}
        onCancelCreateStep={operations.cancelCreateStep}
        getEmptySpaceContextItems={getEmptySpaceContextItems}
      />

      <div className="flex-1 overflow-hidden mb-16">
        <FileTree
          key={`${Object.keys(fileManagerState.tracks).length}-${Object.keys(fileManagerState.folders).length}`}
          tracks={fileManagerState.tracks}
          folders={fileManagerState.folders}
          selectedTrack={fileManagerState.selectedTrack}
          activePattern={fileManagerState.activePattern}
          onTrackSelect={operations.handleTrackSelect}
          onTrackRename={operations.handleTrackRename}
          onTrackDelete={operations.deleteTrack}
          onTrackDuplicate={operations.duplicateTrack}
          onTrackInfo={handleTrackInfo}
          onTrackDownload={operations.downloadTrack}
          onFolderDownload={operations.downloadFolder}
          onTrackCreate={operations.handleTrackCreate}
          onFolderCreate={operations.handleFolderCreate}
          onFolderRename={operations.handleFolderRename}
          onFolderDelete={operations.deleteFolder}
          onMoveItem={operations.handleMoveItem}
          renamingTrack={fileManagerState.renamingTrack}
          renamingFolder={fileManagerState.renamingFolder}
          renameValue={fileManagerState.renameValue}
          setRenameValue={fileManagerState.setRenameValue}
          onRenameFinish={fileManagerState.renamingTrack ? operations.finishRename : operations.finishRenameFolder}
          onRenameCancel={operations.cancelRename}
          emptySpaceContextItems={getEmptySpaceContextItems()}
          onConvertToMultitrack={operations.convertToMultitrack}
          onAddStep={(trackId) => {
            fileManagerState.setSelectedStepTrack(trackId);
            fileManagerState.setIsCreatingStep(true);
          }}
          onSwitchStep={operations.switchToStep}
          onRenameStep={operations.startRenameStep}
          onDeleteStep={operations.deleteStep}
          renamingStep={fileManagerState.renamingStep}
          onRenameStepFinish={operations.finishRenameStep}
          onRenameStepCancel={operations.cancelRename}
        />
      </div>

      <FileManagerFooter
        selectedTrack={fileManagerState.selectedTrack}
        activePattern={fileManagerState.activePattern}
        tracks={fileManagerState.tracks}
        saveStatus={fileManagerState.saveStatus}
        t={t}
        onSaveCurrentTrack={async () => { await fileManagerState.saveCurrentTrack(true); }}
      />

      {/* Modals */}
      <InfoModal
        isOpen={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        title={infoModalData.title}
        items={infoModalData.items}
      />

      <ImportConflictModal
        isOpen={showConflictModal}
        onClose={() => {
          setShowConflictModal(false);
          setImportConflicts([]);
          setPendingImports([]);
          setCurrentConflictIndex(0);
        }}
        conflicts={importConflicts}
        currentIndex={currentConflictIndex}
        onResolve={handleConflictResolution}
      />

      <ConfirmModal
        isOpen={fileManagerState.showDeleteModal}
        onClose={() => {
          fileManagerState.setShowDeleteModal(false);
          fileManagerState.setTrackToDelete(null);
          fileManagerState.isDeletingTrackRef.current = false;
        }}
        onConfirm={operations.confirmDelete}
        title={t('files:deleteTrack')}
        message={`${t('files:confirmDeleteTrack')} "${
          fileManagerState.trackToDelete ? fileManagerState.tracks[fileManagerState.trackToDelete]?.name : ''
        }"? ${t('files:actionCannotBeUndone')}`}
        confirmText={t('common:delete')}
        cancelText={t('common:cancel')}
        variant="danger"
      />

      <ConfirmModal
        isOpen={fileManagerState.showDeleteFolderModal}
        onClose={() => {
          fileManagerState.setShowDeleteFolderModal(false);
          fileManagerState.setFolderToDelete(null);
          fileManagerState.setFolderContents({subfolders: [], tracks: []});
        }}
        onConfirm={operations.confirmFolderDelete}
        title={t('files:deleteFolder')}
        message={
          fileManagerState.folderToDelete ? (
            <div>
              <p>{t('files:confirmDeleteFolder')} "{fileManagerState.folders[fileManagerState.folderToDelete]?.name}"?</p>
              <p className="mt-2 text-sm text-gray-400">{t('files:folderContainsItems')}:</p>
              <ul className="mt-1 text-sm text-gray-300 list-disc list-inside">
                {fileManagerState.folderContents.subfolders.map(name => (
                  <li key={name}>📁 {name}</li>
                ))}
                {fileManagerState.folderContents.tracks.map(name => (
                  <li key={name}>📄 {name}</li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-red-400">{t('files:actionCannotBeUndone')}</p>
            </div>
          ) : ''
        }
        confirmText={t('common:delete')}
        cancelText={t('common:cancel')}
        variant="danger"
      />

      <ConfirmModal
        isOpen={fileManagerState.showDeleteAllModal}
        onClose={() => fileManagerState.setShowDeleteAllModal(false)}
        onConfirm={() => {
          if (fileManagerHook && fileManagerHook.deleteAllTracks) {
            fileManagerHook.deleteAllTracks();
          }
          fileManagerState.setShowDeleteAllModal(false);
        }}
        title={t('files:deleteAllTracks')}
        message={
          <div>
            <p>{t('files:confirmDeleteAllTracks')}</p>
            <p className="mt-2 text-sm text-red-400">
              {(() => {
                const trackCount = Object.keys(fileManagerState.tracks).length;
                const folderCount = Object.keys(fileManagerState.folders).length;

                if (trackCount > 0 && folderCount > 0) {
                  return t('files:deleteAllTracksAndFoldersWarning', {
                    trackCount,
                    folderCount
                  });
                } else if (trackCount > 0) {
                  return t('files:deleteAllTracksWarning', { count: trackCount });
                } else if (folderCount > 0) {
                  return t('files:deleteAllFoldersWarning', { count: folderCount });
                }
                return '';
              })()}
            </p>
          </div>
        }
        confirmText={t('files:deleteAllTracks')}
        cancelText={t('common:cancel')}
        variant="danger"
      />
    </div>
  );
}
