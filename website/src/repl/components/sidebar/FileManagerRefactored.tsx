import React from 'react';
import { FileTree } from './FileTree';
import { InfoModal } from '../ui/InfoModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { formatDateTimeIntl } from '@src/i18n/dateFormat';
import { useTranslation } from '@src/i18n';
import { toastActions } from '@src/stores/toastStore';

// Import our new components and hooks
import { useFileManager } from './hooks/useFileManager';
import { useFileManagerOperations } from './hooks/useFileManagerOperations';
import { FileManagerHeader } from './components/FileManagerHeader';
import { FileManagerFooter } from './components/FileManagerFooter';
import { DragDropOverlay } from './components/DragDropOverlay';

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
  const { t, i18n } = useTranslation(['files', 'common', 'tabs']);
  
  // Always call hooks at the top level
  const defaultFileManager = useFileManager(context);
  
  // Use provided hook or default to localStorage-based hook
  const fileManagerState = fileManagerHook || defaultFileManager;
  
  // Use our operations hook for complex business logic
  const operations = useFileManagerOperations({
    ...fileManagerState,
    context,
    t,
  });

  // UI state for modals
  const [showInfoModal, setShowInfoModal] = React.useState(false);
  const [infoModalData, setInfoModalData] = React.useState<{ 
    title: string; 
    items: Array<{ label: string; value: string }> 
  }>({ title: '', items: [] });

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

  const handleTrackImport = async (file: File) => {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (event) => {
        try {
          const content = event.target?.result as string;
          const trackName = file.name.replace(/\.(js|txt|md)$/, '');
          
          // Import to appropriate storage based on file manager type
          if (fileManagerHook && fileManagerHook.isAuthenticated && fileManagerHook.createTrack) {
            // Import to Supabase
            const createdTrack = await fileManagerHook.createTrack(trackName, content);
            if (createdTrack) {
              toastActions.success(t('files:trackImported', { name: trackName }));
              // Load the imported track with a small delay
              await new Promise(resolve => setTimeout(resolve, 100));
              fileManagerHook.loadTrack(createdTrack);
              
              // Dispatch event to notify other components that tracks were imported
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
              }, 150);
            }
          } else {
            // Import to localStorage
            const newTrack = {
              id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
              name: trackName,
              code: content,
              created: new Date().toISOString(),
              modified: new Date().toISOString(),
            };
            
            const savedTracks = localStorage.getItem('strudel_tracks');
            const tracks = savedTracks ? JSON.parse(savedTracks) : {};
            tracks[newTrack.id] = newTrack;
            localStorage.setItem('strudel_tracks', JSON.stringify(tracks));
            
            // Update FileManager state
            fileManagerState.setTracks(prev => ({ ...prev, [newTrack.id]: newTrack }));
            toastActions.success(t('files:trackImported', { name: trackName }));
            
            // Load the imported track with a small delay
            await new Promise(resolve => setTimeout(resolve, 100));
            fileManagerState.loadTrack(newTrack);
          }
          
          // Dispatch event to notify other components that tracks were imported
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
      
      if (hasLibraryMetadata) {
        console.log('ZIP Import Debug - Treating as library (has library-metadata.json)');
        await handleLibraryImport(zipContent);
        return;
      }
      
      // Look for multitrack-specific metadata.json files (not library-metadata.json)
      const multitrackMetadataFiles = allFiles.filter(f => 
        f.endsWith('metadata.json') && 
        f !== 'library-metadata.json' &&
        !f.includes('library-metadata.json')
      );
      console.log('ZIP Import Debug - Found multitrack metadata files:', multitrackMetadataFiles);
      
      // Check for step files pattern anywhere
      const hasStepFiles = allFiles.some(filename => 
        filename.match(/step_\d+\.js$/i) || 
        filename.match(/Step\s*_?\d+\.js$/i) ||
        filename.match(/\/step_\d+\.js$/i) ||
        filename.match(/\/Step\s*_?\d+\.js$/i)
      );
      console.log('ZIP Import Debug - Has step files pattern:', hasStepFiles);
      
      // Only treat as multitrack if we have multitrack metadata OR step files (but not library metadata)
      const isMultitrack = multitrackMetadataFiles.length > 0 || hasStepFiles;
      console.log('ZIP Import Debug - Detected as multitrack:', isMultitrack);
      
      if (isMultitrack) {
        console.log('ZIP Import Debug - Treating as multitrack');
        await handleMultitrackImport(zipContent, multitrackMetadataFiles[0]);
      } else {
        console.log('ZIP Import Debug - Treating as library');
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
        id: Date.now().toString(),
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
        // Import to localStorage
        const savedTracks = localStorage.getItem('strudel_tracks');
        const tracks = savedTracks ? JSON.parse(savedTracks) : {};
        tracks[multitrackData.id] = multitrackData;
        localStorage.setItem('strudel_tracks', JSON.stringify(tracks));
        
        fileManagerState.setTracks(prev => ({ ...prev, [multitrackData.id]: multitrackData }));
        toastActions.success(t('files:multitrackImported', { name: multitrackData.name }));
        
        // Load the imported track
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
        fileManagerState.loadTrack(multitrackData);
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
      let importedCount = 0;
      const foldersToCreate = new Set<string>();
      const multitrackFolders = new Map<string, any>(); // Track potential multitracks
      
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
              console.log('Library Import Debug - Found potential multitrack:', folderPath, 'with', jsFiles.length, 'files:', jsFiles.map(f => f.split('/').pop()));
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
      
      // Create regular folders first
      for (const folderPath of Array.from(foldersToCreate).sort()) {
        const folderName = folderPath.split('/').pop() || folderPath;
        const parentPath = folderPath.includes('/') ? folderPath.substring(0, folderPath.lastIndexOf('/')) : undefined;
        
        // Create folder in appropriate storage
        if (fileManagerHook && fileManagerHook.isAuthenticated && fileManagerHook.createFolder) {
          // Create in Supabase
          try {
            await fileManagerHook.createFolder(folderName, folderPath, parentPath);
          } catch (error) {
            console.warn('Folder creation failed in Supabase:', error);
          }
        } else {
          // Create in localStorage
          const newFolder = {
            id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
            name: folderName,
            path: folderPath,
            parent: parentPath,
            created: new Date().toISOString(),
          };
          
          const savedFolders = localStorage.getItem('strudel_folders');
          const folders = savedFolders ? JSON.parse(savedFolders) : {};
          folders[newFolder.id] = newFolder;
          localStorage.setItem('strudel_folders', JSON.stringify(folders));
          
          fileManagerState.setFolders(prev => ({ ...prev, [newFolder.id]: newFolder }));
        }
      }
      
      // Third pass: handle multitracks
      for (const [folderPath, multitrackInfo] of potentialMultitracks) {
        try {
          console.log('Library Import Debug - Processing multitrack:', folderPath);
          
          // Load metadata
          const metadataFile = zipContent.file(multitrackInfo.metadataPath);
          let metadata: any = {};
          let trackName = folderPath.split('/').pop() || 'Imported Multitrack';
          
          if (metadataFile) {
            const metadataContent = await metadataFile.async('text');
            metadata = JSON.parse(metadataContent);
            
            // Skip if this looks like library metadata
            if (metadata.tracks || metadata.folders || metadata.exportDate) {
              console.log('Library Import Debug - Skipping', folderPath, '- appears to be library metadata');
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
            const multitrackData = {
              id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
              name: trackName,
              code: steps[0]?.code || '',
              created: metadata.created || new Date().toISOString(),
              modified: metadata.modified || new Date().toISOString(),
              isMultitrack: true,
              steps,
              activeStep: metadata.activeStep || 0,
              folder: folderPath.includes('/') ? folderPath.substring(0, folderPath.lastIndexOf('/')) : undefined, // Preserve parent folder
            };

            // Import multitrack to appropriate storage
            if (fileManagerHook && fileManagerHook.isAuthenticated && fileManagerHook.createTrack) {
              // Import to Supabase
              const createdTrack = await fileManagerHook.createTrack(
                multitrackData.name, 
                multitrackData.code,
                multitrackData.folder, // Pass the folder path
                multitrackData.isMultitrack,
                multitrackData.steps,
                multitrackData.activeStep
              );
              if (createdTrack) {
                importedCount++;
                console.log('Library Import Debug - Successfully imported multitrack:', trackName, 'to folder:', multitrackData.folder);
              }
            } else {
              // Import to localStorage
              const savedTracks = localStorage.getItem('strudel_tracks');
              const tracks = savedTracks ? JSON.parse(savedTracks) : {};
              tracks[multitrackData.id] = multitrackData;
              localStorage.setItem('strudel_tracks', JSON.stringify(tracks));
              
              fileManagerState.setTracks(prev => ({ ...prev, [multitrackData.id]: multitrackData }));
              importedCount++;
              console.log('Library Import Debug - Successfully imported multitrack:', trackName, 'to folder:', multitrackData.folder);
            }
          }
        } catch (error) {
          console.error('Library Import Debug - Error processing multitrack:', folderPath, error);
        }
      }
      
      // Fourth pass: import regular tracks (excluding multitrack step files)
      for (const [filename, file] of Object.entries(zipContent.files)) {
        const fileObj = file as any;
        if (filename.match(/\.(js|txt|md)$/i) && !fileObj.dir) {
          // Skip if this file is part of a multitrack
          const isPartOfMultitrack = Array.from(potentialMultitracks.values()).some(mt => 
            mt.stepFiles.includes(filename) || filename === mt.metadataPath
          );
          
          if (isPartOfMultitrack) {
            console.log('Library Import Debug - Skipping multitrack file:', filename);
            continue;
          }
          
          const content = await fileObj.async('text');
          const pathParts = filename.split('/');
          const trackName = pathParts[pathParts.length - 1].replace(/\.(js|txt|md)$/i, '');
          const folderPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : undefined;
          
          // Import to appropriate storage
          if (fileManagerHook && fileManagerHook.isAuthenticated && fileManagerHook.createTrack) {
            // Import to Supabase
            const createdTrack = await fileManagerHook.createTrack(trackName, content, folderPath);
            if (createdTrack) {
              importedCount++;
            }
          } else {
            // Import to localStorage
            const newTrack = {
              id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
              name: trackName,
              code: content,
              created: new Date().toISOString(),
              modified: new Date().toISOString(),
              folder: folderPath,
            };
            
            const savedTracks = localStorage.getItem('strudel_tracks');
            const tracks = savedTracks ? JSON.parse(savedTracks) : {};
            tracks[newTrack.id] = newTrack;
            localStorage.setItem('strudel_tracks', JSON.stringify(tracks));
            
            fileManagerState.setTracks(prev => ({ ...prev, [newTrack.id]: newTrack }));
            importedCount++;
          }
        }
      }
      
      if (importedCount > 0 || potentialMultitracks.size > 0) {
        const folderCount = foldersToCreate.size;
        const multitrackCount = potentialMultitracks.size;
        const regularTrackCount = importedCount - multitrackCount;
        
        let message = '';
        if (regularTrackCount > 0 && multitrackCount > 0 && folderCount > 0) {
          message = `${regularTrackCount} tracks, ${multitrackCount} multitracks and ${folderCount} folders imported!`;
        } else if (regularTrackCount > 0 && folderCount > 0) {
          message = `${regularTrackCount} tracks and ${folderCount} folders imported!`;
        } else if (multitrackCount > 0 && folderCount > 0) {
          message = `${multitrackCount} multitracks and ${folderCount} folders imported!`;
        } else if (importedCount > 0) {
          message = `${importedCount} items imported!`;
        }
        
        toastActions.success(message);
        
        // Refresh data if using Supabase
        if (fileManagerHook && fileManagerHook.isAuthenticated && fileManagerHook.loadDataFromSupabase) {
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait for database operations
          await fileManagerHook.loadDataFromSupabase();
        }
        
        // Dispatch event to notify other components that tracks were imported
        setTimeout(() => {
          console.log('FileManager - dispatching strudel-tracks-imported event after library import');
          window.dispatchEvent(new CustomEvent('strudel-tracks-imported'));
        }, 600);
      } else {
        toastActions.warning('No valid track files found in ZIP');
      }
    } catch (error) {
      console.error('Error importing library:', error);
      toastActions.error(t('files:invalidLibraryFile'));
    }
  };

  return (
    <div
      className={`h-full flex flex-col bg-lineHighlight text-foreground ${
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
        onCreateTrack={operations.createNewTrack}
        onCreateFolder={operations.createNewFolder}
        onAddStep={operations.addStep}
        onCancelCreate={operations.cancelCreate}
        onCancelCreateStep={operations.cancelCreateStep}
        getEmptySpaceContextItems={getEmptySpaceContextItems}
      />

      <FileTree
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
            // Supabase version
            fileManagerHook.deleteAllTracks();
          } else {
            // localStorage version
            operations.deleteAllTracks();
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