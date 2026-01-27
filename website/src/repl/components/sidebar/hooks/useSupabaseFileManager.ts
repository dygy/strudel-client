import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useSettings} from '@src/settings';
import {getActivePattern, setActivePattern, useActivePattern} from '@src/user_pattern_utils';
import {toastActions} from '@src/stores/toastStore';
import {useTranslation} from '@src/i18n';
import {useAuth} from '@src/hooks/useAuth';
import {db, type Folder, type Track, secureApi} from '@src/lib/secureApi.ts';
import {getEditorInstance, setPendingCode} from '@src/stores/editorStore.ts';
import {tracksStore, tracksActions} from '@src/stores/tracksStore.ts';
import {nanoid} from 'nanoid';
import { TreeDataTransformer } from '@src/lib/TreeDataTransformer';
import {
  parseTrackUrlPath,
  findTrackByFolderAndSlug,
  extractStepFromUrl,
  generateTrackUrlPath,
  trackNameToSlug,
} from '@src/lib/slugUtils';

// Helper: Get current track ID from URL (source of truth)
// Now handles slug-based URLs with folder support
// IMPORTANT: Handles both folder paths (new) and folder IDs (legacy) for backward compatibility
const getCurrentTrackIdFromURL = (tracksMap: Record<string, Track>, foldersMap: Record<string, Folder>): string | null => {
  if (typeof window === 'undefined') return null;

  const currentPath = window.location.pathname;
  
  // Parse the URL to get folder path and track slug
  // URL format: /repl/folder/track-slug or /repl/track-slug
  const pathMatch = currentPath.match(/^\/repl\/(.+)$/);
  if (!pathMatch) {
    return null;
  }
  
  const fullPath = pathMatch[1];
  const segments = fullPath.split('/');
  const trackSlug = segments.pop() || '';
  const urlFolderPath = segments.length > 0 ? segments.join('/') : null;
  
  // Find the track by slug and folder path
  const tracks = Object.values(tracksMap);
  
  // Try to find track by matching slug and folder
  const track = tracks.find(t => {
    const tSlug = trackNameToSlug(t.name);
    const slugMatch = tSlug === trackSlug;
    
    if (!slugMatch) return false;
    
    // If no folder in URL, match tracks with no folder
    if (!urlFolderPath) {
      return !t.folder || t.folder === 'root';
    }
    
    // Check if track.folder matches the URL folder path
    // Case 1: track.folder is already a path (new format)
    if (t.folder === urlFolderPath) {
      return true;
    }
    
    // Case 2: track.folder is a UUID (legacy format) - need to look up the folder's path
    const folder = foldersMap[t.folder];
    if (folder && folder.path === urlFolderPath) {
      return true;
    }
    
    // Case 3: URL might contain a folder UUID (legacy URL format)
    if (t.folder === urlFolderPath) {
      return true;
    }
    
    return false;
  });
  
  // Only log if track not found and we have tracks loaded (to help debug issues)
  if (!track && tracks.length > 0) {
    console.warn('getCurrentTrackIdFromURL - track not found for URL:', { trackSlug, urlFolderPath, availableTracks: tracks.length });
  }
  
  return track?.id || null;
};

// Helper: Convert array to record keyed by id
const arrayToRecord = <T extends { id: string }>(items: T[]): Record<string, T> =>
  Object.fromEntries(items.map(item => [item.id, item]));

// Helper: Sync local state to global tracksStore
const syncToGlobalStore = (tracksObj: Record<string, Track>, foldersObj: Record<string, Folder>) => {
  tracksActions.clear();
  Object.values(tracksObj).forEach(track => tracksActions.addTrack(track));
  Object.values(foldersObj).forEach(folder => tracksActions.addFolder(folder));
  tracksStore.set({
    ...tracksStore.get(),
    isInitialized: true,
    isLoading: false,
    error: null
  });
};

// Helper: Centralized error handling
const handleApiError = (
  error: unknown,
  context: string,
  setSyncError: (err: string | null) => void,
  toastMessage?: string
) => {
  console.error(`SupabaseFileManager - ${context}:`, error);
  const message = error instanceof Error ? error.message : 'Unknown error';
  setSyncError(message);
  if (toastMessage) {
    toastActions.error(toastMessage);
  }
  return message;
};

// No-op function for unauthenticated state
const noop = () => {};
const asyncNoopFalse = async () => false;
const asyncNoopNull = async () => null;
const asyncNoopVoid = async () => {};

// Static unauthenticated state (values that don't depend on hooks)
const UNAUTHENTICATED_STATIC_STATE = {
  tracks: {} as Record<string, Track>,
  folders: {} as Record<string, Folder>,
  selectedTrack: null,
  isInitialized: false,
  isLoading: false,
  syncError: null,
  isAuthenticated: false,
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
  folderContents: { subfolders: [] as string[], tracks: [] as string[] },
  showDeleteAllModal: false,
  isCreatingStep: false,
  newStepName: '',
  selectedStepTrack: null,
  isDragOver: false,
  setTracks: noop,
  setFolders: noop,
  setSelectedTrack: noop,
  setIsCreating: noop,
  setIsCreatingFolder: noop,
  setNewTrackName: noop,
  setNewFolderName: noop,
  setNewItemParentPath: noop,
  setSaveStatus: noop,
  setRenamingTrack: noop,
  setRenamingFolder: noop,
  setRenamingStep: noop,
  setRenameValue: noop,
  setShowDeleteModal: noop,
  setTrackToDelete: noop,
  setShowDeleteFolderModal: noop,
  setFolderToDelete: noop,
  setFolderContents: noop,
  setShowDeleteAllModal: noop,
  setIsCreatingStep: noop,
  setNewStepName: noop,
  setSelectedStepTrack: noop,
  setIsDragOver: noop,
  loadTrack: noop,
  saveCurrentTrack: asyncNoopFalse,
  saveSpecificTrack: asyncNoopFalse,
  createTrack: asyncNoopNull,
  createFolder: asyncNoopNull,
  deleteTrack: asyncNoopFalse,
  deleteAllTracks: asyncNoopFalse,
  loadDataFromSupabase: asyncNoopVoid,
  refreshFromSupabase: asyncNoopVoid,
  autosaveTimerRef: { current: null },
  autosaveTrackIdRef: { current: null },
  lastSavedCodeRef: { current: '' },
  isDeletingTrackRef: { current: false },
  isDeletingFolderRef: { current: new Set<string>() },
};

interface ReplContext {
  activeCode?: string;
  editorRef?: React.RefObject<{ code: string; setCode?: (code: string) => void }>;
  handleUpdate: (update: { id?: string; code: string; [key: string]: any }, replace?: boolean) => void;
  trackRouter?: any;
}

export function useSupabaseFileManager(context: ReplContext, ssrData?: { tracks: any[]; folders: any[]; } | null, readOnly: boolean = false) {
  const { user, isAuthenticated, loading, checkAuth } = useAuth();

  // Always call all hooks at the top level - never conditionally!
  const [tracks, setTracks] = useState<Record<string, Track>>({});
  const [folders, setFolders] = useState<Record<string, Folder>>({});
  const [isInitialized, setIsInitialized] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [hasLoadedData, setHasLoadedData] = useState(false); // Add flag to prevent duplicate loads

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
  const [hasMigrated, setHasMigrated] = useState(true); // Always consider migrated since we removed migration

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

  // Hooks
  const { isAutosaveEnabled, autosaveInterval } = useSettings();
  const activePattern = useActivePattern();
  const { t } = useTranslation(['files', 'common', 'tabs', 'auth']);

  // Load data from Supabase when user is authenticated
  useEffect(() => {
    // In read-only mode (admin viewing another user), ONLY use SSR data
    if (readOnly) {
      if (ssrData) {
        const tracksObj = arrayToRecord(ssrData.tracks || []);
        const foldersObj = arrayToRecord(ssrData.folders || []);

        console.log('SupabaseFileManager - READ-ONLY mode, using SSR data only:', Object.keys(tracksObj).length, 'tracks,', Object.keys(foldersObj).length, 'folders');

        setTracks(tracksObj);
        setFolders(foldersObj);
        setIsInitialized(true);
        setHasLoadedData(true);
        // Don't sync to global store in read-only mode to avoid overwriting user's own data
      } else {
        console.log('SupabaseFileManager - READ-ONLY mode but no SSR data, initializing empty');
        setIsInitialized(true);
        setHasLoadedData(true);
      }
      return;
    }

    if (!user) {
      // Clear data when no user
      setTracks({});
      setFolders({});
      setIsInitialized(false);
      setHasLoadedData(false);
      return;
    }

    // Don't load data if authentication is still loading (prevents race conditions)
    if (loading) {
      console.log('SupabaseFileManager - Authentication still loading, waiting...');
      return;
    }

    // Don't try to load data if we don't have an authenticated user
    if (!isAuthenticated) {
      console.log('SupabaseFileManager - User not authenticated, skipping data load');
      setIsInitialized(true); // Set as initialized to prevent loading loops
      setIsLoading(false);
      return;
    }

    // Prevent duplicate loads, but allow retry if authentication state changed
    if (hasLoadedData && isInitialized) {
      return;
    }

    // Add a timeout to prevent infinite loading - reduced timeout
    const loadTimeout = setTimeout(() => {
      if (!hasLoadedData && !isInitialized) {
        console.warn('SupabaseFileManager - Load timeout reached, setting initialized to prevent infinite loading');
        setIsInitialized(true);
        setIsLoading(false);
        setSyncError('Load timeout - please refresh the page');
      }
    }, 15000); // Reduced to 15 seconds

    // If we have SSR data, use it immediately
    if (ssrData) {
      const tracksObj = arrayToRecord(ssrData.tracks || []);
      const foldersObj = arrayToRecord(ssrData.folders || []);

      console.log('SupabaseFileManager - Using SSR data:', Object.keys(tracksObj).length, 'tracks,', Object.keys(foldersObj).length, 'folders');

      setTracks(tracksObj);
      setFolders(foldersObj);
      setIsInitialized(true);
      setHasLoadedData(true);
      syncToGlobalStore(tracksObj, foldersObj);

      clearTimeout(loadTimeout);
      return;
    }

    // Fallback to client-side loading if no SSR data
    console.log('SupabaseFileManager - No SSR data, loading from Supabase client-side');
    loadDataFromSupabase().finally(() => {
      clearTimeout(loadTimeout);
    });

    // Cleanup timeout on unmount
    return () => {
      clearTimeout(loadTimeout);
    };
  }, [user, loading, isAuthenticated, ssrData, readOnly]); // Add readOnly to dependencies



  const loadDataFromSupabase = async () => {
    if (!user) return;

    setIsLoading(true);
    setSyncError(null);

    try {
      console.log('SupabaseFileManager - loading tracks directly from Supabase');

      // If we have a user, try direct load first (faster)
      if (user) {
        console.log('SupabaseFileManager - User exists, attempting direct data load...');

        try {
          const { tracks: tracksData, folders: foldersData } = await secureApi.getTracks();

          if (tracksData && foldersData) {
            console.log('SupabaseFileManager - Direct data load successful');

            // Convert to expected format
            const tracks = tracksData.map(track => ({
              id: track.id,
              name: track.name,
              code: track.code || '',
              created: track.created,
              modified: track.modified,
              folder: track.folder,
              isMultitrack: track.isMultitrack || false,
              steps: track.steps || [],
              activeStep: track.activeStep || 0,
              user_id: track.user_id,
            }));

            const folders = foldersData.map(folder => ({
              id: folder.id,
              name: folder.name,
              path: folder.path,
              parent: folder.parent,
              created: folder.created,
              user_id: folder.user_id,
            }));

            const tracksObj = arrayToRecord(tracks);
            const foldersObj = arrayToRecord(folders);

            setTracks(tracksObj);
            setFolders(foldersObj);
            setIsInitialized(true);
            setHasLoadedData(true);
            syncToGlobalStore(tracksObj, foldersObj);

            console.log('SupabaseFileManager - Direct load completed successfully');
            setIsLoading(false);
            return;
          }
        } catch (directError) {
          console.log('SupabaseFileManager - Direct load failed, trying with session validation:', directError);
        }
      }

      // Fallback: Add timeout to prevent infinite waiting - reduced timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Session validation timeout')), 5000); // Reduced to 5 seconds
      });

      // Ensure we have a valid session before making database calls with timeout
      const validSession = await Promise.race([
        checkAuth(),
        timeoutPromise
      ]);

      if (!validSession) {
        throw new Error('Unable to establish valid session');
      }

      console.log('SupabaseFileManager - Session validated, loading data...');

      // Load tracks and folders from Supabase using the correct API
      const { tracks: tracksData, folders: foldersData } = await secureApi.getTracks();

      if (tracksData && foldersData) {
        console.log('SupabaseFileManager - Data loaded successfully from secureApi');

        // Convert to expected format
        const tracks = tracksData.map(track => ({
          id: track.id,
          name: track.name,
          code: track.code || '',
          created: track.created,
          modified: track.modified,
          folder: track.folder,
          isMultitrack: track.isMultitrack || false,
          steps: track.steps || [],
          activeStep: track.activeStep || 0,
          user_id: track.user_id,
        }));

        const folders = foldersData.map(folder => ({
          id: folder.id,
          name: folder.name,
          path: folder.path,
          parent: folder.parent,
          created: folder.created,
          user_id: folder.user_id,
        }));

        // Transform to hierarchical tree structure for tracksStore
        const tree = TreeDataTransformer.transformToTree(tracks, folders);

        // Convert to record format for local state
        const tracksObj = arrayToRecord(tracks);
        const foldersObj = arrayToRecord(folders);

        setTracks(tracksObj);
        setFolders(foldersObj);
        setIsInitialized(true);
        setHasLoadedData(true);
        syncToGlobalStore(tracksObj, foldersObj);

        console.log('SupabaseFileManager - Data loaded successfully:', {
          tracksCount: tracks.length,
          foldersCount: folders.length,
          format: 'both'
        });
      } else {
        console.error('SupabaseFileManager - No data returned from secureApi');
      }
    } catch (error) {
      console.error('SupabaseFileManager - Error loading data:', error);

      // If it's a session timeout, try direct load (cookies might still be valid)
      if (error instanceof Error && error.message === 'Session validation timeout') {
        console.log('SupabaseFileManager - Session timeout, attempting direct data load...');

        try {
          const { tracks: tracksData, folders: foldersData } = await secureApi.getTracks();

          if (tracksData && foldersData) {
            // Convert to expected format
            const tracks = tracksData.map(track => ({
              id: track.id,
              name: track.name,
              code: track.code || '',
              created: track.created,
              modified: track.modified,
              folder: track.folder,
              isMultitrack: track.isMultitrack || false,
              steps: track.steps || [],
              activeStep: track.activeStep || 0,
              user_id: track.user_id,
            }));

            const folders = foldersData.map(folder => ({
              id: folder.id,
              name: folder.name,
              path: folder.path,
              parent: folder.parent,
              created: folder.created,
              user_id: folder.user_id,
            }));

            const tracksObj = arrayToRecord(tracks);
            const foldersObj = arrayToRecord(folders);

            setTracks(tracksObj);
            setFolders(foldersObj);
            setIsInitialized(true);
            setHasLoadedData(true);
            syncToGlobalStore(tracksObj, foldersObj);

            console.log('SupabaseFileManager - Direct load completed successfully');
            setIsLoading(false);
            return;
          }
        } catch (directError) {
          console.error('SupabaseFileManager - Direct load also failed:', directError);
        }
      }

      setSyncError(error instanceof Error ? error.message : 'Failed to load data');
      toastActions.error(t('files:errors.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

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

  const loadTrack = useCallback((track: Track) => {
    console.log('SupabaseFileManager - loadTrack called for:', track.name, track.id);
    setSelectedTrack(track.id);

    // Initialize track-specific autosave context
    const autosaveContext = getTrackAutosaveContext(track.id);
    autosaveContext.lastSavedCode = track.code;
    autosaveContext.lastSavedTimestamp = Date.now();

    // Clear any existing timer for this track
    clearTrackAutosaveTimer(track.id);

    lastSavedCodeRef.current = track.code;

    // Store the code in nano store so it can be picked up when editor is ready
    setPendingCode(track.code);
    console.log('SupabaseFileManager - stored code in nano store:', track.code.substring(0, 50) + '...');

    // Preload samples from track code
    const preloadSamples = async () => {
      try {
        const webaudioModule = await import('@strudel/webaudio');
        if (webaudioModule.preloadTrackSamples && track.code) {
          await webaudioModule.preloadTrackSamples(track.code, track.name || track.id);
        }
      } catch (error) {
        console.debug('Sample preloading not available:', error);
      }
    };

    preloadSamples();

    // CRITICAL: Only call handleUpdate if the code is actually different
    // This prevents unnecessary re-renders that destroy the CodeMirror editor
    const currentCode = context.editorRef?.current?.code || context.activeCode || '';
    if (currentCode !== track.code) {
      console.log('SupabaseFileManager - calling handleUpdate because code changed');
      context.handleUpdate({ id: track.id, code: track.code }, false);
    } else {
      console.log('SupabaseFileManager - skipping handleUpdate, code is the same');
    }

    // DIRECT APPROACH: Set code directly in editor without triggering re-renders
    const setCodeDirectly = () => {
      console.log('SupabaseFileManager - setting code directly in editor via setCode');

      // Method 1: Use editorRef if available
      if (context.editorRef?.current?.setCode) {
        context.editorRef.current.setCode(track.code);
        console.log('SupabaseFileManager - setting code property directly');
        context.editorRef.current.code = track.code;
        return true;
      }

      // Method 2: Use stored editor instance
      const storedEditor = getEditorInstance();
      if (storedEditor?.setCode) {
        console.log('SupabaseFileManager - found code element, attempting direct update');
        storedEditor.setCode(track.code);
        return true;
      }

      return false;
    };

    // Try to set code directly, with retries if editor isn't ready yet
    if (!setCodeDirectly()) {
      setTimeout(() => setCodeDirectly(), 100);
      setTimeout(() => setCodeDirectly(), 500);
    }

    lastSavedCodeRef.current = track.code;
  }, [context]);

  // Handle activePattern changes (URL routing)
  useEffect(() => {
    console.log('SupabaseFileManager - activePattern effect triggered:', {
      isInitialized,
      activePattern,
      user: !!user,
      selectedStepTrack
    });
    
    if (!isInitialized || !activePattern || !user) return;

    // Don't auto-load tracks if we're currently in step selection mode
    if (selectedStepTrack) {
      console.log('SupabaseFileManager - skipping activePattern load due to step selection:', selectedStepTrack);
      return;
    }

    // NEW: activePattern is now a URL path (without /repl/ prefix) or just a track slug
    // Parse to find the actual track
    let targetTrack = null;
    let targetStepIndex: number | null = null;

    // activePattern can be:
    // - "track-slug" (root track)
    // - "folder/track-slug" (track in folder)
    // - "folder/subfolder/track-slug" (track in nested folder)
    // - "track-slug?step=step-name" (track with step)
    
    // Split by ? to separate path from query params
    const [pathPart, queryPart] = activePattern.split('?');
    const segments = pathPart.split('/');
    const trackSlug = segments.pop() || ''; // Last segment is always the track
    const folderPath = segments.length > 0 ? segments.join('/') : null;
    
    const tracksArray = Object.values(tracks);
    targetTrack = findTrackByFolderAndSlug(tracksArray, folderPath, trackSlug);
    
    // Parse step parameter if present
    let stepName: string | null = null;
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      stepName = params.get('step');
    }
    
    // If we have a step name and found the track, find the step index
    if (stepName && targetTrack?.isMultitrack && targetTrack.steps) {
      const stepSlug = trackNameToSlug(stepName);
      targetStepIndex = targetTrack.steps.findIndex(step => 
        trackNameToSlug(step.name) === stepSlug
      );
      
      if (targetStepIndex === -1) {
        console.warn('SupabaseFileManager - step not found:', stepName, 'defaulting to first step');
        targetStepIndex = 0;
      }
    }
    
    console.log('SupabaseFileManager - finding track by slug:', {
      activePattern,
      folderPath,
      trackSlug,
      stepName,
      targetStepIndex,
      foundTrack: targetTrack?.name,
      foundTrackId: targetTrack?.id,
      currentSelectedTrack: selectedTrack,
      currentActiveStep: targetTrack?.activeStep
    });

    // If we found a target track, load it (even if it's the same track, we might need to switch steps)
    if (targetTrack) {
      const needsLoad = selectedTrack !== targetTrack.id || 
                       (targetStepIndex !== null && targetTrack.activeStep !== targetStepIndex);
      
      console.log('SupabaseFileManager - load decision:', {
        needsLoad,
        reason: selectedTrack !== targetTrack.id ? 'different track' : 
                targetStepIndex !== null && targetTrack.activeStep !== targetStepIndex ? 'different step' : 
                'no change needed'
      });
      
      if (needsLoad) {
        console.log('SupabaseFileManager - loading track from URL synchronization:', targetTrack.name, 
                   'needsLoad:', needsLoad, 'reason:', selectedTrack !== targetTrack.id ? 'different track' : 'different step');

        // If there's a step parameter and track is multitrack, load that step
        if (targetStepIndex !== null && targetTrack.isMultitrack && targetTrack.steps && targetTrack.steps[targetStepIndex]) {
          const trackWithStep = {
            ...targetTrack,
            activeStep: targetStepIndex,
            code: targetTrack.steps[targetStepIndex].code
          };
          
          console.log('SupabaseFileManager - updating track state with activeStep:', targetStepIndex);
          
          // Update the track state with the new activeStep
          setTracks(prev => ({
            ...prev,
            [targetTrack.id]: trackWithStep
          }));
          
          setSelectedTrack(targetTrack.id);
          setSelectedStepTrack(targetTrack.id);
          loadTrack(trackWithStep);
          console.log('SupabaseFileManager - loaded step:', targetStepIndex, targetTrack.steps[targetStepIndex].name);
        } else {
          setSelectedTrack(targetTrack.id);
          loadTrack(targetTrack);
        }
      } else {
        console.log('SupabaseFileManager - track already loaded with correct step:', targetTrack.name);
      }
    } else {
      console.log('SupabaseFileManager - no track found for activePattern:', activePattern);
    }
  }, [activePattern, isInitialized, selectedTrack, loadTrack, tracks, user, selectedStepTrack, setSelectedStepTrack, setTracks]);

  const saveSpecificTrack = useCallback(async (trackId: string, showToast: boolean = true) => {
    if (!trackId || !user) {
      console.warn('SupabaseFileManager - saveSpecificTrack: not authenticated or invalid track ID:', trackId);
      return false;
    }

    // STRICT VALIDATION: Ensure we're still on the same track
    if (selectedTrack !== trackId) {
      console.log('SupabaseFileManager - saveSpecificTrack: track changed, skipping autosave for:', trackId);
      return false;
    }

    if (!tracks[trackId]) {
      console.warn('SupabaseFileManager - saveSpecificTrack: track not found:', trackId);
      return false;
    }

    // Get track-specific autosave context
    const autosaveContext = getTrackAutosaveContext(trackId);

    // Prevent concurrent saves for the same track
    if (autosaveContext.isAutosaving) {
      console.log('SupabaseFileManager - saveSpecificTrack: already autosaving track:', trackId);
      return false;
    }

    let currentCode = context.editorRef?.current?.code || context.activeCode || '';
    if (!currentCode.trim()) {
      if (showToast) toastActions.warning(t('files:noCodeToSave'));
      return false;
    }

    // Use track-specific last saved code instead of global reference
    if (currentCode === autosaveContext.lastSavedCode) {
      console.log('SupabaseFileManager - saveSpecificTrack: no changes for track:', trackId);
      return false;
    }

    // STRICT CODE VALIDATION: Ensure code matches what we expect for this track
    const expectedCode = tracks[trackId].code;
    if (autosaveContext.lastSavedCode !== expectedCode && autosaveContext.lastSavedCode !== '') {
      console.error('SupabaseFileManager - saveSpecificTrack: CRITICAL - code mismatch detected!', {
        trackId,
        trackName: tracks[trackId].name,
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
        console.log('SupabaseFileManager - auto-formatting code before save');

        // Dynamically import the auto-format function
        const { autoFormatOnSave } = await import('@strudel/codemirror');
        const formatResult = await autoFormatOnSave(currentCode, settings);

        if (formatResult.success && formatResult.formattedCode) {
          codeToSave = formatResult.formattedCode;

          // Update the editor with formatted code if it's different
          if (codeToSave !== currentCode && context.editorRef?.current?.setCode) {
            context.editorRef.current.setCode(codeToSave);
          }

          console.log('SupabaseFileManager - code auto-formatted successfully');
        } else if (formatResult.error) {
          console.warn('SupabaseFileManager - auto-format failed:', formatResult.error);
          // Continue with original code if formatting fails
          if (showToast) {
            toastActions.warning(`Auto-format failed: ${formatResult.error}`);
          }
        }
      }
    } catch (error) {
      console.error('SupabaseFileManager - auto-format error:', error);
      // Continue with original code if formatting fails
      if (showToast) {
        toastActions.warning('Auto-format failed, saving original code');
      }
    }

    console.log('SupabaseFileManager - saving to Supabase:', tracks[trackId]?.name, 'ID:', trackId);

    try {
      // Update in Supabase directly
      const { data, error } = await db.tracks.update(trackId, {
        code: codeToSave,
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

      console.log('SupabaseFileManager - saveSpecificTrack: SUCCESS for track:', trackId);
      return true;
    } catch (error) {
      console.error('Error saving track to Supabase:', error);
      if (showToast) {
        toastActions.error(t('files:errors.saveFailed'));
      }
      setSyncError(error instanceof Error ? error.message : 'Save failed');
      return false;
    } finally {
      // Always clear the autosaving flag
      autosaveContext.isAutosaving = false;
    }
  }, [context, t, selectedTrack, tracks, user, getTrackAutosaveContext]);

  const saveCurrentTrack = useCallback(async (showToast: boolean = true) => {
    if (!selectedTrack || !user) return false;
    return await saveSpecificTrack(selectedTrack, showToast);
  }, [selectedTrack, user, saveSpecificTrack]);

  /**
   * Schedule autosave for a specific track with strict isolation
   */
  const scheduleTrackAutosave = useCallback((trackId: string) => {
    if (!isAutosaveEnabled || !trackId || !user) return;

    const autosaveContext = getTrackAutosaveContext(trackId);

    // Clear any existing timer for this track
    clearTrackAutosaveTimer(trackId);

    // Don't schedule if already autosaving
    if (autosaveContext.isAutosaving) {
      console.log('SupabaseFileManager - scheduleTrackAutosave: already autosaving, skipping:', trackId);
      return;
    }

    autosaveContext.timer = setTimeout(async () => {
      // Double-check that we're still on the same track when timer fires (URL-based)
      const currentTrackIdFromURL = getCurrentTrackIdFromURL(tracks, folders);
      
      if (!currentTrackIdFromURL) {
        console.warn('SupabaseFileManager - autosave timer: Could not determine track from URL, skipping save');
        return;
      }
      
      if (currentTrackIdFromURL === trackId) {
        console.log('SupabaseFileManager - autosave timer fired for track (URL-based):', trackId);
        await saveSpecificTrack(trackId, false); // Don't show toast for autosave
      } else {
        console.log('SupabaseFileManager - autosave timer fired but track changed (URL-based):', {
          scheduled: trackId,
          currentFromURL: currentTrackIdFromURL
        });
      }
    }, autosaveInterval);
  }, [isAutosaveEnabled, user, autosaveInterval, selectedTrack, folders, getTrackAutosaveContext, clearTrackAutosaveTimer, saveSpecificTrack]);

  /**
   * Handle code changes to trigger autosave scheduling - URL-based
   */
  const handleCodeChange = useCallback(() => {
    const currentTrackId = getCurrentTrackIdFromURL(tracks, folders);
    if (currentTrackId) {
      scheduleTrackAutosave(currentTrackId);
    } else {
      console.warn('SupabaseFileManager - handleCodeChange: Could not determine track from URL, skipping autosave');
    }
  }, [scheduleTrackAutosave, tracks, folders]);

  // Set up save event listener for Cmd+S functionality
  useEffect(() => {
    if (!user) return;

    const handleSave = (event: CustomEvent) => {
      console.log('SupabaseFileManager - received save event:', event.detail);
      saveCurrentTrack(true); // Show toast on manual save
    };

    document.addEventListener('strudel-save', handleSave as EventListener);

    return () => {
      document.removeEventListener('strudel-save', handleSave as EventListener);
    };
  }, [user, saveCurrentTrack]);

  const createTrack = useCallback(async (name: string, code: string = '', folderOrEvent?: string | React.SyntheticEvent, isMultitrack?: boolean, steps?: any[], activeStep?: number) => {
    // Handle case where folder parameter might be a SyntheticEvent (from React event handlers)
    const folder = typeof folderOrEvent === 'string' ? folderOrEvent : undefined;

    if (!user) {
      console.error('SupabaseFileManager - createTrack: not authenticated');
      toastActions.error(t('auth:errors.notAuthenticated'));
      return null;
    }

    // Ensure valid session before creating track
    const isValidSession = await checkAuth();
    if (!isValidSession) {
      console.error('SupabaseFileManager - createTrack: unable to establish valid session');
      toastActions.error('Unable to verify authentication. Please try again.');
      return null;
    }

    console.log('SupabaseFileManager - createTrack called:', { name, folder, isMultitrack, stepsCount: steps?.length });

    try {
      const trackData = {
        name,
        code,
        folder: folder || null, // Convert empty string/undefined to null for root folder
        isMultitrack,
        steps,
        activeStep,
      };

      console.log('SupabaseFileManager - creating track directly in Supabase:', trackData);

      // Call the API endpoint directly instead of using db.tracks.create
      const response = await fetch('/api/tracks/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(trackData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('SupabaseFileManager - API error:', errorData);

        // Handle specific error cases
        if (response.status === 401) {
          toastActions.error('Authentication failed. Please try refreshing the page.');
          return null;
        }

        throw new Error(errorData.error || errorData.message || 'Failed to create track');
      }

      const result = await response.json();

      if (result.success && result.track) {
        console.log('✅ Track created successfully:', result.track.id, result.track.name);
        setTracks(prev => ({ ...prev, [result.track.id]: result.track }));
        toastActions.success(t('files:trackCreated'));
        return result.track;
      }

      return null;
    } catch (error) {
      console.error('SupabaseFileManager - Error creating track:', error);
      toastActions.error(t('files:errors.createTrackFailed') + ': ' + (error instanceof Error ? error.message : 'Unknown error'));
      setSyncError(error instanceof Error ? error.message : 'Create failed');
      return null;
    }
  }, [user, checkAuth, t]);

  // Listen for new user pattern creation and automatically save to Supabase
  useEffect(() => {
    if (!user) return;

    const handleUserPatternCreated = async (event: CustomEvent) => {
      const { patternId, patternData } = event.detail;
      console.log('SupabaseFileManager - new user pattern created:', patternId, patternData);

      // Check if this pattern already exists in Supabase
      if (tracks[patternId]) {
        console.log('SupabaseFileManager - pattern already exists in Supabase, skipping');
        return;
      }

      // Create the track in Supabase with the user pattern data
      try {
        const newTrack = await createTrack(
          patternData.name || `Track ${patternId}`,
          patternData.code || '',
          undefined, // folder
          false, // isMultitrack
          undefined, // steps
          undefined // activeStep
        );

        if (newTrack) {
          console.log('SupabaseFileManager - successfully saved new user pattern to Supabase:', newTrack.id);

          // Update the active pattern to use the Supabase track URL instead of the user pattern ID
          if (getActivePattern() === patternId) {
            const trackUrl = generateTrackUrlPath(newTrack.name, newTrack.folder, folders);
            setActivePattern(trackUrl);
          }
        }
      } catch (error) {
        console.error('SupabaseFileManager - failed to save new user pattern to Supabase:', error);
      }
    };

    document.addEventListener('strudel-user-pattern-created', handleUserPatternCreated as EventListener);

    return () => {
      document.removeEventListener('strudel-user-pattern-created', handleUserPatternCreated as EventListener);
    };
  }, [user, tracks, createTrack]);

  const createFolder = useCallback(async (name: string, path: string, parent?: string) => {
    console.log('SupabaseFileManager - createFolder called:', { name, path, parent });

    if (!user) {
      console.error('SupabaseFileManager - createFolder: not authenticated');
      toastActions.error(t('auth:errors.notAuthenticated'));
      return null;
    }

    try {
      // Ensure valid session before creating folder
      const isValidSession = await checkAuth();
      if (!isValidSession) {
        console.error('SupabaseFileManager - createFolder: unable to establish valid session');
        toastActions.error('Unable to verify authentication. Please try again.');
        return null;
      }

      // Get the current user from the auth context (checkAuth already set it)
      if (!user?.id) {
        console.error('SupabaseFileManager - createFolder: no user available after session validation');
        toastActions.error('Authentication error: No user found. Please try refreshing the page.');
        return null;
      }

      // Validate input parameters
      if (!name || typeof name !== 'string' || !name.trim()) {
        console.error('SupabaseFileManager - createFolder: invalid name parameter:', name);
        toastActions.error('Folder name is required');
        return null;
      }

      if (!path || typeof path !== 'string' || !path.trim()) {
        console.error('SupabaseFileManager - createFolder: invalid path parameter:', path);
        toastActions.error('Folder path is required');
        return null;
      }

      const newFolder = {
        id: nanoid(), // Use nanoid for proper UUID generation
        name: name.trim(),
        path: path.trim(),
        parent: parent || null,
        created: new Date().toISOString(),
        user_id: user.id,
      };

      console.log('SupabaseFileManager - creating folder via API:', newFolder);

      // Call the API endpoint instead of direct database access
      const response = await fetch('/api/folders/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(newFolder),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('SupabaseFileManager - API error:', errorData);

        // Handle specific error cases
        if (response.status === 401) {
          toastActions.error('Authentication failed. Please try refreshing the page.');
          return null;
        }

        throw new Error(errorData.error || errorData.message || 'Failed to create folder');
      }

      const result = await response.json();

      if (result.data) {
        // Update local state
        setFolders(prev => ({ ...prev, [result.data.id]: result.data }));
        toastActions.success(t('files:success.folderCreated', { name: result.data.name }) || `Folder "${result.data.name}" created successfully`);
        console.log('SupabaseFileManager - folder created successfully:', result.data);
        return result.data;
      }

      return null;
    } catch (error) {
      const isNetworkError = error instanceof Error && error.message.includes('fetch');
      const toastMsg = isNetworkError ? 'Network error. Please check your connection.' : (error instanceof Error ? error.message : 'Failed to create folder');
      handleApiError(error, 'Error creating folder', setSyncError, toastMsg);
      return null;
    }
  }, [user, t, checkAuth, setFolders]);

  const updateFolder = useCallback(async (folderId: string, updates: { parent?: string | null; name?: string; path?: string }) => {
    console.log('SupabaseFileManager - updateFolder called:', { folderId, updates });

    if (!user) {
      console.error('SupabaseFileManager - updateFolder: not authenticated');
      toastActions.error('Not authenticated. Please refresh the page.');
      return null;
    }

    try {
      // Ensure valid session before updating folder
      const isValidSession = await checkAuth();
      if (!isValidSession) {
        console.error('SupabaseFileManager - updateFolder: unable to establish valid session');
        toastActions.error('Unable to verify authentication. Please try again.');
        return null;
      }

      console.log('SupabaseFileManager - updating folder via API:', folderId, updates);

      // Call the API endpoint
      const response = await fetch('/api/folders/update', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          folderId,
          updates
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('SupabaseFileManager - API error:', errorData);

        // Handle specific error cases
        if (response.status === 401) {
          toastActions.error('Authentication failed. Please try refreshing the page.');
          return null;
        }

        if (response.status === 404) {
          toastActions.error('Folder not found. It may have been deleted by another session.');
          return null;
        }

        throw new Error(errorData.error || 'Failed to update folder');
      }

      const result = await response.json();

      if (result.success && result.folder) {
        // Update local state
        setFolders(prev => ({
          ...prev,
          [folderId]: {
            ...prev[folderId],
            ...result.folder
          }
        }));

        console.log('SupabaseFileManager - folder updated successfully:', result.folder);
        return result.folder;
      }

      return null;
    } catch (error) {
      const isNetworkError = error instanceof Error && error.message.includes('fetch');
      const toastMsg = isNetworkError ? 'Network error. Please check your connection.' : (error instanceof Error ? error.message : 'Failed to update folder');
      handleApiError(error, 'Error updating folder', setSyncError, toastMsg);
      return null;
    }
  }, [user, t, checkAuth, setFolders]);

  const deleteTrack = useCallback(async (trackId: string) => {
    if (!user) {
      toastActions.error(t('auth:errors.notAuthenticated'));
      return false;
    }

    try {
      // Ensure valid session before deleting
      const validSession = await checkAuth();
      if (!validSession) {
        console.error('SupabaseFileManager - deleteTrack: unable to establish valid session');
        toastActions.error(t('auth:errors.sessionExpired'));
        return false;
      }

      console.log('SupabaseFileManager - deleting track directly via Supabase:', trackId);

      // Delete track directly from Supabase
      const { error } = await db.tracks.delete(trackId);

      if (error) {
        console.error('SupabaseFileManager - Error deleting track:', error);
        throw error;
      }

      // Update local state
      setTracks(prev => {
        const newTracks = { ...prev };
        delete newTracks[trackId];
        return newTracks;
      });

      // CRITICAL: Also update the global tracks store so ReplEditor can see the change
      tracksActions.removeTrack(trackId);
      console.log('SupabaseFileManager - global store updated, track removed:', trackId);

      if (selectedTrack === trackId) {
        setSelectedTrack(null);
      }

      toastActions.success(t('files:trackDeleted'));
      return true;
    } catch (error) {
      handleApiError(error, 'Error deleting track', setSyncError, t('files:errors.deleteFailed'));
      return false;
    }
  }, [user, selectedTrack, t, checkAuth]);



  const deleteAllTracks = useCallback(async () => {
    if (!user) {
      toastActions.error(t('auth:errors.notAuthenticated'));
      return false;
    }

    const trackIds = Object.keys(tracks);
    const folderIds = Object.keys(folders);

    if (trackIds.length === 0 && folderIds.length === 0) return true;

    try {
      // Ensure valid session before deleting
      const validSession = await checkAuth();
      if (!validSession) {
        console.error('SupabaseFileManager - deleteAllTracks: unable to establish valid session');
        toastActions.error(t('auth:errors.sessionExpired'));
        return false;
      }

      console.log('SupabaseFileManager - deleting all tracks and folders directly via Supabase');

      // Delete all tracks directly from Supabase
      if (trackIds.length > 0) {
        const { error: tracksError } = await db.tracks.deleteAll();

        if (tracksError) {
          console.error('Error deleting tracks:', tracksError);
          throw tracksError;
        }
      }

      // Delete all folders directly from Supabase
      if (folderIds.length > 0) {
        const { error: foldersError } = await db.folders.deleteAll();

        if (foldersError) {
          console.error('Error deleting folders:', foldersError);
          throw foldersError;
        }
      }

      // CRITICAL: Refresh data from Supabase to ensure UI is in sync
      // Do this BEFORE clearing local state to prevent flickering
      console.log('SupabaseFileManager - Refreshing data from Supabase after delete all');
      await loadDataFromSupabase();

      // Update success message to reflect both tracks and folders
      const message = trackIds.length > 0 && folderIds.length > 0
        ? t('files:allTracksAndFoldersDeleted')
        : trackIds.length > 0
          ? t('files:allTracksDeleted')
          : t('files:allFoldersDeleted');

      toastActions.success(message);

      // Clear editor after successful deletion and refresh
      if (context.editorRef?.current?.setCode) {
        context.editorRef.current.setCode('');
      }

      // Dispatch event for other components
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('strudel-all-tracks-deleted'));
      }, 100);

      return true;
    } catch (error) {
      handleApiError(error, 'Error deleting all tracks and folders', setSyncError, t('files:errors.deleteFailed'));
      return false;
    }
  }, [user, tracks, folders, setTracks, setFolders, setSelectedTrack, context, t, checkAuth]);

  // Refresh data from Supabase - useful after operations that modify data
  const refreshFromSupabase = useCallback(async () => {
    if (!user) return;

    console.log('SupabaseFileManager - Manual refresh from Supabase requested');
    setHasLoadedData(false); // Reset flag to allow reload
    await loadDataFromSupabase();
  }, [user, loadDataFromSupabase]);

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
    if (!isAutosaveEnabled) return;

    const checkCodeChanges = () => {
      const currentTrackId = getCurrentTrackIdFromURL(tracks, folders);
      if (!currentTrackId) {
        console.warn('SupabaseFileManager - checkCodeChanges: Could not determine track from URL, skipping');
        return;
      }

      const currentCode = context.editorRef?.current?.code || context.activeCode || '';
      const autosaveContext = getTrackAutosaveContext(currentTrackId);

      if (currentCode !== autosaveContext.lastSavedCode && currentCode.trim()) {
        scheduleTrackAutosave(currentTrackId);
      }
    };

    const interval = setInterval(checkCodeChanges, 2000); // Check every 2 seconds
    return () => clearInterval(interval);
  }, [isAutosaveEnabled, context, folders, getTrackAutosaveContext, scheduleTrackAutosave]);

  // If not authenticated, return minimal state with no-op functions
  if (!user) {
    return {
      ...UNAUTHENTICATED_STATIC_STATE,
      activePattern,
      isAutosaveEnabled,
      autosaveInterval,
      t,
    };
  }

  // Return all state and functions needed by the UI
  // In read-only mode, replace mutating functions with no-ops
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

    // Setters (no-ops in read-only mode to prevent state changes that trigger saves)
    setTracks: readOnly ? noop : setTracks,
    setFolders: readOnly ? noop : setFolders,
    setSelectedTrack,
    setIsCreating: readOnly ? noop : setIsCreating,
    setIsCreatingFolder: readOnly ? noop : setIsCreatingFolder,
    setNewTrackName: readOnly ? noop : setNewTrackName,
    setNewFolderName: readOnly ? noop : setNewFolderName,
    setNewItemParentPath: readOnly ? noop : setNewItemParentPath,
    setSaveStatus,
    setRenamingTrack: readOnly ? noop : setRenamingTrack,
    setRenamingFolder: readOnly ? noop : setRenamingFolder,
    setRenamingStep: readOnly ? noop : setRenamingStep,
    setRenameValue: readOnly ? noop : setRenameValue,
    setShowDeleteModal: readOnly ? noop : setShowDeleteModal,
    setTrackToDelete: readOnly ? noop : setTrackToDelete,
    setShowDeleteFolderModal: readOnly ? noop : setShowDeleteFolderModal,
    setFolderToDelete: readOnly ? noop : setFolderToDelete,
    setFolderContents: readOnly ? noop : setFolderContents,
    setShowDeleteAllModal: readOnly ? noop : setShowDeleteAllModal,
    setIsCreatingStep: readOnly ? noop : setIsCreatingStep,
    setNewStepName: readOnly ? noop : setNewStepName,
    setSelectedStepTrack,
    setIsDragOver: readOnly ? noop : setIsDragOver,

    // Functions (no-ops in read-only mode to prevent API calls)
    loadTrack,
    saveCurrentTrack: readOnly ? asyncNoopFalse : saveCurrentTrack,
    saveSpecificTrack: readOnly ? asyncNoopFalse : saveSpecificTrack,
    createTrack: readOnly ? asyncNoopNull : createTrack,
    createFolder: readOnly ? asyncNoopNull : createFolder,
    updateFolder: readOnly ? asyncNoopVoid : updateFolder,
    deleteTrack: readOnly ? asyncNoopFalse : deleteTrack,
    deleteAllTracks: readOnly ? asyncNoopFalse : deleteAllTracks,
    loadDataFromSupabase: readOnly ? asyncNoopVoid : loadDataFromSupabase,
    refreshFromSupabase: readOnly ? asyncNoopVoid : refreshFromSupabase,

    // Strict Autosave Functions (disabled in read-only mode)
    scheduleTrackAutosave: readOnly ? noop : scheduleTrackAutosave,
    handleCodeChange: readOnly ? noop : handleCodeChange,
    getTrackAutosaveContext,
    clearTrackAutosaveTimer,
    cleanupTrackAutosaveContext,

    // Refs
    autosaveTimerRef,
    autosaveTrackIdRef,
    lastSavedCodeRef,
    isDeletingTrackRef,
    isDeletingFolderRef,

    // Settings (disable autosave in read-only mode)
    isAutosaveEnabled: readOnly ? false : isAutosaveEnabled,
    autosaveInterval,

    // Translation
    t,
  };
}
