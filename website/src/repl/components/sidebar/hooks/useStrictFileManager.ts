/**
 * Strict File Manager with Bulletproof Autosave
 * 
 * This file manager ensures that autosave operations are completely isolated
 * per track and cannot accidentally save code from one track to another.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useStrictAutosave } from './useStrictAutosave';
import { useSettings } from '@src/settings';
import { useTranslation } from '@src/i18n';
import { toastActions } from '@src/stores/toastStore';

export interface Track {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
  folder: string | null;
  isMultitrack: boolean;
  steps: any[];
  activeStep: number;
  user_id?: string;
}

export interface Folder {
  id: string;
  name: string;
  path: string;
  parent: string | null;
  created: string;
  user_id?: string;
}

interface StrictFileManagerOptions {
  context: any; // ReplContext
  storageBackend: 'localStorage' | 'supabase';
  supabaseOperations?: {
    saveTracks: (tracks: Record<string, Track>) => Promise<void>;
    loadTracks: () => Promise<Record<string, Track>>;
    saveTrack: (trackId: string, code: string) => Promise<boolean>;
  };
}

const TRACKS_STORAGE_KEY = 'strudel-tracks';
const FOLDERS_STORAGE_KEY = 'strudel-folders';

export function useStrictFileManager(options: StrictFileManagerOptions) {
  const { context, storageBackend, supabaseOperations } = options;
  
  // State
  const [tracks, setTracks] = useState<Record<string, Track>>({});
  const [folders, setFolders] = useState<Record<string, Folder>>({});
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>('');
  
  // Refs for stable references
  const selectedTrackRef = useRef<string | null>(null);
  const tracksRef = useRef<Record<string, Track>>({});
  
  // Keep refs in sync
  useEffect(() => {
    selectedTrackRef.current = selectedTrack;
  }, [selectedTrack]);
  
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  // Hooks
  const { isAutosaveEnabled, autosaveInterval } = useSettings();
  const { t } = useTranslation(['files']);

  /**
   * Save track to storage backend
   */
  const saveTrackToBackend = useCallback(async (trackId: string, code: string): Promise<boolean> => {
    try {
      console.log('StrictFileManager: Saving track to backend', { trackId, backend: storageBackend });
      
      if (storageBackend === 'supabase' && supabaseOperations) {
        return await supabaseOperations.saveTrack(trackId, code);
      } else {
        // localStorage backend
        const currentTracks = tracksRef.current;
        if (!currentTracks[trackId]) {
          console.error('StrictFileManager: Track not found for save', trackId);
          return false;
        }

        const updatedTrack = {
          ...currentTracks[trackId],
          code,
          modified: new Date().toISOString()
        };

        const updatedTracks = {
          ...currentTracks,
          [trackId]: updatedTrack
        };

        // Save to localStorage
        localStorage.setItem(TRACKS_STORAGE_KEY, JSON.stringify(updatedTracks));
        
        // Update state
        setTracks(updatedTracks);
        
        return true;
      }
    } catch (error) {
      console.error('StrictFileManager: Save failed', error);
      return false;
    }
  }, [storageBackend, supabaseOperations]);

  /**
   * Get current active track ID from URL (source of truth)
   */
  const getActiveTrackId = useCallback((): string | null => {
    // Use URL as source of truth instead of state
    if (typeof window === 'undefined') return null;
    
    // Extract track ID from current URL path
    const pathMatch = window.location.pathname.match(/^\/repl\/([^\/]+)$/);
    if (pathMatch) {
      return pathMatch[1];
    }
    
    // Fallback to query parameter for backward compatibility
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('track') || null;
  }, []);

  /**
   * Get current active code
   */
  const getActiveCode = useCallback((): string => {
    return context.editorRef?.current?.code || context.activeCode || '';
  }, [context]);

  /**
   * Check if autosave is enabled
   */
  const isAutosaveEnabledCallback = useCallback((): boolean => {
    return isAutosaveEnabled;
  }, [isAutosaveEnabled]);

  /**
   * Get autosave interval
   */
  const getAutosaveInterval = useCallback((): number => {
    return autosaveInterval;
  }, [autosaveInterval]);

  // Initialize strict autosave
  const strictAutosave = useStrictAutosave({
    onSave: saveTrackToBackend,
    getActiveTrackId,
    getActiveCode,
    isEnabled: isAutosaveEnabledCallback,
    getInterval: getAutosaveInterval
  });

  /**
   * Load track and initialize autosave context
   */
  const loadTrack = useCallback(async (track: Track) => {
    console.log('StrictFileManager: Loading track', { id: track.id, name: track.name });
    
    // Update selected track
    setSelectedTrack(track.id);
    
    // Initialize strict autosave context for this track
    await strictAutosave.initializeTrack(track.id, track.code);
    
    // Update editor
    if (context.editorRef?.current?.setCode) {
      context.editorRef.current.setCode(track.code);
    }
    
    // Trigger context update
    context.handleUpdate({ id: track.id, code: track.code }, true);
    
    console.log('StrictFileManager: Track loaded successfully', track.id);
  }, [context, strictAutosave]);

  /**
   * Create new track
   */
  const createTrack = useCallback(async (name: string, folder: string | null = null): Promise<Track> => {
    const newTrack: Track = {
      id: `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      code: '// New track\n',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      folder,
      isMultitrack: false,
      steps: [],
      activeStep: 0
    };

    console.log('StrictFileManager: Creating new track', newTrack.id);

    // Update tracks state
    const updatedTracks = { ...tracks, [newTrack.id]: newTrack };
    setTracks(updatedTracks);

    // Save to backend
    if (storageBackend === 'localStorage') {
      localStorage.setItem(TRACKS_STORAGE_KEY, JSON.stringify(updatedTracks));
    }

    // Load the new track
    await loadTrack(newTrack);

    return newTrack;
  }, [tracks, storageBackend, loadTrack]);

  /**
   * Delete track and cleanup autosave context
   */
  const deleteTrack = useCallback(async (trackId: string) => {
    console.log('StrictFileManager: Deleting track', trackId);
    
    // Cleanup autosave context
    strictAutosave.cleanupTrack(trackId);
    
    // Remove from state
    const updatedTracks = { ...tracks };
    delete updatedTracks[trackId];
    setTracks(updatedTracks);
    
    // Save to backend
    if (storageBackend === 'localStorage') {
      localStorage.setItem(TRACKS_STORAGE_KEY, JSON.stringify(updatedTracks));
    }
    
    // If this was the selected track, clear selection
    if (selectedTrack === trackId) {
      setSelectedTrack(null);
    }
  }, [tracks, selectedTrack, storageBackend, strictAutosave]);

  /**
   * Force save current track
   */
  const saveCurrentTrack = useCallback(async (showToast: boolean = true): Promise<boolean> => {
    const success = await strictAutosave.forceSave();
    
    if (success && showToast) {
      toastActions.success(t('files:trackSaved'));
      setSaveStatus('Saved!');
      setTimeout(() => setSaveStatus(''), 2000);
    } else if (!success && showToast) {
      toastActions.error(t('files:errors.saveFailed'));
    }
    
    return success;
  }, [strictAutosave, t]);

  /**
   * Handle code changes to schedule autosave
   */
  const handleCodeChange = useCallback(() => {
    strictAutosave.scheduleAutosave();
  }, [strictAutosave]);

  /**
   * Get debug information for current track
   */
  const getDebugInfo = useCallback(() => {
    const currentTrackId = getActiveTrackId();
    if (!currentTrackId) return null;
    
    return {
      trackId: currentTrackId,
      trackName: tracks[currentTrackId]?.name,
      autosave: strictAutosave.getTrackDebugInfo(currentTrackId),
      codeLength: getActiveCode().length
    };
  }, [getActiveTrackId, tracks, strictAutosave, getActiveCode]);

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoading(true);
      
      try {
        if (storageBackend === 'supabase' && supabaseOperations) {
          const loadedTracks = await supabaseOperations.loadTracks();
          setTracks(loadedTracks);
        } else {
          // Load from localStorage
          const savedTracks = localStorage.getItem(TRACKS_STORAGE_KEY);
          const savedFolders = localStorage.getItem(FOLDERS_STORAGE_KEY);
          
          if (savedTracks) {
            setTracks(JSON.parse(savedTracks));
          }
          
          if (savedFolders) {
            setFolders(JSON.parse(savedFolders));
          }
        }
      } catch (error) {
        console.error('StrictFileManager: Failed to load initial data', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, [storageBackend, supabaseOperations]);

  // Set up keyboard save handler
  useEffect(() => {
    const handleSave = () => {
      saveCurrentTrack(true);
    };

    document.addEventListener('strudel-save', handleSave);
    return () => document.removeEventListener('strudel-save', handleSave);
  }, [saveCurrentTrack]);

  return {
    // State
    tracks,
    folders,
    selectedTrack,
    isLoading,
    saveStatus,
    
    // Actions
    loadTrack,
    createTrack,
    deleteTrack,
    saveCurrentTrack,
    handleCodeChange,
    
    // Debug
    getDebugInfo
  };
}