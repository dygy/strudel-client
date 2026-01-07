import { useCallback } from 'react';
import { toastActions } from '@src/stores/toastStore';
import { tracksActions } from '@src/stores/tracksStore';
import { nanoid } from 'nanoid';
import { DEFAULT_TRACK_CODE } from '@src/constants/defaultCode';
import { setActivePattern } from '@src/user_pattern_utils';
import type { Track, TrackStep, Folder } from './useFileManager';

interface UseFileManagerOperationsProps {
  tracks: Record<string, Track>;
  folders: Record<string, Folder>;
  selectedTrack: string | null;
  newTrackName: string;
  newFolderName: string;
  newItemParentPath: string;
  newStepName: string;
  renamingTrack: string | null;
  renamingFolder: string | null;
  renamingStep: { trackId: string; stepIndex: number } | null;
  renameValue: string;
  folderToDelete: string | null;
  setTracks: (tracks: Record<string, Track> | ((prev: Record<string, Track>) => Record<string, Track>)) => void;
  setFolders: (folders: Record<string, Folder> | ((prev: Record<string, Folder>) => Record<string, Folder>)) => void;
  setSelectedTrack: (trackId: string | null) => void;
  setNewTrackName: (name: string) => void;
  setNewFolderName: (name: string) => void;
  setNewItemParentPath: (path: string) => void;
  setIsCreating: (creating: boolean) => void;
  setIsCreatingFolder: (creating: boolean) => void;
  setIsCreatingStep: (creating: boolean) => void;
  setNewStepName: (name: string) => void;
  setSelectedStepTrack: (trackId: string | null) => void;
  setTrackToDelete: (trackId: string | null) => void;
  setShowDeleteModal: (show: boolean) => void;
  setFolderToDelete: (folderPath: string | null) => void;
  setShowDeleteFolderModal: (show: boolean) => void;
  setFolderContents: (contents: {subfolders: string[], tracks: string[]}) => void;
  setRenamingTrack: (trackId: string | null) => void;
  setRenamingFolder: (folderPath: string | null) => void;
  setRenamingStep: (step: { trackId: string; stepIndex: number } | null) => void;
  setRenameValue: (value: string) => void;
  loadTrack: (track: Track) => void;
  saveCurrentTrack: (showToast?: boolean) => Promise<boolean>;
  isDeletingTrackRef: React.MutableRefObject<boolean>;
  isDeletingFolderRef: React.MutableRefObject<Set<string>>;
  context: any;
  t: (key: string) => string;
  // API functions
  deleteTrack?: (trackId: string) => Promise<boolean>;
}

export function useFileManagerOperations({
  tracks,
  folders,
  selectedTrack,
  newTrackName,
  newFolderName,
  newItemParentPath,
  newStepName,
  renamingTrack,
  renamingFolder,
  renamingStep,
  renameValue,
  folderToDelete,
  setTracks,
  setFolders,
  setSelectedTrack,
  setNewTrackName,
  setNewFolderName,
  setNewItemParentPath,
  setIsCreating,
  setIsCreatingFolder,
  setIsCreatingStep,
  setNewStepName,
  setSelectedStepTrack,
  setTrackToDelete,
  setShowDeleteModal,
  setFolderToDelete,
  setShowDeleteFolderModal,
  setFolderContents,
  setRenamingTrack,
  setRenamingFolder,
  setRenamingStep,
  setRenameValue,
  loadTrack,
  saveCurrentTrack,
  isDeletingTrackRef,
  isDeletingFolderRef,
  context,
  t,
  deleteTrack: deleteTrackAPI,
}: UseFileManagerOperationsProps) {

  const createNewTrack = useCallback((parentPath?: string) => {
    if (!newTrackName.trim()) return;

    const trackId = nanoid();
    const newTrack: Track = {
      id: trackId,
      name: newTrackName.trim(),
      code: DEFAULT_TRACK_CODE,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      folder: parentPath || newItemParentPath || undefined,
    };

    setTracks(prev => ({ ...prev, [trackId]: newTrack }));
    setNewTrackName('');
    setNewItemParentPath('');
    setIsCreating(false);
    loadTrack(newTrack);
  }, [newTrackName, newItemParentPath, setTracks, setNewTrackName, setNewItemParentPath, setIsCreating, loadTrack]);

  const createNewFolder = useCallback((parentPath?: string) => {
    if (!newFolderName.trim()) return;

    const folderId = nanoid();
    const targetParent = parentPath || newItemParentPath;
    const folderPath = targetParent ? `${targetParent}/${newFolderName.trim()}` : newFolderName.trim();

    const newFolder: Folder = {
      id: folderId,
      name: newFolderName.trim(),
      path: folderPath,
      parent: targetParent || undefined,
      created: new Date().toISOString(),
    };

    setFolders(prev => ({ ...prev, [folderPath]: newFolder }));
    setNewFolderName('');
    setNewItemParentPath('');
    setIsCreatingFolder(false);
  }, [newFolderName, newItemParentPath, setFolders, setNewFolderName, setNewItemParentPath, setIsCreatingFolder]);

  const handleTrackSelect = useCallback(async (track: Track) => {
    console.log('FileManager - handleTrackSelect called for:', track.name);
    
    // Clear step selection when selecting a regular track
    setSelectedStepTrack(null);
    
    // Save current track before switching if autosave is enabled
    if (selectedTrack && selectedTrack !== track.id) {
      console.log('FileManager - force saving current track before switching:', tracks[selectedTrack]?.name);
      await saveCurrentTrack(false);
    }
    
    // Trigger URL routing if TrackRouter is available
    if (context.trackRouter) {
      try {
        console.log('FileManager - triggering URL routing for track:', track.id);
        await context.trackRouter.navigateToTrack(track.id);
      } catch (error) {
        console.error('FileManager - URL routing failed:', error);
      }
    }
    
    loadTrack(track);
  }, [selectedTrack, tracks, saveCurrentTrack, context, loadTrack, setSelectedStepTrack]);

  const duplicateTrack = useCallback((track: Track) => {
    const trackId = nanoid();
    const duplicatedTrack: Track = {
      ...track,
      id: trackId,
      name: `${track.name} (copy)`,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      folder: track.folder,
      steps: track.steps ? track.steps.map(step => ({
        ...step,
        id: `${trackId}-${step.id}`,
      })) : undefined,
    };

    setTracks(prev => ({ ...prev, [trackId]: duplicatedTrack }));
    toastActions.success(t('files:trackDuplicated'));
  }, [setTracks, t]);

  const deleteTrack = useCallback((trackId: string) => {
    setTrackToDelete(trackId);
    setShowDeleteModal(true);
  }, [setTrackToDelete, setShowDeleteModal]);

  const confirmDelete = useCallback(async () => {
    if (!tracks || !setTracks || !selectedTrack) return;
    
    const trackToDelete = tracks[selectedTrack];
    if (!trackToDelete || isDeletingTrackRef.current) {
      console.log('FileManager - confirmDelete called but already deleting or no track to delete');
      return;
    }

    isDeletingTrackRef.current = true;
    
    const trackName = trackToDelete.name;
    const isSelectedTrack = selectedTrack === trackToDelete.id;
    
    console.log('FileManager - STARTING deletion process for track:', trackName, 'ID:', trackToDelete.id);
    
    const performDeletion = async () => {
      console.log('FileManager - PERFORMING actual deletion of track:', trackToDelete.id);
      
      // Call the API to delete from database if available
      if (deleteTrackAPI) {
        try {
          const success = await deleteTrackAPI(trackToDelete.id);
          if (!success) {
            console.error('FileManager - API deletion failed');
            toastActions.error(t('files:errors.deleteFailed'));
            isDeletingTrackRef.current = false;
            return;
          }
          console.log('FileManager - API deletion successful');
        } catch (error) {
          console.error('FileManager - API deletion error:', error);
          toastActions.error(t('files:errors.deleteFailed'));
          isDeletingTrackRef.current = false;
          return;
        }
      }
      
      // Update local state
      setTracks(prev => {
        const newTracks = { ...prev };
        const wasDeleted = delete newTracks[trackToDelete.id];
        console.log('FileManager - local state deletion successful:', wasDeleted);
        return newTracks;
      });
      
      // CRITICAL: Also update the global tracks store so ReplEditor can see the change
      tracksActions.removeTrack(trackToDelete.id);
      console.log('FileManager - global store updated, track removed:', trackToDelete.id);
      
      setTrackToDelete(null);
      isDeletingTrackRef.current = false;
      toastActions.success(t('files:trackDeleted'));
    };
    
    if (isSelectedTrack) {
      const remainingTrackIds = Object.keys(tracks).filter(id => id !== trackToDelete.id);
      
      if (remainingTrackIds.length > 0) {
        const nextTrackId = remainingTrackIds[0];
        const nextTrack = tracks[nextTrackId];
        console.log('FileManager - switching to next track before deletion:', nextTrack.name, 'ID:', nextTrackId);
        
        loadTrack(nextTrack);
        setTimeout(() => performDeletion(), 100);
      } else {
        console.log('FileManager - no tracks left, clearing selection');
        setSelectedTrack(null);
        
        if (context.editorRef?.current?.setCode) {
          context.editorRef.current.setCode('');
        }
        
        await performDeletion();
        
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('strudel-all-tracks-deleted'));
        }, 100);
      }
    } else {
      console.log('FileManager - deleting non-selected track immediately');
      await performDeletion();
    }
  }, [tracks, setTracks, selectedTrack, isDeletingTrackRef, setTrackToDelete, loadTrack, setSelectedTrack, context, t, deleteTrackAPI]);

  const cancelCreate = useCallback(() => {
    setIsCreating(false);
    setIsCreatingFolder(false);
    setNewTrackName('');
    setNewFolderName('');
    setNewItemParentPath('');
  }, [setIsCreating, setIsCreatingFolder, setNewTrackName, setNewFolderName, setNewItemParentPath]);

  const cancelCreateStep = useCallback(() => {
    setIsCreatingStep(false);
    setNewStepName('');
    setSelectedStepTrack(null);
  }, [setIsCreatingStep, setNewStepName, setSelectedStepTrack]);

  const handleTrackCreate = useCallback((parentPath?: string) => {
    setNewItemParentPath(parentPath || '');
    setIsCreating(true);
  }, [setNewItemParentPath, setIsCreating]);

  const handleFolderCreate = useCallback((parentPath?: string) => {
    setNewItemParentPath(parentPath || '');
    setIsCreatingFolder(true);
  }, [setNewItemParentPath, setIsCreatingFolder]);

  const handleTrackRename = useCallback((trackId: string) => {
    setRenamingTrack(trackId);
    setRenameValue(tracks[trackId]?.name || '');
  }, [setRenamingTrack, setRenameValue, tracks]);

  const handleFolderRename = useCallback((folderPath: string) => {
    setRenamingFolder(folderPath);
    setRenameValue(folders[folderPath]?.name || '');
  }, [setRenamingFolder, setRenameValue, folders]);

  const addStep = useCallback((trackId: string) => {
    const track = tracks[trackId];
    if (!track || !track.isMultitrack) return;

    const stepNumber = (track.steps?.length || 0) + 1;
    const newStep: TrackStep = {
      id: `${trackId}-step-${stepNumber}`,
      name: newStepName.trim() || `Step ${stepNumber}`,
      code: '// New step\n',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };

    setTracks(prev => ({
      ...prev,
      [trackId]: {
        ...prev[trackId],
        steps: [...(prev[trackId].steps || []), newStep],
        modified: new Date().toISOString(),
      }
    }));

    setNewStepName('');
    setIsCreatingStep(false);
    setSelectedStepTrack(null);
    toastActions.success(t('files:stepAdded'));
  }, [tracks, newStepName, setTracks, setNewStepName, setIsCreatingStep, setSelectedStepTrack, t]);

  const cancelRename = useCallback(() => {
    setRenamingTrack(null);
    setRenamingFolder(null);
    setRenamingStep(null);
    setRenameValue('');
  }, [setRenamingTrack, setRenamingFolder, setRenamingStep, setRenameValue]);

  const finishRename = useCallback(() => {
    if (renamingTrack && renameValue.trim()) {
      const track = tracks[renamingTrack];
      const oldName = track?.name;
      const newName = renameValue.trim();

      if (track && oldName && oldName !== newName) {
        setTracks(prev => ({
          ...prev,
          [renamingTrack]: {
            ...prev[renamingTrack],
            name: newName,
            modified: new Date().toISOString()
          }
        }));

        toastActions.success(t('files:trackRenamed'));
      }
    }
    setRenamingTrack(null);
    setRenameValue('');
  }, [renamingTrack, renameValue, tracks, setTracks, setRenamingTrack, setRenameValue, t]);

  const finishRenameFolder = useCallback(() => {
    if (renamingFolder && renameValue.trim()) {
      const folder = folders[renamingFolder];
      if (folder && renameValue.trim() !== folder.name) {
        const newPath = folder.parent ? `${folder.parent}/${renameValue.trim()}` : renameValue.trim();

        const updatedFolder = { ...folder, name: renameValue.trim(), path: newPath };
        setFolders(prev => {
          const newFolders = { ...prev };
          delete newFolders[renamingFolder];
          newFolders[newPath] = updatedFolder;
          return newFolders;
        });

        toastActions.success(t('files:folderRenamed'));
      }
    }
    setRenamingFolder(null);
    setRenameValue('');
  }, [renamingFolder, renameValue, folders, setFolders, setRenamingFolder, setRenameValue, t]);

  const handleMoveItem = useCallback(async (itemId: string, itemType: 'track' | 'folder', targetId: string) => {
    console.log('handleMoveItem called:', { 
      itemId, 
      itemType, 
      targetId, 
      availableFolders: Object.keys(folders),
      foldersData: Object.entries(folders).map(([key, folder]) => ({ 
        key, 
        id: folder.id, 
        name: folder.name, 
        path: typeof folder.path === 'string' ? folder.path : '[CORRUPTED]'
      }))
    });
    
    if (itemType === 'track') {
      // Store original folder for potential revert
      const originalTrack = tracks[itemId];
      const originalFolder = originalTrack?.folder;
      
      // Convert targetId to folder path for local state (UI expects paths)
      let targetPath: string | undefined;
      if (targetId) {
        // Find the target folder by UUID and get its path
        const targetFolder = folders[targetId] || Object.values(folders).find(f => f.id === targetId);
        if (targetFolder) {
          targetPath = targetFolder.path;
          console.log(`handleMoveItem - Found target folder UUID "${targetId}" with path: ${targetPath}`);
        } else {
          console.warn(`handleMoveItem - Target folder not found for UUID: ${targetId}`);
          // If we can't find the folder by UUID, assume targetId is already a path
          targetPath = targetId;
        }
      }
      
      // Update local state immediately for responsive UI
      setTracks(prev => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          folder: targetPath || undefined,
          modified: new Date().toISOString(),
        }
      }));
      
      // Update the database using the corrected legacy update endpoint
      try {
        console.log(`handleMoveItem - Updating database: trackId=${itemId}, folder=${targetId || null}`);

        const updateResponse = await fetch('/api/tracks/update', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            trackId: itemId,
            updates: {
              folder: targetId || null, // Use UUID directly for database storage
              modified: new Date().toISOString()
            }
          }),
        });

        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText };
          }
          console.error('handleMoveItem - Failed to update track in database:', {
            status: updateResponse.status,
            statusText: updateResponse.statusText,
            error: errorData
          });
          
          // Revert local state on database error
          setTracks(prev => ({
            ...prev,
            [itemId]: {
              ...prev[itemId],
              folder: originalFolder, // Revert to original folder
            }
          }));
          
          toastActions.error('Failed to move track. Please try again.');
          return;
        }

        const result = await updateResponse.json();
        console.log('handleMoveItem - Track updated successfully in database:', result);
        toastActions.success(t('files:trackMoved'));
      } catch (error) {
        console.error('handleMoveItem - Error updating track in database:', error);
        
        // Revert local state on error
        setTracks(prev => ({
          ...prev,
          [itemId]: {
            ...prev[itemId],
            folder: originalFolder, // Revert to original folder
          }
        }));
        
        toastActions.error('Failed to move track. Please try again.');
        return;
      }
    } else if (itemType === 'folder') {
      // Handle folder moving
      const originalFolder = folders[itemId];
      if (!originalFolder) {
        console.error('handleMoveItem - Source folder not found:', itemId);
        toastActions.error('Source folder not found');
        return;
      }

      // Prevent moving folder into itself or its descendants
      if (targetId === itemId) {
        console.error('handleMoveItem - Cannot move folder into itself');
        toastActions.error('Cannot move folder into itself');
        return;
      }

      // Check for circular dependency
      let currentParent = targetId;
      while (currentParent) {
        if (currentParent === itemId) {
          console.error('handleMoveItem - Circular dependency detected');
          toastActions.error('Cannot move folder into its own subfolder');
          return;
        }
        const parentFolder = folders[currentParent] || Object.values(folders).find(f => f.id === currentParent);
        currentParent = parentFolder?.parent;
      }

      // Update local state immediately for responsive UI
      const originalParent = originalFolder.parent;
      setFolders(prev => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          parent: targetId || null,
        }
      }));

      // Update the database
      try {
        console.log(`handleMoveItem - Updating folder in database: folderId=${itemId}, parent=${targetId || null}`);

        const updateResponse = await fetch('/api/folders/update', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            folderId: itemId,
            updates: {
              parent: targetId || null,
            }
          }),
        });

        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText };
          }
          console.error('handleMoveItem - Failed to update folder in database:', {
            status: updateResponse.status,
            statusText: updateResponse.statusText,
            error: errorData
          });
          
          // Revert local state on database error
          setFolders(prev => ({
            ...prev,
            [itemId]: {
              ...prev[itemId],
              parent: originalParent,
            }
          }));
          
          toastActions.error('Failed to move folder. Please try again.');
          return;
        }

        const result = await updateResponse.json();
        console.log('handleMoveItem - Folder updated successfully in database:', result);
        toastActions.success('Folder moved successfully');
      } catch (error) {
        console.error('handleMoveItem - Error updating folder in database:', error);
        
        // Revert local state on error
        setFolders(prev => ({
          ...prev,
          [itemId]: {
            ...prev[itemId],
            parent: originalParent,
          }
        }));
        
        toastActions.error('Failed to move folder. Please try again.');
        return;
      }
    }
    // Implementation complete - removed TODO comment
  }, [setTracks, setFolders, folders, tracks, t, toastActions]);

  const convertToMultitrack = useCallback((track: Track) => {
    const updatedTrack: Track = {
      ...track,
      isMultitrack: true,
      steps: [
        {
          id: `${track.id}-step-1`,
          name: 'Step 1',
          code: track.code,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        }
      ],
      activeStep: 0,
      modified: new Date().toISOString(),
    };

    setTracks(prev => ({ ...prev, [track.id]: updatedTrack }));
    toastActions.success(t('files:convertedToMultitrack'));
  }, [setTracks, t]);

  const switchToStep = useCallback(async (trackId: string, stepIndex: number) => {
    const track = tracks[trackId];
    if (!track || !track.isMultitrack || !track.steps) return;

    console.log('FileManager - switchToStep called for track:', track.name, 'step:', stepIndex);

    // Set step selection state when switching to a step
    setSelectedStepTrack(trackId);

    // Save current code to active step if this track is currently selected
    if (selectedTrack === trackId && track.activeStep !== undefined) {
      const currentCode = context.editorRef?.current?.code || context.activeCode || '';
      const updatedSteps = [...track.steps];
      updatedSteps[track.activeStep] = {
        ...updatedSteps[track.activeStep],
        code: currentCode,
        modified: new Date().toISOString(),
      };

      setTracks(prev => ({
        ...prev,
        [trackId]: {
          ...prev[trackId],
          steps: updatedSteps,
          activeStep: stepIndex,
          code: updatedSteps[stepIndex].code,
          modified: new Date().toISOString(),
        }
      }));
    } else {
      setTracks(prev => ({
        ...prev,
        [trackId]: {
          ...prev[trackId],
          activeStep: stepIndex,
          code: track.steps![stepIndex].code,
          modified: new Date().toISOString(),
        }
      }));
    }

    // Load the new step immediately
    const updatedTrack = {
      ...track,
      activeStep: stepIndex,
      code: track.steps[stepIndex].code,
    };
    
    console.log('FileManager - loading step code:', track.steps[stepIndex].code.substring(0, 50) + '...');
    loadTrack(updatedTrack);
    
    // Update URL with step information if TrackRouter is available
    if (context.trackRouter && selectedTrack === trackId) {
      try {
        console.log('FileManager - updating URL for step:', stepIndex);
        await context.trackRouter.navigateToTrack(trackId, { step: stepIndex, replace: true, skipUrlUpdate: false });
      } catch (error) {
        console.error('FileManager - Failed to update URL for step:', error);
      }
    }
  }, [tracks, selectedTrack, context, setTracks, loadTrack, setSelectedStepTrack]);

  const startRenameStep = useCallback((trackId: string, stepIndex: number) => {
    const track = tracks[trackId];
    if (!track || !track.isMultitrack || !track.steps) return;

    setRenamingStep({ trackId, stepIndex });
    setRenameValue(track.steps[stepIndex].name);
  }, [tracks, setRenamingStep, setRenameValue]);

  const finishRenameStep = useCallback(() => {
    if (renamingStep && renameValue.trim()) {
      const { trackId, stepIndex } = renamingStep;
      const track = tracks[trackId];
      const step = track?.steps?.[stepIndex];
      const newName = renameValue.trim();

      if (step && step.name !== newName) {
        const updatedSteps = [...track.steps!];
        updatedSteps[stepIndex] = {
          ...updatedSteps[stepIndex],
          name: newName,
          modified: new Date().toISOString(),
        };

        setTracks(prev => ({
          ...prev,
          [trackId]: {
            ...prev[trackId],
            steps: updatedSteps,
            modified: new Date().toISOString(),
          }
        }));

        toastActions.success(t('files:stepRenamed'));
      }
    }
    setRenamingStep(null);
    setRenameValue('');
  }, [renamingStep, renameValue, tracks, setTracks, setRenamingStep, setRenameValue, t]);

  const deleteStep = useCallback((trackId: string, stepIndex: number) => {
    const track = tracks[trackId];
    if (!track || !track.isMultitrack || !track.steps || track.steps.length <= 1) {
      toastActions.error(t('files:cannotDeleteLastStep'));
      return;
    }

    const updatedSteps = track.steps.filter((_, index) => index !== stepIndex);
    const newActiveStep = track.activeStep === stepIndex ? 0 :
                         track.activeStep! > stepIndex ? track.activeStep! - 1 : track.activeStep;

    setTracks(prev => ({
      ...prev,
      [trackId]: {
        ...prev[trackId],
        steps: updatedSteps,
        activeStep: newActiveStep,
        code: updatedSteps[newActiveStep!].code,
        modified: new Date().toISOString(),
      }
    }));

    toastActions.success(t('files:stepDeleted'));
  }, [tracks, setTracks, t]);

  const downloadTrack = useCallback(async (track: Track) => {
    if (track.isMultitrack && track.steps) {
      // Download as ZIP for multitrack
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Add each step as a separate file
      track.steps.forEach((step) => {
        const fileName = `${step.name.replace(/[^a-zA-Z0-9]/g, '_')}.js`;
        zip.file(fileName, step.code);
      });

      // Add metadata file
      const metadata = {
        trackName: track.name,
        isMultitrack: true,
        steps: track.steps.map(step => ({
          name: step.name,
          created: step.created,
          modified: step.modified,
        })),
        created: track.created,
        modified: track.modified,
      };
      zip.file('metadata.json', JSON.stringify(metadata, null, 2));

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${track.name}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toastActions.success(t('files:multitrackDownloaded'));
    } else {
      // Regular single file download
      const blob = new Blob([track.code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${track.name}.js`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toastActions.success(t('files:trackDownloaded'));
    }
  }, [t]);

  const downloadFolder = useCallback(async (folderPath: string) => {
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Get all tracks in this folder and its subfolders, or all tracks if folderPath is empty
      const folderTracks = folderPath === '' 
        ? Object.values(tracks) // Export all tracks
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
          ? (track.folder || '') // Keep full folder structure for export all
          : (track.folder ? track.folder.replace(folderPath, '').replace(/^\//, '') : '');
        const trackPath = relativePath ? `${relativePath}/` : '';

        if (track.isMultitrack && track.steps) {
          // Create multitrack folder
          const multitrackFolder = zip.folder(`${trackPath}${track.name}`);

          // Add each step
          track.steps.forEach((step) => {
            const fileName = `${step.name.replace(/[^a-zA-Z0-9]/g, '_')}.js`;
            multitrackFolder?.file(fileName, step.code);
          });

          // Add multitrack metadata
          const metadata = {
            name: track.name,
            isMultitrack: true,
            activeStep: track.activeStep || 0,
            created: track.created,
            modified: track.modified,
            steps: track.steps.map(step => ({
              id: step.id,
              name: step.name,
              created: step.created,
              modified: step.modified
            }))
          };
          multitrackFolder?.file('metadata.json', JSON.stringify(metadata, null, 2));
        } else {
          // Regular track
          const fileName = `${trackPath}${track.name.replace(/[^a-zA-Z0-9]/g, '_')}.js`;
          zip.file(fileName, track.code);
        }
      });

      // Generate and download ZIP
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      const folderName = folderPath === '' ? 'strudel-library' : (folderPath.split('/').pop() || 'folder');
      a.download = `${folderName}-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toastActions.success(folderPath === '' ? t('files:libraryExported') : t('files:folderDownloaded'));
    } catch (error) {
      console.error('Folder download failed:', error);
      toastActions.error('Folder download failed');
    }
  }, [tracks, t]);

  const deleteFolder = useCallback((folderPath: string) => {
    console.log('FileManager - deleteFolder called for:', folderPath);
    
    // Get folder contents
    const subfolders = Object.values(folders).filter(f => 
      f.parent === folderPath || f.path.startsWith(folderPath + '/')
    ).map(f => f.name);
    
    const folderTracks = Object.values(tracks).filter(t => 
      t.folder === folderPath || (t.folder && t.folder.startsWith(folderPath + '/'))
    ).map(t => t.name);

    if (subfolders.length > 0 || folderTracks.length > 0) {
      setFolderToDelete(folderPath);
      setFolderContents({ subfolders, tracks: folderTracks });
      setShowDeleteFolderModal(true);
      return;
    }

    // Empty folder - delete immediately
    performFolderDeletion(folderPath);
  }, [folders, tracks, setFolderToDelete, setFolderContents, setShowDeleteFolderModal]);

  const performFolderDeletion = useCallback((folderPath: string) => {
    // Prevent multiple deletions of the same folder
    if (isDeletingFolderRef.current.has(folderPath)) {
      console.log('FileManager - folder deletion already in progress for:', folderPath);
      return;
    }
    
    isDeletingFolderRef.current.add(folderPath);
    
    console.log('FileManager - STARTING folder deletion for path:', folderPath);
    
    // Get all items that will be deleted
    const foldersToDelete = Object.entries(folders).filter(([key, folder]) => {
      return key === folderPath || 
             folder.path === folderPath || 
             folder.path.startsWith(folderPath + '/') ||
             key.startsWith(folderPath + '/');
    }).map(([key]) => key);
    
    const tracksToDelete = Object.values(tracks).filter(track => 
      track.folder === folderPath || (track.folder && track.folder.startsWith(folderPath + '/'))
    );

    // Check if the currently selected track will be deleted
    const selectedTrackWillBeDeleted = selectedTrack && tracksToDelete.some(track => track.id === selectedTrack);
    
    if (selectedTrackWillBeDeleted) {
      console.log('FileManager - selected track will be deleted, switching to another track');
      
      const remainingTracks = Object.values(tracks).filter(track => 
        !tracksToDelete.some(deletedTrack => deletedTrack.id === track.id)
      );
      
      if (remainingTracks.length > 0) {
        const nextTrack = remainingTracks[0];
        console.log('FileManager - switching to safe track before folder deletion:', nextTrack.name);
        loadTrack(nextTrack);
      } else {
        console.log('FileManager - no tracks left after folder deletion, clearing selection');
        setSelectedTrack(null);
        
        if (context.editorRef?.current?.setCode) {
          context.editorRef.current.setCode('');
        }
        
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('strudel-all-tracks-deleted'));
        }, 100);
      }
    }

    // Update folders state
    setFolders(prev => {
      const newFolders = { ...prev };
      foldersToDelete.forEach(key => {
        delete newFolders[key];
      });
      return newFolders;
    });

    // Update tracks state
    if (tracksToDelete.length > 0) {
      setTracks(prev => {
        const newTracks = { ...prev };
        tracksToDelete.forEach(track => {
          delete newTracks[track.id];
        });
        return newTracks;
      });
    }

    toastActions.success(t('files:folderDeleted'));
    
    // Clean up the deletion tracking after a short delay
    setTimeout(() => {
      isDeletingFolderRef.current.delete(folderPath);
    }, 1000);
  }, [folders, tracks, selectedTrack, isDeletingFolderRef, setFolders, setTracks, setSelectedTrack, loadTrack, context, t]);

  const confirmFolderDelete = useCallback(() => {
    if (folderToDelete) {
      performFolderDeletion(folderToDelete);
      setShowDeleteFolderModal(false);
      setFolderToDelete(null);
      setFolderContents({subfolders: [], tracks: []});
    }
  }, [folderToDelete, performFolderDeletion, setShowDeleteFolderModal, setFolderToDelete, setFolderContents]);

  const deleteAllTracks = useCallback(() => {
    const trackIds = Object.keys(tracks);
    const folderIds = Object.keys(folders);
    
    if (trackIds.length === 0 && folderIds.length === 0) return;

    // Clear all tracks from localStorage
    if (trackIds.length > 0) {
      localStorage.removeItem('strudel_tracks');
      setTracks({});
    }
    
    // Clear all folders from localStorage
    if (folderIds.length > 0) {
      localStorage.removeItem('strudel_folders');
      setFolders({});
    }
    
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
    
    // Dispatch event for other components
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('strudel-all-tracks-deleted'));
    }, 100);
  }, [tracks, folders, setTracks, setFolders, setSelectedTrack, context, t]);

  return {
    createNewTrack,
    createNewFolder,
    handleTrackSelect,
    duplicateTrack,
    handleDeleteTrack: deleteTrack, // Alias for compatibility
    deleteTrack,
    confirmDelete,
    cancelCreate,
    cancelCreateStep,
    handleTrackCreate,
    handleFolderCreate,
    handleTrackRename,
    handleFolderRename,
    addStep,
    cancelRename,
    finishRename,
    finishRenameFolder,
    handleMoveItem,
    convertToMultitrack,
    switchToStep,
    startRenameStep,
    finishRenameStep,
    deleteStep,
    downloadTrack,
    downloadFolder,
    deleteFolder,
    performFolderDeletion,
    confirmFolderDelete,
    deleteAllTracks,
  };
}