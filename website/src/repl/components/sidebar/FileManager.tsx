import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderIcon,
  PlusIcon,
  ArrowDownTrayIcon,
  DocumentIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from '@src/i18n';
import { formatDateTimeIntl } from '@src/i18n/dateFormat';
import { FileTree } from './FileTree';
import { InfoModal } from '../ui/InfoModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { toastActions } from '@src/stores/toastStore';
import { BurgerMenuButton } from '../ui/BurgerMenuButton';
import { useSettings } from '@src/settings';
import { formatCode } from '@strudel/codemirror';
import { useActivePattern, setActivePattern } from '@src/user_pattern_utils';
import { DEFAULT_TRACK_CODE } from '@src/constants/defaultCode';

const TRACKS_STORAGE_KEY = 'strudel_tracks';
const FOLDERS_STORAGE_KEY = 'strudel_folders';

interface Track {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
  folder?: string; // Path to folder (e.g., "folder1/subfolder")
  isMultitrack?: boolean;
  steps?: TrackStep[];
  activeStep?: number;
}

interface TrackStep {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
}

interface Folder {
  id: string;
  name: string;
  path: string; // Full path (e.g., "folder1/subfolder")
  parent?: string; // Parent folder path
  created: string;
}

interface ReplContext {
  activeCode?: string;
  editorRef?: React.RefObject<{ code: string; setCode?: (code: string) => void }>;
  handleUpdate: (update: { id?: string; code: string; [key: string]: any }, replace?: boolean) => void;
}

interface FileManagerProps {
  context: ReplContext;
}

export function FileManager({ context }: FileManagerProps) {
  const [tracks, setTracks] = useState<Record<string, Track>>({});
  const [folders, setFolders] = useState<Record<string, Folder>>({});
  const [isInitialized, setIsInitialized] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null); // Track opened for editing
  const [hoveredTrack, setHoveredTrack] = useState<string | null>(null); // Track being hovered
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newTrackName, setNewTrackName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [newItemParentPath, setNewItemParentPath] = useState<string>(''); // For creating items in specific folders
  const [saveStatus, setSaveStatus] = useState('');
  const [renamingTrack, setRenamingTrack] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renamingStep, setRenamingStep] = useState<{ trackId: string; stepIndex: number } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoModalData, setInfoModalData] = useState<{ title: string; items: Array<{ label: string; value: string }> }>({ title: '', items: [] });

  // Autosave functionality
  const { isAutosaveEnabled, autosaveInterval, isPrettierEnabled } = useSettings();
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autosaveTrackIdRef = useRef<string | null>(null); // Track which track the autosave is for
  const lastSavedCodeRef = useRef<string>('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [folderContents, setFolderContents] = useState<{subfolders: string[], tracks: string[]}>({subfolders: [], tracks: []});
  const [isDeletingTrack, setIsDeletingTrack] = useState(false); // Prevent multiple deletions
  const [isDragOver, setIsDragOver] = useState(false);
  const [isCreatingStep, setIsCreatingStep] = useState(false);
  const [newStepName, setNewStepName] = useState('');
  const [selectedStepTrack, setSelectedStepTrack] = useState<string | null>(null);
  const { t, i18n } = useTranslation(['files', 'common', 'tabs']);
  const activePattern = useActivePattern(); // This is what's currently PLAYING
  
  // Prevent multiple folder deletions
  const isDeletingFolderRef = useRef<Set<string>>(new Set());

  // Helper function for better date formatting
// Load tracks and folders from localStorage on mount
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;

    const loadData = () => {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;

      const savedTracks = localStorage.getItem(TRACKS_STORAGE_KEY);
      const savedFolders = localStorage.getItem(FOLDERS_STORAGE_KEY);

      if (savedTracks) {
        try {
          const loadedTracks: Record<string, Track> = JSON.parse(savedTracks);
          setTracks(loadedTracks);

          // After loading tracks, check if we need to sync with active pattern
          setTimeout(() => {
            const currentActivePattern = activePattern;
            if (currentActivePattern && loadedTracks[currentActivePattern]) {
              console.log('FileManager - post-load sync check for active pattern:', currentActivePattern);
              const matchingTrack = loadedTracks[currentActivePattern];
              if (matchingTrack && !selectedTrack) {
                console.log('FileManager - post-load selecting matching track:', matchingTrack.name);
                setSelectedTrack(matchingTrack.id);
              }
            }
          }, 100);
        } catch (e) {
          console.error('Failed to load tracks from localStorage:', e);
        }
      }

      if (savedFolders) {
        try {
          setFolders(JSON.parse(savedFolders));
        } catch (e) {
          console.error('Failed to load folders from localStorage:', e);
        }
      }
    };

    // Initial load
    loadData();

    // Listen for custom events when tracks are updated externally
    const handleTracksUpdated = () => {
      console.log('FileManager - received tracks updated event, reloading...');
      loadData();
    };

    const handleSelectTrack = (event: CustomEvent) => {
      const { trackId } = event.detail;
      console.log('FileManager - received select track event:', trackId);
      console.log('FileManager - tracks available:', Object.keys(tracks));
      console.log('FileManager - track exists:', !!tracks[trackId]);
      setSelectedTrack(trackId);
    };

    window.addEventListener('strudel-tracks-updated', handleTracksUpdated);
    window.addEventListener('strudel-select-track', handleSelectTrack);

    // Mark as initialized after loading
    setIsInitialized(true);

    return () => {
      window.removeEventListener('strudel-tracks-updated', handleTracksUpdated);
      window.removeEventListener('strudel-select-track', handleSelectTrack);
    };
  }, [activePattern, selectedTrack]);

  // Save tracks to localStorage whenever tracks change (but only after initial load)
  useEffect(() => {
    if (isInitialized && typeof localStorage !== 'undefined') {
      localStorage.setItem(TRACKS_STORAGE_KEY, JSON.stringify(tracks));
    }
  }, [tracks, isInitialized]);

  // Save folders to localStorage whenever folders change (but only after initial load)
  useEffect(() => {
    if (isInitialized && typeof localStorage !== 'undefined') {
      localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
    }
  }, [folders, isInitialized]);

  // Synchronize with active pattern from user_pattern_utils
  // NOTE: activePattern represents what's PLAYING, selectedTrack represents what's OPENED for editing
  useEffect(() => {
    if (!isInitialized) return;

    console.log('FileManager - synchronization check:', {
      activePattern,
      selectedTrack,
      tracksCount: Object.keys(tracks).length,
      activePatternExists: !!tracks[activePattern]
    });

    // Only proceed if we have tracks loaded and no track is currently selected
    if (Object.keys(tracks).length === 0 || selectedTrack) {
      return;
    }

    // Case 1: Active pattern exists directly in FileManager tracks
    if (activePattern && tracks[activePattern]) {
      console.log('FileManager - selecting active pattern directly:', tracks[activePattern].name);
      setSelectedTrack(activePattern);
      return;
    }

    // Case 2: Try to match by current editor code content
    const currentCode = context.editorRef?.current?.code || context.activeCode;
    if (currentCode && currentCode.trim()) {
      const matchingTrack = Object.values(tracks).find(track => 
        track.code && track.code.trim() === currentCode.trim()
      );
      
      if (matchingTrack) {
        console.log('FileManager - found matching track by editor code:', matchingTrack.name);
        setSelectedTrack(matchingTrack.id);
        // Update active pattern to use the FileManager track ID
        if (activePattern !== matchingTrack.id) {
          setActivePattern(matchingTrack.id);
        }
        return;
      }
    }

    // Case 3: Try to match using old user pattern system
    if (activePattern && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        const userPatternsData = localStorage.getItem('strudel-settingsuserPatterns');
        if (userPatternsData) {
          const userPatterns = JSON.parse(userPatternsData);
          const userPattern = userPatterns[activePattern];
          
          if (userPattern && userPattern.code) {
            const matchingTrack = Object.values(tracks).find(track => 
              track.code && track.code.trim() === userPattern.code.trim()
            );
            
            if (matchingTrack) {
              console.log('FileManager - found matching track by user pattern code:', matchingTrack.name);
              setSelectedTrack(matchingTrack.id);
              // Update active pattern to use the FileManager track ID
              setActivePattern(matchingTrack.id);
              return;
            }
          }
        }
      } catch (e) {
        console.warn('FileManager - failed to check user patterns:', e);
      }
    }

    console.log('FileManager - no matching track found for synchronization');
    
  }, [activePattern, tracks, isInitialized, selectedTrack, context.editorRef, context.activeCode]);

  const createNewTrack = (parentPath?: string) => {
    if (!newTrackName.trim()) return;

    const trackId = Date.now().toString();

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
  };

  const createNewFolder = (parentPath?: string) => {
    if (!newFolderName.trim()) return;

    const folderId = Date.now().toString();
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
  };

  const handleMoveItem = (itemId: string, itemType: 'track' | 'folder', targetPath: string) => {
    if (itemType === 'track') {
      setTracks(prev => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          folder: targetPath || undefined,
          modified: new Date().toISOString(),
        }
      }));
      toastActions.success(t('files:trackMoved'));
    } else {
      // Moving folders is more complex - need to update all children
      const folder = folders[itemId];
      if (!folder) return;

      const newPath = targetPath ? `${targetPath}/${folder.name}` : folder.name;

      // Update the folder itself
      setFolders(prev => {
        const newFolders = { ...prev };
        delete newFolders[itemId];
        newFolders[newPath] = { ...folder, path: newPath, parent: targetPath || undefined };
        return newFolders;
      });

      // Update all children
      updateChildrenPaths(itemId, newPath);
      toastActions.success(t('files:folderMoved'));
    }
  };

  const handleTrackSelect = (track: Track) => {
    console.log('FileManager - handleTrackSelect called for:', track.name);
    
    // Save current track before switching if autosave is enabled
    if (isAutosaveEnabled && selectedTrack && selectedTrack !== track.id) {
      saveCurrentTrack(false); // Save without showing toast
    }
    
    // Load the new track immediately
    loadTrack(track);
  };

  const handleTrackRename = (trackId: string) => {
    setRenamingTrack(trackId);
    setRenameValue(tracks[trackId]?.name || '');
  };

  const handleFolderRename = (folderPath: string) => {
    setRenamingFolder(folderPath);
    setRenameValue(folders[folderPath]?.name || '');
  };

  const handleTrackCreate = (parentPath?: string) => {
    setNewItemParentPath(parentPath || '');
    setIsCreating(true);
  };

  const handleFolderCreate = (parentPath?: string) => {
    setNewItemParentPath(parentPath || '');
    setIsCreatingFolder(true);
  };

  const handleTrackInfo = (track: Track) => {
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

  const startRenameFolder = (folderPath: string) => {
    setRenamingFolder(folderPath);
    setRenameValue(folders[folderPath]?.name || '');
  };

  const deleteFolder = (folderPath: string) => {
    console.log('FileManager - deleteFolder called for:', folderPath);
    console.log('FileManager - all folders:', folders);
    
    // Get folder contents - check for both direct children and nested subfolders
    // Handle both path-keyed and ID-keyed folders
    const subfolders = Object.values(folders).filter(f => 
      f.parent === folderPath || f.path.startsWith(folderPath + '/')
    ).map(f => f.name);
    
    // Get tracks in this folder and all subfolders
    const folderTracks = Object.values(tracks).filter(t => 
      t.folder === folderPath || (t.folder && t.folder.startsWith(folderPath + '/'))
    ).map(t => t.name);

    console.log('FileManager - found subfolders:', subfolders);
    console.log('FileManager - found tracks:', folderTracks);

    if (subfolders.length > 0 || folderTracks.length > 0) {
      // Show confirmation dialog with contents list
      setFolderToDelete(folderPath);
      setFolderContents({ subfolders, tracks: folderTracks });
      setShowDeleteFolderModal(true);
      return;
    }

    // Empty folder - delete immediately
    performFolderDeletion(folderPath);
  };

  const performFolderDeletion = (folderPath: string) => {
    // Prevent multiple deletions of the same folder
    if (isDeletingFolderRef.current.has(folderPath)) {
      console.log('FileManager - folder deletion already in progress for:', folderPath);
      return;
    }
    
    // Mark this folder as being deleted
    isDeletingFolderRef.current.add(folderPath);
    
    console.log('FileManager - STARTING folder deletion for path:', folderPath);
    console.log('FileManager - all folders before deletion:', folders);
    console.log('FileManager - folder keys before deletion:', Object.keys(folders));
    
    // Get all items that will be deleted - handle both path-keyed and ID-keyed folders
    const foldersToDelete = Object.entries(folders).filter(([key, folder]) => {
      // Check if this folder should be deleted:
      // 1. If key matches the folderPath (path-keyed folders)
      // 2. If folder.path matches the folderPath (ID-keyed folders)
      // 3. If it's a subfolder of the folder being deleted
      return key === folderPath || 
             folder.path === folderPath || 
             folder.path.startsWith(folderPath + '/') ||
             key.startsWith(folderPath + '/');
    }).map(([key, folder]) => key);
    
    console.log('FileManager - folders to delete:', foldersToDelete);
    
    const tracksToDelete = Object.values(tracks).filter(track => 
      track.folder === folderPath || (track.folder && track.folder.startsWith(folderPath + '/'))
    );

    console.log('FileManager - tracks to delete:', tracksToDelete.map(t => t.name));

    // Check if the currently selected track will be deleted
    const selectedTrackWillBeDeleted = selectedTrack && tracksToDelete.some(track => track.id === selectedTrack);
    
    if (selectedTrackWillBeDeleted) {
      console.log('FileManager - selected track will be deleted, switching to another track');
      
      // Find a track that won't be deleted
      const remainingTracks = Object.values(tracks).filter(track => 
        !tracksToDelete.some(deletedTrack => deletedTrack.id === track.id)
      );
      
      if (remainingTracks.length > 0) {
        // Switch to the first remaining track
        const nextTrack = remainingTracks[0];
        console.log('FileManager - switching to safe track before folder deletion:', nextTrack.name);
        loadTrack(nextTrack);
      } else {
        // No tracks left - clear selection and show welcome screen
        console.log('FileManager - no tracks left after folder deletion, clearing selection');
        setSelectedTrack(null);
        
        // Clear the editor
        if (context.editorRef?.current?.setCode) {
          context.editorRef.current.setCode('');
        }
        
        // Trigger welcome screen
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('strudel-all-tracks-deleted'));
        }, 100);
      }
    }

    // Update folders state - ensure we're deleting the right folders
    setFolders(prev => {
      const newFolders = { ...prev };
      console.log('FileManager - folders before deletion operation:', Object.keys(newFolders));
      
      foldersToDelete.forEach(key => {
        console.log('FileManager - deleting folder key:', key, 'exists:', !!newFolders[key]);
        if (newFolders[key]) {
          const wasDeleted = delete newFolders[key];
          console.log('FileManager - folder deletion result:', wasDeleted);
        } else {
          console.warn('FileManager - folder not found for deletion:', key);
        }
      });
      
      console.log('FileManager - folders after deletion operation:', Object.keys(newFolders));
      return newFolders;
    });

    // Update tracks state
    if (tracksToDelete.length > 0) {
      setTracks(prev => {
        const newTracks = { ...prev };
        tracksToDelete.forEach(track => {
          console.log('FileManager - deleting track:', track.name, 'ID:', track.id);
          delete newTracks[track.id];
        });
        console.log('FileManager - tracks remaining after deletion:', Object.keys(newTracks).length);
        return newTracks;
      });
    }

    // Use a unique ID to prevent duplicate toasts for this specific folder deletion
    const toastId = `folder-deleted-${folderPath}-${Date.now()}`;
    toastActions.success(t('files:folderDeleted'), undefined, undefined, toastId);
    console.log('FileManager - toastActions.success called for folder deletion:', toastId);
    
    // Clean up the deletion tracking after a short delay
    setTimeout(() => {
      isDeletingFolderRef.current.delete(folderPath);
      console.log('FileManager - cleaned up deletion tracking for:', folderPath);
    }, 1000);
  };

  const confirmFolderDelete = () => {
    if (folderToDelete) {
      performFolderDeletion(folderToDelete);
      setShowDeleteFolderModal(false);
      setFolderToDelete(null);
      setFolderContents({subfolders: [], tracks: []});
    }
  };

  const finishRenameFolder = () => {
    if (renamingFolder && renameValue.trim()) {
      const folder = folders[renamingFolder];
      if (folder && renameValue.trim() !== folder.name) {
        const newPath = folder.parent ? `${folder.parent}/${renameValue.trim()}` : renameValue.trim();

        // Update folder
        const updatedFolder = { ...folder, name: renameValue.trim(), path: newPath };
        setFolders(prev => {
          const newFolders = { ...prev };
          delete newFolders[renamingFolder];
          newFolders[newPath] = updatedFolder;
          return newFolders;
        });

        // Update all child folders and tracks
        updateChildrenPaths(renamingFolder, newPath);

        toastActions.success(t('files:folderRenamed'));
      }
    }
    setRenamingFolder(null);
    setRenameValue('');
  };

  const updateChildrenPaths = (oldParentPath: string, newParentPath: string) => {
    // Update child folders
    setFolders(prev => {
      const newFolders = { ...prev };
      Object.values(prev).forEach(folder => {
        if (folder.path.startsWith(oldParentPath + '/')) {
          const relativePath = folder.path.substring(oldParentPath.length + 1);
          const newPath = `${newParentPath}/${relativePath}`;
          delete newFolders[folder.path];
          newFolders[newPath] = { ...folder, path: newPath, parent: newParentPath };
        }
      });
      return newFolders;
    });

    // Update tracks in affected folders
    setTracks(prev => {
      const newTracks = { ...prev };
      Object.values(prev).forEach(track => {
        if (track.folder && track.folder.startsWith(oldParentPath)) {
          const relativePath = track.folder.substring(oldParentPath.length + 1);
          const newFolderPath = relativePath ? `${newParentPath}/${relativePath}` : newParentPath;
          newTracks[track.id] = { ...track, folder: newFolderPath };
        }
      });
      return newTracks;
    });
  };

  const loadTrack = (track: Track) => {
    console.log('FileManager - loadTrack called for:', track.name, track.id);
    setSelectedTrack(track.id);

    // Only update CodeMirror editor content and UI state - NO PLAYBACK
    const applyTrackCode = () => {
      console.log('FileManager - applying track code to editor (no playback):', track.code.substring(0, 50) + '...');
      
      // ONLY update the editor content, do NOT trigger evaluation/playback
      // Use reset=false to prevent handleEvaluate() from being called
      context.handleUpdate({ id: track.id, code: track.code }, false);
      
      // Also directly set the code in the editor if available (this won't trigger playback)
      if (context.editorRef?.current?.setCode) {
        console.log('FileManager - directly setting code in editor (no evaluation)');
        context.editorRef.current.setCode(track.code);
      }
    };

    // Apply immediately if editor is ready
    if (context.editorRef?.current) {
      applyTrackCode();
    } else {
      // Retry with increasing delays if editor isn't ready
      let retryCount = 0;
      const maxRetries = 10;
      
      const tryApplyTrackCode = () => {
        if (context.editorRef?.current || retryCount >= maxRetries) {
          applyTrackCode();
        } else {
          retryCount++;
          const delay = Math.min(100 * retryCount, 1000); // Exponential backoff up to 1s
          console.log(`FileManager - editor not ready, retrying in ${delay}ms (attempt ${retryCount})`);
          setTimeout(tryApplyTrackCode, delay);
        }
      };
      
      tryApplyTrackCode();
    }
  };

  const saveCurrentTrack = useCallback(async (showToast: boolean = true) => {
    if (!selectedTrack) return false;
    return await saveSpecificTrack(selectedTrack, showToast);
  }, [selectedTrack]);

  const saveSpecificTrack = useCallback(async (trackId: string, showToast: boolean = true) => {
    if (!trackId || !tracks[trackId]) {
      console.warn('FileManager - saveSpecificTrack: invalid track ID:', trackId);
      return false;
    }

    // Get current code from the editor
    let currentCode = context.editorRef?.current?.code || context.activeCode || '';
    if (!currentCode.trim()) {
      if (showToast) toastActions.warning(t('files:noCodeToSave'));
      return false;
    }

    // CRITICAL: Only save if this track is currently being edited
    // This prevents saving old code to a different track
    if (selectedTrack !== trackId) {
      console.log('FileManager - saveSpecificTrack: track changed, skipping autosave for:', tracks[trackId]?.name);
      return false;
    }

    // Format code with Prettier if enabled
    if (isPrettierEnabled) {
      try {
        const formattedCode = await formatCode(currentCode);
        if (formattedCode !== currentCode) {
          currentCode = formattedCode;
          // Update the editor with formatted code
          if (context.editorRef?.current?.setCode) {
            context.editorRef.current.setCode(formattedCode);
          }
        }
      } catch (error) {
        console.warn('[FileManager] Prettier formatting failed:', error);
        // Continue with unformatted code if formatting fails
      }
    }

    // Don't save if code hasn't changed
    if (currentCode === lastSavedCodeRef.current) {
      return false;
    }

    console.log('FileManager - saving to track:', tracks[trackId]?.name, 'ID:', trackId);

    setTracks(prev => ({
      ...prev,
      [trackId]: {
        ...prev[trackId],
        code: currentCode,
        modified: new Date().toISOString()
      }
    }));

    lastSavedCodeRef.current = currentCode;

    if (showToast) {
      toastActions.success(t('files:trackSaved'));
      setSaveStatus('Saved!');
      setTimeout(() => setSaveStatus(''), 2000);
    }

    return true;
  }, [tracks, context, t, isPrettierEnabled, selectedTrack]);

  // Autosave effect
  useEffect(() => {
    if (!isAutosaveEnabled || !selectedTrack) {
      if (autosaveTimerRef.current) {
        clearInterval(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
        autosaveTrackIdRef.current = null;
      }
      return;
    }

    // Clear existing timer if it's for a different track
    if (autosaveTimerRef.current && autosaveTrackIdRef.current !== selectedTrack) {
      clearInterval(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    // Set up autosave timer for the current track
    if (!autosaveTimerRef.current) {
      const trackIdForAutosave = selectedTrack; // Capture the track ID at timer creation
      autosaveTrackIdRef.current = trackIdForAutosave;
      
      console.log('FileManager - setting up autosave for track:', tracks[trackIdForAutosave]?.name);
      
      autosaveTimerRef.current = setInterval(async () => {
        // CRITICAL: Save to the specific track that was selected when timer started
        const saved = await saveSpecificTrack(trackIdForAutosave, false);
        if (saved) {
          setSaveStatus('Auto-saved');
          setTimeout(() => setSaveStatus(''), 1500);
        }
      }, autosaveInterval);
    }

    return () => {
      if (autosaveTimerRef.current) {
        clearInterval(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
        autosaveTrackIdRef.current = null;
      }
    };
  }, [isAutosaveEnabled, autosaveInterval, selectedTrack]);

  // Update last saved code when track changes
  useEffect(() => {
    if (selectedTrack && tracks[selectedTrack]) {
      lastSavedCodeRef.current = tracks[selectedTrack].code;
    }
  }, [selectedTrack, tracks]);

  // Listen for save events from keyboard shortcuts
  useEffect(() => {
    const handleSaveEvent = async (event: CustomEvent) => {
      console.log('FileManager - received save event from keyboard shortcut');
      await saveCurrentTrack(true);
    };

    document.addEventListener('strudel-save', handleSaveEvent);

    return () => {
      document.removeEventListener('strudel-save', handleSaveEvent);
    };
  }, [saveCurrentTrack]);

  const deleteTrack = (trackId: string) => {
    setTrackToDelete(trackId);
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    if (!trackToDelete || isDeletingTrack) {
      console.log('FileManager - confirmDelete called but already deleting or no track to delete');
      return;
    }

    setIsDeletingTrack(true); // Prevent multiple deletions
    
    const trackName = tracks[trackToDelete]?.name;
    const isSelectedTrack = selectedTrack === trackToDelete;
    
    console.log('FileManager - STARTING deletion process for track:', trackName, 'ID:', trackToDelete);
    console.log('FileManager - isSelected:', isSelectedTrack);
    console.log('FileManager - tracks before deletion:', Object.keys(tracks));
    
    // Function to actually delete the track
    const performDeletion = () => {
      console.log('FileManager - PERFORMING actual deletion of track:', trackToDelete);
      
      setTracks(prev => {
        const newTracks = { ...prev };
        const wasDeleted = delete newTracks[trackToDelete];
        console.log('FileManager - deletion successful:', wasDeleted);
        console.log('FileManager - remaining tracks after deletion:', Object.keys(newTracks));
        return newTracks;
      });
      
      setTrackToDelete(null);
      setIsDeletingTrack(false); // Reset deletion flag
      toastActions.success(t('files:trackDeleted'));
    };
    
    // If we're deleting the currently selected track, switch to another track first
    if (isSelectedTrack) {
      const remainingTrackIds = Object.keys(tracks).filter(id => id !== trackToDelete);
      
      if (remainingTrackIds.length > 0) {
        // Switch to the first available track
        const nextTrackId = remainingTrackIds[0];
        const nextTrack = tracks[nextTrackId];
        console.log('FileManager - switching to next track before deletion:', nextTrack.name, 'ID:', nextTrackId);
        
        // Load the next track and then delete after a short delay
        loadTrack(nextTrack);
        
        // Delay the deletion to ensure track switching completes
        setTimeout(() => {
          performDeletion();
        }, 100);
      } else {
        // No tracks left - clear selection and show welcome screen
        console.log('FileManager - no tracks left, clearing selection');
        setSelectedTrack(null);
        
        // Clear the editor
        if (context.editorRef?.current?.setCode) {
          context.editorRef.current.setCode('');
        }
        
        // Delete the track and then trigger welcome screen
        performDeletion();
        
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('strudel-all-tracks-deleted'));
        }, 100);
      }
    } else {
      // Not the selected track - delete immediately
      console.log('FileManager - deleting non-selected track immediately');
      performDeletion();
    }
  };

  const duplicateTrack = (track: Track) => {
    const trackId = Date.now().toString();
    const duplicatedTrack: Track = {
      ...track,
      id: trackId,
      name: `${track.name} (copy)`,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      folder: track.folder, // Preserve the folder
      steps: track.steps ? track.steps.map(step => ({
        ...step,
        id: `${trackId}-${step.id}`,
      })) : undefined,
    };

    setTracks(prev => ({ ...prev, [trackId]: duplicatedTrack }));
    toastActions.success(t('files:trackDuplicated'));
  };

  const convertToMultitrack = (track: Track) => {
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
  };

  const addStep = (trackId: string) => {
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
  };

  const switchToStep = (trackId: string, stepIndex: number) => {
    const track = tracks[trackId];
    if (!track || !track.isMultitrack || !track.steps) return;

    console.log('FileManager - switchToStep called for track:', track.name, 'step:', stepIndex);

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
  };

  const startRenameStep = (trackId: string, stepIndex: number) => {
    const track = tracks[trackId];
    if (!track || !track.isMultitrack || !track.steps) return;

    setRenamingStep({ trackId, stepIndex });
    setRenameValue(track.steps[stepIndex].name);
  };

  const finishRenameStep = () => {
    if (renamingStep && renameValue.trim()) {
      const { trackId, stepIndex } = renamingStep;
      const track = tracks[trackId];
      const step = track?.steps?.[stepIndex];
      const newName = renameValue.trim();

      // Only proceed if we have a valid step and the name actually changed
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
  };

  const renameStep = (trackId: string, stepIndex: number, newName: string) => {
    const track = tracks[trackId];
    if (!track || !track.isMultitrack || !track.steps) return;

    const updatedSteps = [...track.steps];
    updatedSteps[stepIndex] = {
      ...updatedSteps[stepIndex],
      name: newName.trim(),
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
  };

  const deleteStep = (trackId: string, stepIndex: number) => {
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
  };

  const downloadFolder = async (folderPath: string) => {
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Get all tracks in this folder and its subfolders
      const folderTracks = Object.values(tracks).filter(track =>
        track.folder === folderPath || track.folder?.startsWith(`${folderPath}/`)
      );

      if (folderTracks.length === 0) {
        toastActions.error(t('files:emptyFolder'));
        return;
      }

      // Add each track to the ZIP
      folderTracks.forEach((track) => {
        const relativePath = track.folder ? track.folder.replace(folderPath, '').replace(/^\//, '') : '';
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
      const folderName = folderPath.split('/').pop() || 'folder';
      a.download = `${folderName}-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toastActions.success(t('files:folderDownloaded'));
    } catch (error) {
      console.error('Folder download failed:', error);
      toastActions.error('Folder download failed');
    }
  };

  const downloadTrack = async (track: Track) => {
    if (track.isMultitrack && track.steps) {
      // Download as ZIP for multitrack
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Add each step as a separate file
      track.steps.forEach((step, index) => {
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
  };

  const importTrack = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    processFileImport(file);
    event.target.value = ''; // Reset input
  };

  const processFileImport = (file: File, targetFolder?: string) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const code = e.target?.result as string;
      const trackId = Date.now().toString();
      const trackName = file.name.replace(/\.(js|txt)$/, '');

      const newTrack: Track = {
        id: trackId,
        name: trackName,
        code,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        folder: targetFolder,
      };

      setTracks(prev => ({ ...prev, [trackId]: newTrack }));
      loadTrack(newTrack);
      toastActions.success(t('files:trackImported', { name: trackName }));
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);

    // Check for ZIP files first (library import)
    const zipFiles = files.filter(file => file.name.endsWith('.zip'));
    if (zipFiles.length > 0) {
      zipFiles.forEach(file => processLibraryImport(file));
      return;
    }

    // Handle regular JS/TXT files
    const jsFiles = files.filter(file =>
      file.type === 'text/javascript' ||
      file.name.endsWith('.js') ||
      file.name.endsWith('.txt')
    );

    if (jsFiles.length === 0) {
      toastActions.error(t('files:invalidFileType'));
      return;
    }

    jsFiles.forEach(file => processFileImport(file));
  };

  const startRename = (track: Track) => {
    setRenamingTrack(track.id);
    setRenameValue(track.name);
  };

  const finishRename = () => {
    if (renamingTrack && renameValue.trim()) {
      const track = tracks[renamingTrack];
      const oldName = track?.name;
      const newName = renameValue.trim();

      // Only proceed if we have a valid track and the name actually changed
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
  };

  const cancelRename = () => {
    setRenamingTrack(null);
    setRenamingFolder(null);
    setRenamingStep(null);
    setRenameValue('');
  };

  const cancelCreate = () => {
    setIsCreating(false);
    setIsCreatingFolder(false);
    setNewTrackName('');
    setNewFolderName('');
    setNewItemParentPath('');
  };

  const exportAllTracks = () => {
    const tracksData = JSON.stringify(tracks, null, 2);
    const blob = new Blob([tracksData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strudel-tracks.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportLibraryAsZip = async () => {
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Create library structure
      const libraryData = {
        tracks,
        folders,
        exportDate: new Date().toISOString(),
        version: '1.0'
      };

      // Add metadata
      zip.file('library-metadata.json', JSON.stringify(libraryData, null, 2));

      // Add each track with proper folder structure
      Object.values(tracks).forEach((track) => {
        const folderPath = track.folder || '';
        const trackPath = folderPath ? `${folderPath}/` : '';

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
      a.download = `strudel-library-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toastActions.success(t('files:libraryExported'));
    } catch (error) {
      console.error('Export failed:', error);
      toastActions.error('Export failed');
    }
  };

  const importLibraryFromZip = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
      toastActions.error(t('files:invalidLibraryFile'));
      return;
    }

    processLibraryImport(file);
    event.target.value = ''; // Reset input
  };

  const processLibraryImport = async (file: File) => {
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(file);

      // Check if it's a valid library export
      const metadataFile = zip.file('library-metadata.json');
      if (metadataFile) {
        // Import full library
        const metadataContent = await metadataFile.async('text');
        const libraryData = JSON.parse(metadataContent);

        if (libraryData.tracks && libraryData.folders) {
          // Merge with existing data (with conflict resolution)
          const newTracks = { ...tracks };
          const newFolders = { ...folders };

          // Import folders - fix to use path as key instead of ID
          Object.values(libraryData.folders).forEach((folder: any) => {
            // Use folder.path as key for consistency, not folder.id
            const folderKey = folder.path || folder.id;
            if (!newFolders[folderKey]) {
              newFolders[folderKey] = folder;
            }
          });

          // Import tracks
          Object.values(libraryData.tracks).forEach((track: any) => {
            const existingTrack = newTracks[track.id];
            if (existingTrack) {
              // Handle conflict - rename imported track
              const newId = `${track.id}_imported_${Date.now()}`;
              newTracks[newId] = {
                ...track,
                id: newId,
                name: `${track.name} (imported)`
              };
            } else {
              newTracks[track.id] = track;
            }
          });

          setTracks(newTracks);
          setFolders(newFolders);
          toastActions.success(t('files:libraryImported'));
        } else {
          toastActions.error(t('files:invalidLibraryFile'));
        }
      } else {
        // Try to import as individual files
        const jsFiles: File[] = [];
        zip.forEach((relativePath, zipEntry) => {
          if (relativePath.endsWith('.js') && !zipEntry.dir) {
            // Convert zip entry to File-like object for processing
            zipEntry.async('text').then(content => {
              const fileName = relativePath.split('/').pop() || 'imported.js';
              const trackName = fileName.replace(/\.[^/.]+$/, '');

              const trackId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
              const newTrack: Track = {
                id: trackId,
                name: trackName,
                code: content,
                created: new Date().toISOString(),
                modified: new Date().toISOString(),
              };

              setTracks(prev => ({ ...prev, [trackId]: newTrack }));
            });
          }
        });

        toastActions.success(t('files:libraryImported'));
      }
    } catch (error) {
      console.error('Import failed:', error);
      toastActions.error(t('files:invalidLibraryFile'));
    }
  };



  // Context menu items for tracks


  // Context menu items for empty space
  const createNewMultitrack = () => {
    const trackId = Date.now().toString();
    const newTrack: Track = {
      id: trackId,
      name: 'New Multitrack',
      code: '// New multitrack - Step 1\n',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      isMultitrack: true,
      steps: [
        {
          id: `${trackId}-step-1`,
          name: 'Step 1',
          code: '// New multitrack - Step 1\n',
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
        }
      ],
      activeStep: 0,
    };

    setTracks(prev => ({ ...prev, [trackId]: newTrack }));
    loadTrack(newTrack);
    toastActions.success(t('files:multitrackCreated'));
  };

  const getEmptySpaceContextItems = () => [
    {
      label: t('files:newTrack'),
      icon: <PlusIcon className="w-4 h-4" />,
      onClick: () => {
        setNewItemParentPath('');
        setIsCreating(true);
      },
    },
    {
      label: t('files:newMultitrack'),
      icon: <DocumentIcon className="w-4 h-4" />,
      onClick: createNewMultitrack,
    },
    {
      label: t('files:newFolder'),
      icon: <FolderIcon className="w-4 h-4" />,
      onClick: () => {
        setNewItemParentPath('');
        setIsCreatingFolder(true);
      },
    },
    { separator: true, label: '', onClick: () => {} },
    {
      label: t('files:importTrack'),
      icon: <ArrowDownTrayIcon className="w-4 h-4 rotate-180" />,
      onClick: () => {
        // Trigger file input click
        const fileInput = document.getElementById('file-import-input') as HTMLInputElement;
        fileInput?.click();
      },
    },
    {
      label: t('files:exportAll'),
      icon: <ArrowDownTrayIcon className="w-4 h-4" />,
      onClick: exportAllTracks,
    },
    {
      label: t('files:exportLibraryAsZip'),
      icon: <ArrowDownTrayIcon className="w-4 h-4" />,
      onClick: exportLibraryAsZip,
    },
    {
      label: t('files:importLibraryFromZip'),
      icon: <ArrowDownTrayIcon className="w-4 h-4 rotate-180" />,
      onClick: () => {
        const fileInput = document.getElementById('library-import-input') as HTMLInputElement;
        fileInput?.click();
      },
    },
  ];

  return (
    <div
      className={`h-full flex flex-col bg-lineHighlight text-foreground ${isDragOver ? 'bg-blue-900/20 border-2 border-blue-500 border-dashed' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg">
            {t('files:dropToImport')}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="p-3 border-b border-gray-600">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t('tabs:files')}</h3>
          <BurgerMenuButton
            items={getEmptySpaceContextItems()}
            size="sm"
          />
        </div>
        {/* Hidden file input for drag & drop and context menu import */}
        <input
          id="file-import-input"
          type="file"
          accept=".js,.txt"
          onChange={importTrack}
          className="hidden"
        />
        {/* Hidden file input for library import */}
        <input
          id="library-import-input"
          type="file"
          accept=".zip"
          onChange={importLibraryFromZip}
          className="hidden"
        />

        {/* New track input */}
        {isCreating && (
          <div className="flex space-x-1 mb-2">
            <input
              type="text"
              value={newTrackName}
              onChange={(e) => setNewTrackName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createNewTrack();
                if (e.key === 'Escape') cancelCreate();
              }}
              placeholder={t('files:trackName')}
              className="flex-1 px-2 py-1 text-xs bg-background border border-gray-600 rounded"
              autoFocus
            />
            <button
              onClick={() => createNewTrack()}
              className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
              disabled={!newTrackName.trim()}
            >
              {t('files:create')}
            </button>
            <button
              onClick={cancelCreate}
              className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded"
              title={t('common:cancel')}
            >
              ✕
            </button>
          </div>
        )}

        {/* New folder input */}
        {isCreatingFolder && (
          <div className="flex space-x-1 mb-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createNewFolder();
                if (e.key === 'Escape') cancelCreate();
              }}
              placeholder={t('files:folderName')}
              className="flex-1 px-2 py-1 text-xs bg-background border border-gray-600 rounded"
              autoFocus
            />
            <button
              onClick={() => createNewFolder()}
              className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 rounded"
              disabled={!newFolderName.trim()}
            >
              {t('files:createFolder')}
            </button>
            <button
              onClick={cancelCreate}
              className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded"
              title={t('common:cancel')}
            >
              ✕
            </button>
          </div>
        )}

        {/* New step input */}
        {isCreatingStep && selectedStepTrack && (
          <div className="flex space-x-1 mb-2">
            <input
              type="text"
              value={newStepName}
              onChange={(e) => setNewStepName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addStep(selectedStepTrack);
                if (e.key === 'Escape') {
                  setIsCreatingStep(false);
                  setNewStepName('');
                  setSelectedStepTrack(null);
                }
              }}
              placeholder={t('files:stepName')}
              className="flex-1 px-2 py-1 text-xs bg-background border border-gray-600 rounded"
              autoFocus
            />
            <button
              onClick={() => addStep(selectedStepTrack)}
              className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 rounded"
              disabled={!newStepName.trim()}
            >
              {t('files:addStep')}
            </button>
            <button
              onClick={() => {
                setIsCreatingStep(false);
                setNewStepName('');
                setSelectedStepTrack(null);
              }}
              className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded"
              title={t('common:cancel')}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* File Tree */}
      <FileTree
        tracks={tracks}
        folders={folders}
        selectedTrack={selectedTrack}
        activePattern={activePattern}
        hoveredTrack={hoveredTrack}
        onTrackSelect={handleTrackSelect}
        onTrackHover={setHoveredTrack}
        onTrackRename={handleTrackRename}
        onTrackDelete={deleteTrack}
        onTrackDuplicate={duplicateTrack}
        onTrackInfo={handleTrackInfo}
        onTrackDownload={downloadTrack}
        onFolderDownload={downloadFolder}
        onTrackCreate={handleTrackCreate}
        onFolderCreate={handleFolderCreate}
        onFolderRename={handleFolderRename}
        onFolderDelete={deleteFolder}
        onMoveItem={handleMoveItem}
        renamingTrack={renamingTrack}
        renamingFolder={renamingFolder}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        onRenameFinish={renamingTrack ? finishRename : finishRenameFolder}
        onRenameCancel={cancelRename}
        emptySpaceContextItems={getEmptySpaceContextItems()}
        onConvertToMultitrack={convertToMultitrack}
        onAddStep={(trackId) => {
          setSelectedStepTrack(trackId);
          setIsCreatingStep(true);
        }}
        onSwitchStep={switchToStep}
        onRenameStep={startRenameStep}
        onDeleteStep={deleteStep}
        renamingStep={renamingStep}
        onRenameStepFinish={finishRenameStep}
        onRenameStepCancel={cancelRename}
      />

      {/* Footer with current track info */}
      {(selectedTrack || activePattern) && (
        <div className="p-2 border-t border-gray-600 text-xs text-gray-400 space-y-1">
          {selectedTrack && tracks[selectedTrack] && (
            <div className="flex items-center justify-between">
              <div>📝 Editing: {tracks[selectedTrack].name}</div>
              <button
                onClick={async () => await saveCurrentTrack(true)}
                className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white text-xs"
                title={t('files:saveChanges')}
              >
                {t('files:saveChanges')}
              </button>
            </div>
          )}
          {activePattern && tracks[activePattern] && (
            <div>🎵 Playing: {tracks[activePattern].name}</div>
          )}
          {saveStatus && (
            <div className={`text-xs ${saveStatus === 'Saved!' ? 'text-green-400' : 'text-yellow-400'}`}>
              {saveStatus}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <InfoModal
        isOpen={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        title={infoModalData.title}
        items={infoModalData.items}
      />

      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setTrackToDelete(null);
          setIsDeletingTrack(false); // Reset deletion flag when modal is closed
        }}
        onConfirm={confirmDelete}
        title={t('files:deleteTrack')}
        message={`${t('files:confirmDeleteTrack')} "${trackToDelete ? tracks[trackToDelete]?.name : ''}"? ${t('files:actionCannotBeUndone')}`}
        confirmText={t('common:delete')}
        cancelText={t('common:cancel')}
        variant="danger"
      />

      <ConfirmModal
        isOpen={showDeleteFolderModal}
        onClose={() => {
          setShowDeleteFolderModal(false);
          setFolderToDelete(null);
          setFolderContents({subfolders: [], tracks: []});
        }}
        onConfirm={confirmFolderDelete}
        title={t('files:deleteFolder')}
        message={
          folderToDelete ? (
            <div>
              <p>{t('files:confirmDeleteFolder')} "{folders[folderToDelete]?.name}"?</p>
              <p className="mt-2 text-sm text-gray-400">{t('files:folderContainsItems')}:</p>
              <ul className="mt-1 text-sm text-gray-300 list-disc list-inside">
                {folderContents.subfolders.map(name => (
                  <li key={name}>📁 {name}</li>
                ))}
                {folderContents.tracks.map(name => (
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
    </div>
  );
}
