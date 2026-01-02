import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSettings } from '@src/settings';
import { useActivePattern } from '@src/user_pattern_utils';
import { toastActions } from '@src/stores/toastStore';
import { useTranslation } from '@src/i18n';
import { useAuth } from '../../../../contexts/AuthContext';
import { db, migration, type Track, type Folder } from '../../../../lib/supabase';

interface ReplContext {
  activeCode?: string;
  editorRef?: React.RefObject<{ code: string; setCode?: (code: string) => void }>;
  handleUpdate: (update: { id?: string; code: string; [key: string]: any }, replace?: boolean) => void;
  trackRouter?: any;
}

export function useSupabaseFileManager(context: ReplContext) {
  const { user, isAuthenticated } = useAuth();
  
  // Always call all hooks at the top level - never conditionally!
  const [tracks, setTracks] = useState<Record<string, Track>>({});
  const [folders, setFolders] = useState<Record<string, Folder>>({});
  const [isInitialized, setIsInitialized] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  
  // UI state
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newTrackName, setNewTrackName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [newItemParentPath, setNewItemParentPath] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState('');
  const [renamingTrack, setRenamingTrack] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renamingStep, setRenamingStep] = useState<{ trackId: string; stepIndex: number } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  
  // Modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [folderContents, setFolderContents] = useState<{subfolders: string[], tracks: string[]}>({subfolders: [], tracks: []});
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  
  // Step creation state
  const [isCreatingStep, setIsCreatingStep] = useState(false);
  const [newStepName, setNewStepName] = useState('');
  const [selectedStepTrack, setSelectedStepTrack] = useState<string | null>(null);
  
  // Drag & drop state
  const [isDragOver, setIsDragOver] = useState(false);
  
  // Migration state
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [hasMigrated, setHasMigrated] = useState(false);
  
  // Refs
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autosaveTrackIdRef = useRef<string | null>(null);
  const lastSavedCodeRef = useRef<string>('');
  const isDeletingTrackRef = useRef(false);
  const isDeletingFolderRef = useRef<Set<string>>(new Set());
  
  // Hooks
  const { isAutosaveEnabled, autosaveInterval } = useSettings();
  const activePattern = useActivePattern();
  const { t } = useTranslation(['files', 'common', 'tabs']);

  // Load data from Supabase when user is authenticated
  useEffect(() => {
    if (!isAuthenticated || !user) {
      // Clear data when not authenticated
      setTracks({});
      setFolders({});
      setIsInitialized(false);
      return;
    }

    loadDataFromSupabase();
  }, [isAuthenticated, user]);

  // Check for migration when user signs in
  useEffect(() => {
    if (isAuthenticated && user && !hasMigrated) {
      checkMigrationStatus();
    }
  }, [isAuthenticated, user, hasMigrated]);

  const checkMigrationStatus = async () => {
    try {
      const migrated = await migration.hasMigrated();
      const localStorageCleared = migration.isLocalStorageCleared();
      
      setHasMigrated(migrated);
      
      // Show migration modal if user hasn't migrated and has local data
      if (!migrated && !localStorageCleared) {
        const hasLocalData = checkForLocalData();
        if (hasLocalData) {
          setShowMigrationModal(true);
        }
      }
    } catch (error) {
      console.error('Error checking migration status:', error);
    }
  };

  const checkForLocalData = () => {
    if (typeof localStorage === 'undefined') return false;
    
    const tracksData = localStorage.getItem('strudel_tracks');
    const foldersData = localStorage.getItem('strudel_folders');
    
    return (tracksData && tracksData !== '{}') || (foldersData && foldersData !== '{}');
  };

  const loadDataFromSupabase = async () => {
    if (!isAuthenticated) return;
    
    setIsLoading(true);
    setSyncError(null);
    
    try {
      // Load tracks and folders in parallel
      const [tracksResult, foldersResult] = await Promise.all([
        db.tracks.getAll(),
        db.folders.getAll()
      ]);

      if (tracksResult.error) {
        throw new Error(`Failed to load tracks: ${tracksResult.error.message}`);
      }

      if (foldersResult.error) {
        throw new Error(`Failed to load folders: ${foldersResult.error.message}`);
      }

      // Convert arrays to objects with id as key
      const tracksObj = (tracksResult.data || []).reduce((acc, track) => {
        acc[track.id] = track;
        return acc;
      }, {} as Record<string, Track>);

      const foldersObj = (foldersResult.data || []).reduce((acc, folder) => {
        acc[folder.id] = folder;
        return acc;
      }, {} as Record<string, Folder>);

      setTracks(tracksObj);
      setFolders(foldersObj);
      setIsInitialized(true);

      console.log(`Loaded ${Object.keys(tracksObj).length} tracks and ${Object.keys(foldersObj).length} folders from Supabase`);
    } catch (error) {
      console.error('Error loading data from Supabase:', error);
      setSyncError(error instanceof Error ? error.message : 'Failed to load data');
      toastActions.error(t('files:errors.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const loadTrack = useCallback((track: Track) => {
    console.log('SupabaseFileManager - loadTrack called for:', track.name, track.id);
    setSelectedTrack(track.id);
    lastSavedCodeRef.current = track.code;

    // Preload samples from track code
    const preloadSamples = async () => {
      try {
        // Import from @strudel/webaudio which re-exports superdough
        const webaudioModule = await import('@strudel/webaudio');
        if (webaudioModule.preloadTrackSamples && track.code) {
          await webaudioModule.preloadTrackSamples(track.code, track.name || track.id);
        }
      } catch (error) {
        // Silently fail if sample cache isn't available
        console.debug('Sample preloading not available:', error);
      }
    };
    
    preloadSamples();

    // Always use handleUpdate first - it's the most reliable way
    console.log('SupabaseFileManager - updating track via handleUpdate:', track.code.substring(0, 50) + '...');
    context.handleUpdate({ id: track.id, code: track.code }, false);
    lastSavedCodeRef.current = track.code;

    // Try to set code directly in editor as well, but don't rely on it
    const trySetEditorCode = () => {
      if (context.editorRef?.current?.setCode) {
        console.log('SupabaseFileManager - also setting code directly in editor');
        context.editorRef.current.setCode(track.code);
      }
    };

    // Try immediately
    trySetEditorCode();
    
    // Also try after a short delay to catch cases where editor becomes ready
    setTimeout(trySetEditorCode, 50);
    setTimeout(trySetEditorCode, 200);
  }, [context]);

  // Handle activePattern changes (URL routing)
  useEffect(() => {
    if (!isInitialized || !activePattern || !isAuthenticated) return;

    console.log('SupabaseFileManager - activePattern changed:', activePattern);

    // If the activePattern exists in tracks and is different from selected track, load it
    if (tracks[activePattern] && selectedTrack !== activePattern) {
      console.log('SupabaseFileManager - URL routing: loading track from activePattern:', tracks[activePattern].name);
      setSelectedTrack(activePattern);
      loadTrack(tracks[activePattern]);
    }
  }, [activePattern, isInitialized, selectedTrack, loadTrack, tracks, isAuthenticated]);

  const saveCurrentTrack = useCallback(async (showToast: boolean = true) => {
    if (!selectedTrack || !isAuthenticated) return false;
    return await saveSpecificTrack(selectedTrack, showToast);
  }, [selectedTrack, isAuthenticated]);

  const saveSpecificTrack = useCallback(async (trackId: string, showToast: boolean = true) => {
    if (!trackId || !isAuthenticated) {
      console.warn('SupabaseFileManager - saveSpecificTrack: not authenticated or invalid track ID:', trackId);
      return false;
    }

    if (selectedTrack !== trackId) {
      console.log('SupabaseFileManager - saveSpecificTrack: track changed, skipping autosave for:', trackId);
      return false;
    }

    if (!tracks[trackId]) {
      console.warn('SupabaseFileManager - saveSpecificTrack: track not found:', trackId);
      return false;
    }

    let currentCode = context.editorRef?.current?.code || context.activeCode || '';
    if (!currentCode.trim()) {
      if (showToast) toastActions.warning(t('files:noCodeToSave'));
      return false;
    }

    if (currentCode === lastSavedCodeRef.current) {
      return false;
    }

    const expectedCode = tracks[trackId].code;
    if (lastSavedCodeRef.current !== expectedCode && lastSavedCodeRef.current !== '') {
      console.warn('SupabaseFileManager - saveSpecificTrack: code mismatch detected, skipping save');
      return false;
    }

    console.log('SupabaseFileManager - saving to Supabase:', tracks[trackId]?.name, 'ID:', trackId);

    try {
      // Update in Supabase
      const { data, error } = await db.tracks.update(trackId, {
        code: currentCode,
        modified: new Date().toISOString()
      });

      if (error) {
        throw error;
      }

      // Update local state
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
    } catch (error) {
      console.error('Error saving track to Supabase:', error);
      if (showToast) {
        toastActions.error(t('files:errors.saveFailed'));
      }
      setSyncError(error instanceof Error ? error.message : 'Save failed');
      return false;
    }
  }, [context, t, selectedTrack, tracks, isAuthenticated]);

  const createTrack = useCallback(async (name: string, code: string = '', folder?: string, isMultitrack?: boolean, steps?: any[], activeStep?: number) => {
    if (!isAuthenticated) {
      toastActions.error(t('auth:errors.notAuthenticated'));
      return null;
    }

    try {
      const newTrack: Omit<Track, 'user_id'> = {
        id: Date.now().toString(),
        name,
        code,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        folder,
        is_multitrack: isMultitrack,
        steps,
        active_step: activeStep,
      };

      const { data, error } = await db.tracks.create(newTrack);

      if (error) {
        throw error;
      }

      if (data) {
        setTracks(prev => ({ ...prev, [data.id]: data }));
        toastActions.success(t('files:trackCreated'));
        return data;
      }

      return null;
    } catch (error) {
      console.error('Error creating track:', error);
      toastActions.error(t('files:errors.createFailed'));
      setSyncError(error instanceof Error ? error.message : 'Create failed');
      return null;
    }
  }, [isAuthenticated, t]);

  const createFolder = useCallback(async (name: string, path: string, parent?: string) => {
    if (!isAuthenticated) {
      toastActions.error(t('auth:errors.notAuthenticated'));
      return null;
    }

    try {
      const newFolder: Omit<Folder, 'user_id'> = {
        id: Date.now().toString(),
        name,
        path,
        parent,
        created: new Date().toISOString(),
      };

      const { data, error } = await db.folders.create(newFolder);

      if (error) {
        throw error;
      }

      if (data) {
        setFolders(prev => ({ ...prev, [data.id]: data }));
        toastActions.success(t('files:folderCreated'));
        return data;
      }

      return null;
    } catch (error) {
      console.error('Error creating folder:', error);
      toastActions.error(t('files:errors.createFailed'));
      setSyncError(error instanceof Error ? error.message : 'Create failed');
      return null;
    }
  }, [isAuthenticated, t]);

  const deleteTrack = useCallback(async (trackId: string) => {
    if (!isAuthenticated) {
      toastActions.error(t('auth:errors.notAuthenticated'));
      return false;
    }

    try {
      const { error } = await db.tracks.delete(trackId);

      if (error) {
        throw error;
      }

      setTracks(prev => {
        const newTracks = { ...prev };
        delete newTracks[trackId];
        return newTracks;
      });

      if (selectedTrack === trackId) {
        setSelectedTrack(null);
      }

      toastActions.success(t('files:trackDeleted'));
      return true;
    } catch (error) {
      console.error('Error deleting track:', error);
      toastActions.error(t('files:errors.deleteFailed'));
      setSyncError(error instanceof Error ? error.message : 'Delete failed');
      return false;
    }
  }, [isAuthenticated, selectedTrack, t]);

  const handleMigrationComplete = () => {
    setShowMigrationModal(false);
    setHasMigrated(true);
    loadDataFromSupabase(); // Reload data after migration
  };

  const deleteAllTracks = useCallback(async () => {
    if (!isAuthenticated) {
      toastActions.error(t('auth:errors.notAuthenticated'));
      return false;
    }

    const trackIds = Object.keys(tracks);
    const folderIds = Object.keys(folders);
    
    if (trackIds.length === 0 && folderIds.length === 0) return true;

    try {
      // Delete all tracks and folders from Supabase in parallel
      const deletePromises = [
        ...trackIds.map(trackId => db.tracks.delete(trackId)),
        ...folderIds.map(folderId => db.folders.delete(folderId))
      ];
      
      await Promise.all(deletePromises);

      // Clear local state
      setTracks({});
      setFolders({});
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

      return true;
    } catch (error) {
      console.error('Error deleting all tracks and folders:', error);
      toastActions.error(t('files:errors.deleteFailed'));
      setSyncError(error instanceof Error ? error.message : 'Delete all failed');
      return false;
    }
  }, [isAuthenticated, tracks, folders, setTracks, setFolders, setSelectedTrack, context, t]);

  // If not authenticated, return minimal state but still with all the same structure
  if (!isAuthenticated || !user) {
    return {
      // State
      tracks: {},
      folders: {},
      selectedTrack: null,
      activePattern,
      isInitialized: false,
      isLoading: false,
      syncError: null,
      isAuthenticated: false,
      
      // Migration
      showMigrationModal: false,
      setShowMigrationModal: () => {},
      handleMigrationComplete: () => {},
      
      // UI State
      isCreating: false,
      isCreatingFolder: false,
      newTrackName: '',
      newFolderName: '',
      newItemParentPath: '',
      saveStatus: '',
      renamingTrack: null,
      renamingFolder: null,
      renamingStep: null,
      renameValue: '',
      showDeleteModal: false,
      trackToDelete: null,
      showDeleteFolderModal: false,
      folderToDelete: null,
      folderContents: {subfolders: [], tracks: []},
      showDeleteAllModal: false,
      isCreatingStep: false,
      newStepName: '',
      selectedStepTrack: null,
      isDragOver: false,
      
      // Setters (no-ops)
      setTracks: () => {},
      setFolders: () => {},
      setSelectedTrack: () => {},
      setIsCreating: () => {},
      setIsCreatingFolder: () => {},
      setNewTrackName: () => {},
      setNewFolderName: () => {},
      setNewItemParentPath: () => {},
      setSaveStatus: () => {},
      setRenamingTrack: () => {},
      setRenamingFolder: () => {},
      setRenamingStep: () => {},
      setRenameValue: () => {},
      setShowDeleteModal: () => {},
      setTrackToDelete: () => {},
      setShowDeleteFolderModal: () => {},
      setFolderToDelete: () => {},
      setFolderContents: () => {},
      setShowDeleteAllModal: () => {},
      setIsCreatingStep: () => {},
      setNewStepName: () => {},
      setSelectedStepTrack: () => {},
      setIsDragOver: () => {},
      
      // Functions
      loadTrack: () => {},
      saveCurrentTrack: async () => false,
      saveSpecificTrack: async () => false,
      createTrack: async () => null,
      createFolder: async () => null,
      deleteTrack: async () => false,
      deleteAllTracks: async () => false,
      loadDataFromSupabase: async () => {},
      
      // Refs (empty)
      autosaveTimerRef: { current: null },
      autosaveTrackIdRef: { current: null },
      lastSavedCodeRef: { current: '' },
      isDeletingTrackRef: { current: false },
      isDeletingFolderRef: { current: new Set() },
      
      // Settings
      isAutosaveEnabled,
      autosaveInterval,
      
      // Translation
      t,
    };
  }

  // Return all state and functions needed by the UI
  return {
    // State
    tracks,
    folders,
    selectedTrack,
    activePattern,
    isInitialized,
    isLoading,
    syncError,
    isAuthenticated,
    
    // Migration
    showMigrationModal,
    setShowMigrationModal,
    handleMigrationComplete,
    
    // UI State
    isCreating,
    isCreatingFolder,
    newTrackName,
    newFolderName,
    newItemParentPath,
    saveStatus,
    renamingTrack,
    renamingFolder,
    renamingStep,
    renameValue,
    showDeleteModal,
    trackToDelete,
    showDeleteFolderModal,
    folderToDelete,
    folderContents,
    showDeleteAllModal,
    isCreatingStep,
    newStepName,
    selectedStepTrack,
    isDragOver,
    
    // Setters
    setTracks,
    setFolders,
    setSelectedTrack,
    setIsCreating,
    setIsCreatingFolder,
    setNewTrackName,
    setNewFolderName,
    setNewItemParentPath,
    setSaveStatus,
    setRenamingTrack,
    setRenamingFolder,
    setRenamingStep,
    setRenameValue,
    setShowDeleteModal,
    setTrackToDelete,
    setShowDeleteFolderModal,
    setFolderToDelete,
    setFolderContents,
    setShowDeleteAllModal,
    setIsCreatingStep,
    setNewStepName,
    setSelectedStepTrack,
    setIsDragOver,
    
    // Functions
    loadTrack,
    saveCurrentTrack,
    saveSpecificTrack,
    createTrack,
    createFolder,
    deleteTrack,
    deleteAllTracks,
    loadDataFromSupabase,
    
    // Refs
    autosaveTimerRef,
    autosaveTrackIdRef,
    lastSavedCodeRef,
    isDeletingTrackRef,
    isDeletingFolderRef,
    
    // Settings
    isAutosaveEnabled,
    autosaveInterval,
    
    // Translation
    t,
  };
}