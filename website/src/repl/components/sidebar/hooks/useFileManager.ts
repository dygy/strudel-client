import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSettings } from '@src/settings';
import { useActivePattern, setActivePattern, setLatestCode } from '@src/user_pattern_utils';
import { toastActions } from '@src/stores/toastStore';
import { useTranslation } from '@src/i18n';
import { parseTrackUrlPath, findTrackByFolderAndSlug, generateTrackUrlPath } from '@src/lib/slugUtils';

// Helper: Get current track ID from URL (source of truth)
const getCurrentTrackIdFromURL = (): string | null => {
  if (typeof window === 'undefined') return null;
  
  // Extract track ID from current URL path
  const pathMatch = window.location.pathname.match(/^\/repl\/([^\/]+)$/);
  if (pathMatch) {
    return pathMatch[1];
  }
  
  // Fallback to query parameter for backward compatibility
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('track') || null;
};

export interface Track {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
  folder?: string;
  isMultitrack?: boolean;
  steps?: TrackStep[];
  activeStep?: number;
}

export interface TrackStep {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
}

export interface Folder {
  id: string;
  name: string;
  path: string;
  parent?: string;
  created: string;
}

interface ReplContext {
  activeCode?: string;
  editorRef?: React.RefObject<{ code: string; setCode?: (code: string) => void }>;
  handleUpdate: (update: { id?: string; code: string; [key: string]: any }, replace?: boolean) => void;
  trackRouter?: any;
}

const TRACKS_STORAGE_KEY = 'strudel_tracks';
const FOLDERS_STORAGE_KEY = 'strudel_folders';

export function useFileManager(context: ReplContext, options: { disabled?: boolean } = {}) {
  const [tracks, setTracks] = useState<Record<string, Track>>({});
  const [folders, setFolders] = useState<Record<string, Folder>>({});
  const [isInitialized, setIsInitialized] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  
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
  
  // Refs
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autosaveTrackIdRef = useRef<string | null>(null);
  const lastSavedCodeRef = useRef<string>('');
  const isDeletingTrackRef = useRef(false);
  const isDeletingFolderRef = useRef<Set<string>>(new Set());
  
  // Track-specific autosave contexts to prevent cross-contamination
  const trackAutosaveContextsRef = useRef<Map<string, {
    trackId: string;
    lastSavedCode: string;
    lastSavedTimestamp: number;
    isAutosaving: boolean;
    timer: NodeJS.Timeout | null;
  }>>(new Map());
  
  /**
   * Get or create isolated autosave context for a track
   */
  const getTrackAutosaveContext = useCallback((trackId: string) => {
    const contexts = trackAutosaveContextsRef.current;
    
    if (!contexts.has(trackId)) {
      contexts.set(trackId, {
        trackId,
        lastSavedCode: '',
        lastSavedTimestamp: 0,
        isAutosaving: false,
        timer: null
      });
    }
    
    return contexts.get(trackId)!;
  }, []);

  /**
   * Clear autosave timer for a specific track
   */
  const clearTrackAutosaveTimer = useCallback((trackId: string) => {
    const context = trackAutosaveContextsRef.current.get(trackId);
    if (context?.timer) {
      clearTimeout(context.timer);
      context.timer = null;
    }
  }, []);

  /**
   * Clean up autosave context when track is deleted or component unmounts
   */
  const cleanupTrackAutosaveContext = useCallback((trackId: string) => {
    clearTrackAutosaveTimer(trackId);
    trackAutosaveContextsRef.current.delete(trackId);
  }, [clearTrackAutosaveTimer]);

  // Hooks
  const { isAutosaveEnabled, autosaveInterval } = useSettings();
  const activePattern = useActivePattern();
  const { t } = useTranslation(['files', 'common', 'tabs']);

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

    loadData();

    const handleTracksUpdated = (event?: CustomEvent) => {
      console.log('FileManager - received tracks updated event, reloading...');
      loadData();
      
      if (event?.detail?.selectTrackId) {
        const trackIdToSelect = event.detail.selectTrackId;
        console.log('FileManager - will select track after update:', trackIdToSelect);
        
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('strudel-select-track', { 
            detail: { trackId: trackIdToSelect } 
          }));
        }, 150);
      }
    };

    const handleSelectTrack = (event: CustomEvent) => {
      const { trackId } = event.detail;
      console.log('FileManager - received select track event:', trackId);
      
      const selectTrackWithRetry = (retryCount = 0) => {
        const maxRetries = 5;
        
        // Get current tracks state
        let currentTracks: Record<string, Track> = {};
        setTracks(prev => {
          currentTracks = prev;
          return prev; // Don't actually change anything
        });
        
        if (currentTracks[trackId]) {
          console.log('FileManager - track found, loading:', currentTracks[trackId].name);
          setSelectedTrack(trackId);
          loadTrack(currentTracks[trackId]);
          // Use track name for URL instead of ID (pass folders to convert UUIDs to paths)
          let currentFolders: Record<string, Folder> = {};
          setFolders(prev => {
            currentFolders = prev;
            return prev;
          });
          const trackUrl = generateTrackUrlPath(currentTracks[trackId].name, currentTracks[trackId].folder, currentFolders);
          setActivePattern(trackUrl);
        } else if (retryCount < maxRetries) {
          console.log(`FileManager - track not found, retrying in 100ms (attempt ${retryCount + 1})`);
          setTimeout(() => selectTrackWithRetry(retryCount + 1), 100);
        } else {
          console.warn('FileManager - track not found after retries:', trackId);
          setSelectedTrack(trackId);
        }
      };
      
      selectTrackWithRetry();
    };

    // Only set up event listeners if not disabled (i.e., when Supabase is not being used)
    if (!options.disabled) {
      window.addEventListener('strudel-tracks-updated', handleTracksUpdated);
      window.addEventListener('strudel-select-track', handleSelectTrack);
      window.addEventListener('strudel-tracks-imported', handleTracksUpdated);
      
      // Store the handler for cleanup
      const cleanup = () => {
        window.removeEventListener('strudel-tracks-updated', handleTracksUpdated);
        window.removeEventListener('strudel-select-track', handleSelectTrack);
        window.removeEventListener('strudel-tracks-imported', handleTracksUpdated);
      };
      
      return cleanup;
    }

    setIsInitialized(true);

    return () => {
      // No cleanup needed when disabled
    };
  }, [options.disabled]); // Remove saveCurrentTrack from dependencies

  const loadTrack = useCallback((track: Track) => {
    console.log('FileManager - loadTrack called for:', track.name, track.id);
    setSelectedTrack(track.id);
    
    // Initialize track-specific autosave context
    const autosaveContext = getTrackAutosaveContext(track.id);
    autosaveContext.lastSavedCode = track.code;
    autosaveContext.lastSavedTimestamp = Date.now();
    
    // Clear any existing timer for this track
    clearTrackAutosaveTimer(track.id);
    
    lastSavedCodeRef.current = track.code;

    // Preload samples from track code
    const preloadSamples = async () => {
      try {
        // Import from @strudel/webaudio which re-exports superdough
        const webaudioModule = await import('@strudel/webaudio') as any;
        if (webaudioModule.preloadTrackSamples && track.code) {
          await webaudioModule.preloadTrackSamples(track.code, track.name || track.id);
        }
      } catch (error) {
        // Silently fail if sample cache isn't available
        console.debug('Sample preloading not available:', error);
      }
    };
    
    preloadSamples();

    // TRIPLE APPROACH: Update store, editor directly, AND trigger handleUpdate
    console.log('FileManager - updating latestCode store directly, length:', track.code.length);
    setLatestCode(track.code);
    
    // Also update editor directly if available
    if (context.editorRef?.current?.setCode) {
      console.log('FileManager - also updating editor directly');
      context.editorRef.current.setCode(track.code);
    }
    
    // ALSO trigger handleUpdate to ensure editor gets the change
    console.log('FileManager - also triggering handleUpdate');
    context.handleUpdate({ id: track.id, code: track.code }, true);
    
    lastSavedCodeRef.current = track.code;
  }, [context]);

  // Separate effect to handle activePattern changes (URL routing)
  useEffect(() => {
    if (!isInitialized || !activePattern) return;

    // Get current tracks state
    let currentTracks: Record<string, Track> = {};
    setTracks(prev => {
      currentTracks = prev;
      return prev; // Don't actually change anything
    });

    console.log('FileManager - activePattern changed, checking for URL routing:', activePattern);

    // NEW: activePattern is now a URL path, not a track ID
    // Parse the URL to find the actual track
    let targetTrack = null;
    
    if (activePattern.startsWith('/repl/')) {
      // Parse URL path to find track
      const parsedPath = parseTrackUrlPath(activePattern);
      
      if (parsedPath) {
        const { folderPath, trackSlug } = parsedPath;
        const tracksArray = Object.values(currentTracks);
        targetTrack = findTrackByFolderAndSlug(tracksArray, folderPath, trackSlug);
        console.log('FileManager - parsed URL path:', { folderPath, trackSlug, foundTrack: targetTrack?.name });
      }
    } else {
      // Fallback: try to find by track ID (backward compatibility)
      targetTrack = currentTracks[activePattern];
      console.log('FileManager - using activePattern as track ID (legacy):', activePattern);
    }

    // If we found a target track and it's different from selected track, load it
    if (targetTrack && selectedTrack !== targetTrack.id) {
      console.log('FileManager - URL routing: loading track from activePattern:', targetTrack.name);
      setSelectedTrack(targetTrack.id);
      loadTrack(targetTrack);
    } else if (targetTrack) {
      console.log('FileManager - track already selected, skipping load:', targetTrack.name);
    } else {
      console.log('FileManager - no track found for activePattern:', activePattern);
    }
  }, [activePattern, isInitialized, selectedTrack, loadTrack]);

  // Save tracks to localStorage whenever tracks change
  useEffect(() => {
    if (isInitialized && typeof localStorage !== 'undefined') {
      localStorage.setItem(TRACKS_STORAGE_KEY, JSON.stringify(tracks));
    }
  }, [tracks, isInitialized]);

  // Save folders to localStorage whenever folders change
  useEffect(() => {
    if (isInitialized && typeof localStorage !== 'undefined') {
      localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
    }
  }, [folders, isInitialized]);

  // Simplified synchronization logic - using useCallback to prevent infinite loops
  const synchronizeTracks = React.useCallback(() => {
    if (!isInitialized) return;

    // Get current tracks state
    let currentTracks: Record<string, Track> = {};
    setTracks(prev => {
      currentTracks = prev;
      return prev; // Don't actually change anything
    });

    console.log('FileManager - synchronization check:', {
      activePattern,
      selectedTrack,
      tracksCount: Object.keys(currentTracks).length,
      activePatternExists: !!currentTracks[activePattern]
    });

    // Only proceed if we have tracks loaded
    if (Object.keys(currentTracks).length === 0) {
      return;
    }

    // SIMPLIFIED LOGIC: Only synchronize when NO track is selected
    if (selectedTrack) {
      return; // Let user manually select tracks without interference
    }

    // Case 1: Active pattern exists directly in FileManager tracks
    if (activePattern && currentTracks[activePattern]) {
      console.log('FileManager - selecting active pattern directly:', currentTracks[activePattern].name);
      setSelectedTrack(activePattern);
      return;
    }

    // Case 2: Try to match by current editor code content
    const currentCode = context.editorRef?.current?.code || context.activeCode;
    if (currentCode && currentCode.trim()) {
      const matchingTrack = Object.values(currentTracks).find(track => 
        track.code && track.code.trim() === currentCode.trim()
      );
      
      if (matchingTrack) {
        console.log('FileManager - found matching track by editor code:', matchingTrack.name);
        setSelectedTrack(matchingTrack.id);
        if (activePattern !== matchingTrack.id) {
          setActivePattern(matchingTrack.id);
        }
        return;
      }
    }

    // Case 3: Try to create from user pattern system
    if (activePattern && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        const userPatternsData = localStorage.getItem('strudel-settingsuserPatterns');
        if (userPatternsData) {
          const userPatterns = JSON.parse(userPatternsData);
          const userPattern = userPatterns[activePattern];
          
          if (userPattern && userPattern.code) {
            const matchingTrack = Object.values(currentTracks).find(track => 
              track.code && track.code.trim() === userPattern.code.trim()
            );
            
            if (matchingTrack) {
              console.log('FileManager - found matching track by user pattern code:', matchingTrack.name);
              setSelectedTrack(matchingTrack.id);
              setActivePattern(matchingTrack.id);
              return;
            } else {
              console.log('FileManager - creating new track from user pattern:', activePattern);
              
              let trackName = 'New Track';
              if (userPattern.id && userPattern.id !== activePattern) {
                trackName = userPattern.id;
              } else if (typeof activePattern === 'string' && activePattern.length > 0) {
                if (!/^[a-zA-Z0-9]{12}$/.test(activePattern)) {
                  trackName = activePattern;
                }
              }
              
              const newTrack: Track = {
                id: activePattern,
                name: trackName,
                code: userPattern.code,
                created: new Date(userPattern.created_at || Date.now()).toISOString(),
                modified: new Date().toISOString(),
              };
              
              setTracks(prev => ({ ...prev, [activePattern]: newTrack }));
              setSelectedTrack(activePattern);
              
              setTimeout(() => {
                console.log('FileManager - loading newly created track:', newTrack.name);
                loadTrack(newTrack);
              }, 50);
              
              console.log('FileManager - created and selected new track:', newTrack.name);
              return;
            }
          }
        }
      } catch (e) {
        console.warn('FileManager - failed to check user patterns:', e);
      }
    }

    console.log('FileManager - no matching track found for synchronization');
  }, [activePattern, isInitialized, selectedTrack, context.editorRef, context.activeCode, loadTrack]);

  // Use the synchronization function in useEffect
  useEffect(() => {
    synchronizeTracks();
  }, [synchronizeTracks]);

  const saveCurrentTrack = useCallback(async (showToast: boolean = true) => {
    if (!selectedTrack) return false;
    return await saveSpecificTrack(selectedTrack, showToast);
  }, [selectedTrack]);

  // Set up save event listener for Cmd+S functionality (only when not disabled)
  useEffect(() => {
    if (options.disabled) return; // Don't set up when Supabase is being used

    const handleSave = (event: CustomEvent) => {
      console.log('FileManager - received save event:', event.detail);
      saveCurrentTrack(true); // Show toast on manual save
    };

    document.addEventListener('strudel-save', handleSave as EventListener);

    return () => {
      document.removeEventListener('strudel-save', handleSave as EventListener);
    };
  }, [options.disabled, saveCurrentTrack]);

  const saveSpecificTrack = useCallback(async (trackId: string, showToast: boolean = true) => {
    if (!trackId) {
      console.warn('FileManager - saveSpecificTrack: invalid track ID:', trackId);
      return false;
    }

    // STRICT VALIDATION: Ensure we're still on the same track
    if (selectedTrack !== trackId) {
      console.log('FileManager - saveSpecificTrack: track changed, skipping autosave for:', trackId);
      return false;
    }

    // Get current tracks from state using a function to avoid dependency issues
    let currentTracks: Record<string, Track> = {};
    setTracks(prev => {
      currentTracks = prev;
      return prev; // Don't actually change anything
    });
    
    if (!currentTracks[trackId]) {
      console.warn('FileManager - saveSpecificTrack: track not found:', trackId);
      return false;
    }

    // Get track-specific autosave context
    const autosaveContext = getTrackAutosaveContext(trackId);
    
    // Prevent concurrent saves for the same track
    if (autosaveContext.isAutosaving) {
      console.log('FileManager - saveSpecificTrack: already autosaving track:', trackId);
      return false;
    }

    let currentCode = context.editorRef?.current?.code || context.activeCode || '';
    if (!currentCode.trim()) {
      if (showToast) toastActions.warning(t('files:noCodeToSave'));
      return false;
    }

    // Use track-specific last saved code instead of global reference
    if (currentCode === autosaveContext.lastSavedCode) {
      console.log('FileManager - saveSpecificTrack: no changes for track:', trackId);
      return false;
    }

    // STRICT CODE VALIDATION: Ensure code matches what we expect for this track
    const expectedCode = currentTracks[trackId].code;
    if (autosaveContext.lastSavedCode !== expectedCode && autosaveContext.lastSavedCode !== '') {
      console.error('FileManager - saveSpecificTrack: CRITICAL - code mismatch detected!', {
        trackId,
        trackName: currentTracks[trackId].name,
        expectedLength: expectedCode.length,
        contextLength: autosaveContext.lastSavedCode.length,
        currentLength: currentCode.length
      });
      return false;
    }

    // Mark as autosaving to prevent concurrent operations
    autosaveContext.isAutosaving = true;

    // Auto-format on save if enabled
    let codeToSave = currentCode;
    try {
      // Get current settings from the proper settings store
      const { settingsMap } = await import('@src/settings');
      const settings = settingsMap.get();
      
      if (settings?.isPrettierEnabled && settings?.prettierAutoFormatOnSave) {
        console.log('FileManager - auto-formatting code before save');
        
        // Dynamically import the auto-format function
        const { autoFormatOnSave } = await import('@strudel/codemirror');
        const formatResult = await autoFormatOnSave(currentCode, settings);
        
        if (formatResult.success && formatResult.formattedCode) {
          codeToSave = formatResult.formattedCode;
          
          // Update the editor with formatted code if it's different
          if (codeToSave !== currentCode && context.editorRef?.current?.setCode) {
            context.editorRef.current.setCode(codeToSave);
          }
          
          console.log('FileManager - code auto-formatted successfully');
        } else if (formatResult.error) {
          console.warn('FileManager - auto-format failed:', formatResult.error);
          // Continue with original code if formatting fails
          if (showToast) {
            toastActions.warning(`Auto-format failed: ${formatResult.error}`);
          }
        }
      }
    } catch (error) {
      console.error('FileManager - auto-format error:', error);
      // Continue with original code if formatting fails
      if (showToast) {
        toastActions.warning('Auto-format failed, saving original code');
      }
    }

    console.log('FileManager - saving to track:', currentTracks[trackId]?.name, 'ID:', trackId);

    try {
      setTracks(prev => ({
        ...prev,
        [trackId]: {
          ...prev[trackId],
          code: codeToSave,
          modified: new Date().toISOString()
        }
      }));

      // Update track-specific context
      autosaveContext.lastSavedCode = codeToSave;
      autosaveContext.lastSavedTimestamp = Date.now();
      lastSavedCodeRef.current = codeToSave;

      if (showToast) {
        toastActions.success(t('files:trackSaved'));
        setSaveStatus('Saved!');
        setTimeout(() => setSaveStatus(''), 2000);
      }

      console.log('FileManager - saveSpecificTrack: SUCCESS for track:', trackId);
      return true;
    } catch (error) {
      console.error('FileManager - save failed:', error);
      if (showToast) {
        toastActions.error(t('files:errors.saveFailed'));
      }
      return false;
    } finally {
      // Always clear the autosaving flag
      autosaveContext.isAutosaving = false;
    }
  }, [context, t, selectedTrack, getTrackAutosaveContext]); // Removed 'tracks' to prevent infinite loop

  /**
   * Schedule autosave for a specific track with strict isolation
   */
  const scheduleTrackAutosave = useCallback((trackId: string) => {
    if (!isAutosaveEnabled || !trackId) return;

    const autosaveContext = getTrackAutosaveContext(trackId);
    
    // Clear any existing timer for this track
    clearTrackAutosaveTimer(trackId);
    
    // Don't schedule if already autosaving
    if (autosaveContext.isAutosaving) {
      console.log('FileManager - scheduleTrackAutosave: already autosaving, skipping:', trackId);
      return;
    }

    autosaveContext.timer = setTimeout(async () => {
      // Double-check that we're still on the same track when timer fires (URL-based)
      const currentTrackIdFromURL = getCurrentTrackIdFromURL();
      if (currentTrackIdFromURL === trackId) {
        console.log('FileManager - autosave timer fired for track (URL-based):', trackId);
        await saveSpecificTrack(trackId, false); // Don't show toast for autosave
      } else {
        console.log('FileManager - autosave timer fired but track changed (URL-based):', {
          scheduled: trackId,
          currentFromURL: currentTrackIdFromURL
        });
      }
    }, autosaveInterval);
  }, [isAutosaveEnabled, autosaveInterval, selectedTrack, getTrackAutosaveContext, clearTrackAutosaveTimer, saveSpecificTrack]);

  /**
   * Handle code changes to trigger autosave scheduling - URL-based
   */
  const handleCodeChange = useCallback(() => {
    const currentTrackId = getCurrentTrackIdFromURL();
    if (currentTrackId) {
      scheduleTrackAutosave(currentTrackId);
    }
  }, [scheduleTrackAutosave]);

  // Cleanup autosave contexts on unmount
  useEffect(() => {
    return () => {
      // Clear all track timers
      for (const [trackId] of trackAutosaveContextsRef.current) {
        clearTrackAutosaveTimer(trackId);
      }
      trackAutosaveContextsRef.current.clear();
    };
  }, [clearTrackAutosaveTimer]);

  // Monitor code changes for autosave - URL-based
  useEffect(() => {
    if (!isAutosaveEnabled || options.disabled) return;

    const checkCodeChanges = () => {
      const currentTrackId = getCurrentTrackIdFromURL();
      if (!currentTrackId) return;

      const currentCode = context.editorRef?.current?.code || context.activeCode || '';
      const autosaveContext = getTrackAutosaveContext(currentTrackId);
      
      if (currentCode !== autosaveContext.lastSavedCode && currentCode.trim()) {
        scheduleTrackAutosave(currentTrackId);
      }
    };

    const interval = setInterval(checkCodeChanges, 2000); // Check every 2 seconds
    return () => clearInterval(interval);
  }, [isAutosaveEnabled, options.disabled, context, getTrackAutosaveContext, scheduleTrackAutosave]);

  // Return all state and functions needed by the UI
  return {
    // State
    tracks,
    folders,
    selectedTrack,
    activePattern,
    isInitialized,
    
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
    
    // Strict Autosave Functions
    scheduleTrackAutosave,
    handleCodeChange,
    getTrackAutosaveContext,
    clearTrackAutosaveTimer,
    cleanupTrackAutosaveContext,
    
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