import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useSettings} from '@src/settings';
import {getActivePattern, setActivePattern, useActivePattern} from '@src/user_pattern_utils';
import {toastActions} from '@src/stores/toastStore';
import {useTranslation} from '@src/i18n';
import {useAuth} from '@src/hooks/useAuth';
import {db, type Folder, migration, type Track} from '@src/lib/secureApi.ts';
import {getEditorInstance, setPendingCode} from '@src/stores/editorStore.ts';
import {tracksStore, tracksActions} from '@src/stores/tracksStore.ts';
import {nanoid} from 'nanoid';

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
  showMigrationModal: false,
  setShowMigrationModal: noop,
  handleMigrationComplete: noop,
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

export function useSupabaseFileManager(context: ReplContext, ssrData?: { tracks: any[]; folders: any[]; } | null) {
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
  const { t } = useTranslation(['files', 'common', 'tabs', 'auth']);

  // Load data from Supabase when user is authenticated
  useEffect(() => {
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
  }, [user, loading, isAuthenticated, ssrData]); // Add isAuthenticated to dependencies

  // Check for migration when user signs in
  useEffect(() => {
    if (user && !hasMigrated) {
      checkMigrationStatus();
    }
  }, [user, hasMigrated]);

  const checkMigrationStatus = async () => {
    try {
      const hasMigrated = await migration.hasMigrated();

      setHasMigrated(hasMigrated);

      // Show migration modal if user hasn't migrated and has local data
      if (!hasMigrated) {
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
    if (!user) return;

    setIsLoading(true);
    setSyncError(null);

    try {
      console.log('SupabaseFileManager - loading tracks directly from Supabase');

      // If we have a user, try direct load first (faster)
      if (user) {
        console.log('SupabaseFileManager - User exists, attempting direct data load...');
        
        try {
          const { data, error } = await db.tracks.getAll();

          if (!error && data) {
            console.log('SupabaseFileManager - Direct data load successful');

            const tracksObj = arrayToRecord(data.tracks || []);
            const foldersObj = arrayToRecord(data.folders || []);

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

      // Load tracks and folders from Supabase in one call
      const { data, error } = await db.tracks.getAll();

      if (error) {
        console.error('SupabaseFileManager - Database error:', error);

        // If it's a table not found error, run automatic migration
        if (error.code === 'PGRST205') {
          console.log('🔧 Tables not found, checking migration status...');
          setSyncError(t('auth:errors.databaseSetupRequired'));

          try {
            const migrationResponse = await fetch('/api/database/migrate', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              credentials: 'include',
            });

            const migrationResult = await migrationResponse.json();

            if (migrationResult.success) {
              console.log('✅ Database tables already exist!');
              console.log('📊 Tables found:', migrationResult.tablesCreated);

              // Clear error and retry loading data
              setSyncError(null);

              // Retry loading data
              setTimeout(() => {
                loadDataFromSupabase();
              }, 1000);

              return; // Exit early, retry will happen
            } else {
              // Tables don't exist, show clear instructions
              console.error('❌ Database setup required');
              console.error('📋 Instructions:', migrationResult.instructions);

              setSyncError(t('auth:errors.databaseSetupInstructions'));

              // Show detailed instructions in console
              if (migrationResult.instructions) {
                console.log('🔧 SETUP INSTRUCTIONS:');
                migrationResult.instructions.steps.forEach(step => {
                  console.log(step);
                });
                console.log(`📄 Schema file: ${migrationResult.instructions.schemaLocation}`);
              }

              return; // Don't throw, just show instructions
            }
          } catch (migrationError) {
            console.error('❌ Migration check failed:', migrationError);
            setSyncError(t('auth:errors.databaseSetupInstructions'));
            return;
          }
        }

        throw error;
      }

      // The tracks endpoint now returns both tracks and folders
      const tracksObj = arrayToRecord(data?.tracks || []);
      const foldersObj = arrayToRecord(data?.folders || []);

      setTracks(tracksObj);
      setFolders(foldersObj);
      setIsInitialized(true);
      setHasLoadedData(true);
      syncToGlobalStore(tracksObj, foldersObj);

      console.log('SupabaseFileManager - Updated both local state and global tracksStore from loadDataFromSupabase');
    } catch (error) {
      console.error('SupabaseFileManager - Error loading data:', error);

      // If it's a session timeout, try direct load (cookies might still be valid)
      if (error instanceof Error && error.message === 'Session validation timeout') {
        console.log('SupabaseFileManager - Session timeout, attempting direct data load...');

        try {
          const { data, error: directError } = await db.tracks.getAll();

          if (!directError && data) {
            const tracksObj = arrayToRecord(data.tracks || []);
            const foldersObj = arrayToRecord(data.folders || []);

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

  const loadTrack = useCallback((track: Track) => {
    console.log('SupabaseFileManager - loadTrack called for:', track.name, track.id);
    setSelectedTrack(track.id);
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
    if (!isInitialized || !activePattern || !user) return;

    // Don't auto-load tracks if we're currently in step selection mode
    if (selectedStepTrack) {
      console.log('SupabaseFileManager - skipping activePattern load due to step selection:', selectedStepTrack);
      return;
    }

    // If the activePattern exists in tracks and is different from selected track, load it
    if (tracks[activePattern] && selectedTrack !== activePattern) {
      setSelectedTrack(activePattern);
      loadTrack(tracks[activePattern]);
    }
  }, [activePattern, isInitialized, selectedTrack, loadTrack, tracks, user, selectedStepTrack]);

  const saveSpecificTrack = useCallback(async (trackId: string, showToast: boolean = true) => {
    if (!trackId || !user) {
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

      lastSavedCodeRef.current = codeToSave;

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
  }, [context, t, selectedTrack, tracks, user]);

  const saveCurrentTrack = useCallback(async (showToast: boolean = true) => {
    if (!selectedTrack || !user) return false;
    return await saveSpecificTrack(selectedTrack, showToast);
  }, [selectedTrack, user, saveSpecificTrack]);

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

          // Update the active pattern to use the Supabase track ID instead of the user pattern ID
          if (getActivePattern() === patternId) {
            setActivePattern(newTrack.id);
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

  const handleMigrationComplete = () => {
    setShowMigrationModal(false);
    setHasMigrated(true);
    loadDataFromSupabase(); // Reload data after migration
  };

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
    updateFolder,
    deleteTrack,
    deleteAllTracks,
    loadDataFromSupabase,
    refreshFromSupabase,

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
