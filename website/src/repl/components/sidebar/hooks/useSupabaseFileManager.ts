import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from '@src/settings';
import { getActivePattern, setActivePattern, useActivePattern } from '@src/user_pattern_utils';
import { toastActions } from '@src/stores/toastStore';
import { useTranslation } from '@src/i18n';
import { useAuth } from '@src/hooks/useAuth';
import { ApiError, db, type Folder, type Track, secureApi } from '@src/lib/secureApi.ts';
import { trackVersions, VersionConflictError } from '../../../trackVersion';
import {
  activeStepIndex,
  consistentNewTrack,
  hasSteps,
  openingTrack,
  reconcileMultitrack,
  saveFieldsFor,
  stepsWithText,
} from '@src/lib/multitrack';
import { useTrackConflict } from '../../../hooks/useTrackConflict';
import type { TrackConflictController, TrackDraft } from '../../../trackConflict';
import { getEditorInstance, setPendingCode } from '@src/stores/editorStore.ts';
import { tracksStore, tracksActions } from '@src/stores/tracksStore.ts';
import { nanoid } from 'nanoid';
import { TreeDataTransformer } from '@src/lib/TreeDataTransformer';
import { generateUniqueTrackName } from '@src/lib/trackValidation';
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
const getCurrentTrackIdFromURL = (
  tracksMap: Record<string, Track>,
  foldersMap: Record<string, Folder>,
): string | null => {
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

  // track.folder is a folder id or a folder path; the URL carries the folder slug
  const track = findTrackByFolderAndSlug(tracks, urlFolderPath, trackSlug, Object.values(foldersMap));

  // Only log if track not found and we have tracks loaded (to help debug issues)
  if (!track && tracks.length > 0) {
    console.warn('getCurrentTrackIdFromURL - track not found for URL:', {
      trackSlug,
      urlFolderPath,
      availableTracks: tracks.length,
    });
  }

  return track?.id || null;
};

// Helper: Convert array to record keyed by id
const EDITOR_LOADED_CHECK_MS = 100;

const arrayToRecord = <T extends { id: string }>(items: T[]): Record<string, T> =>
  Object.fromEntries(items.map((item) => [item.id, item]));

// Helper: Sync local state to global tracksStore
const syncToGlobalStore = (tracksObj: Record<string, Track>, foldersObj: Record<string, Folder>) => {
  tracksActions.clear();
  Object.values(tracksObj).forEach((track) => tracksActions.addTrack(track));
  Object.values(foldersObj).forEach((folder) => tracksActions.addFolder(folder));
  tracksStore.set({
    ...tracksStore.get(),
    isInitialized: true,
    isLoading: false,
    error: null,
  });
};

// Helper: Centralized error handling
const handleApiError = (
  error: unknown,
  context: string,
  setSyncError: (err: string | null) => void,
  toastMessage?: string,
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
  setEditorTrackId?: (id: string | null | undefined) => void;
  replaceTrackId?: (oldId: string, newId: string) => void;
  trackRouter?: any;
}

export function useSupabaseFileManager(
  context: ReplContext,
  ssrData?: { tracks: any[]; folders: any[] } | null,
  readOnly: boolean = false,
) {
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
  const [folderContents, setFolderContents] = useState<{ subfolders: string[]; tracks: string[] }>({
    subfolders: [],
    tracks: [],
  });
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
  const trackAutosaveContextsRef = useRef<
    Map<
      string,
      {
        trackId: string;
        lastSavedCode: string;
        lastSavedTimestamp: number;
        isAutosaving: boolean;
        timer: NodeJS.Timeout | null;
      }
    >
  >(new Map());

  // Spec 018: set below, once the functions it needs exist. saveSpecificTrack reads it at call time.
  const conflictRef = useRef<TrackConflictController | null>(null);
  // What's in the editor. Never `activeCode`: that's the last evaluated text, so when the editor is
  // empty it would save old text over newer.
  const editorText = () => context.editorRef?.current?.code ?? '';

  // The latest state for timers, in-flight saves and page exits, whose closures may be old. Updated on
  // render, and straight away by the step operations, whose next read can't wait for one.
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const selectedTrackRef = useRef(selectedTrack);
  selectedTrackRef.current = selectedTrack;
  // The open track, once its text is in the editor. Conflict checks wait for this: what they load
  // into the editor must not be overwritten by the page's own opening of the track.
  const [trackInEditor, setTrackInEditor] = useState<string | null>(null);
  // Step changes the server hasn't confirmed: the next save carries them, whatever the editor holds.
  const unsavedStepChangesRef = useRef<Set<string>>(new Set());
  // Counts them, so a save that was built before the latest one can't mark that one as saved.
  const stepChangeCountRef = useRef<Map<string, number>>(new Map());
  // The latest save started by a page exit, for a sign-out that has to wait for it.
  const unloadSaveRef = useRef<Promise<void>>(Promise.resolve());
  const leavingRef = useRef(false);
  const unsavedEditForRef = useRef<() => { trackId: string; track: Track; text: string } | null>(() => null);

  // Hooks
  const { isAutosaveEnabled, autosaveInterval } = useSettings();
  const activePattern = useActivePattern();
  const { t } = useTranslation(['files', 'common', 'tabs', 'auth']);

  /**
   * Every load comes through here: the baseline takes the rows as the server has them, and local state
   * takes them reconciled (lib/multitrack.ts), with no write. The name is stored with the step if it's
   * ever saved, so it must not be a raw key when the locale hasn't loaded yet.
   */
  const ingestLoaded = (rows: Track[]): Record<string, Track> => {
    trackVersions.seed(rows);
    const recoveredName = t('files:recoveredStepName', { defaultValue: 'Recovered edits' });
    const page = ssrData as { targetTrackId?: string | null; targetStepName?: string | null } | null | undefined;
    return Object.fromEntries(
      rows.map((track) => [
        track.id,
        (track.id === page?.targetTrackId
          ? openingTrack(track as never, page?.targetStepName, recoveredName)
          : reconcileMultitrack(track as never, recoveredName)) as unknown as Track,
      ]),
    );
  };

  // Load data from Supabase when user is authenticated
  useEffect(() => {
    // In read-only mode (admin viewing another user), ONLY use SSR data
    if (readOnly) {
      if (ssrData) {
        const foldersObj = arrayToRecord(ssrData.folders || []);

        setTracks(ingestLoaded(ssrData.tracks || []));
        setFolders(foldersObj);
        setIsInitialized(true);
        setHasLoadedData(true);
        // Don't sync to global store in read-only mode to avoid overwriting user's own data
      } else {
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
      return;
    }

    // Don't try to load data if we don't have an authenticated user
    if (!isAuthenticated) {
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

      setTracks(ingestLoaded(ssrData.tracks || []));
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
      // If we have a user, try direct load first (faster)
      if (user) {
        try {
          const { tracks: tracksData, folders: foldersData } = await secureApi.getTracks();

          if (tracksData && foldersData) {
            // Convert to expected format
            const tracks = tracksData.map((track) => ({
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
              version: track.version,
            }));

            const folders = foldersData.map((folder) => ({
              id: folder.id,
              name: folder.name,
              path: folder.path,
              parent: folder.parent,
              created: folder.created,
              user_id: folder.user_id,
            }));

            const tracksObj = arrayToRecord(tracks);
            const foldersObj = arrayToRecord(folders);

            setTracks(ingestLoaded(tracks));
            setFolders(foldersObj);
            setIsInitialized(true);
            setHasLoadedData(true);
            syncToGlobalStore(tracksObj, foldersObj);

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
      const validSession = await Promise.race([checkAuth(), timeoutPromise]);

      if (!validSession) {
        throw new Error('Unable to establish valid session');
      }

      // Load tracks and folders from Supabase using the correct API
      const { tracks: tracksData, folders: foldersData } = await secureApi.getTracks();

      if (tracksData && foldersData) {
        // Convert to expected format
        const tracks = tracksData.map((track) => ({
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
          version: track.version,
        }));

        const folders = foldersData.map((folder) => ({
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

        setTracks(ingestLoaded(tracks));
        setFolders(foldersObj);
        setIsInitialized(true);
        setHasLoadedData(true);
        syncToGlobalStore(tracksObj, foldersObj);
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
            const tracks = tracksData.map((track) => ({
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
              version: track.version,
            }));

            const folders = foldersData.map((folder) => ({
              id: folder.id,
              name: folder.name,
              path: folder.path,
              parent: folder.parent,
              created: folder.created,
              user_id: folder.user_id,
            }));

            const tracksObj = arrayToRecord(tracks);
            const foldersObj = arrayToRecord(folders);

            setTracks(ingestLoaded(tracks));
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
        timer: null,
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
  const cleanupTrackAutosaveContext = useCallback(
    (trackId: string) => {
      clearTrackAutosaveTimer(trackId);
      trackAutosaveContextsRef.current.delete(trackId);
    },
    [clearTrackAutosaveTimer],
  );

  const loadTrack = useCallback(
    (track: Track) => {
      // Whatever got us here, a failed save-before-switch included: text not on the server stays in a
      // draft, which is offered on coming back, because the editor is about to replace it.
      const leftBehind = unsavedEditForRef.current();
      if (leftBehind && leftBehind.trackId !== track.id) {
        conflictRef.current?.keepDraft(leftBehind.trackId, leftBehind.text);
      }

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
      const currentCode = editorText();
      if (currentCode !== track.code) {
        console.log('SupabaseFileManager - calling handleUpdate because code changed');
        context.handleUpdate({ id: track.id, code: track.code }, false);
      } else {
        console.log('SupabaseFileManager - skipping handleUpdate, code is the same');
        // Still record which track the editor holds, so Update can tell a switch from an edit.
        context.setEditorTrackId?.(track.id);
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
    },
    [context],
  );

  // Handle activePattern changes (URL routing)
  useEffect(() => {
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
    targetTrack = findTrackByFolderAndSlug(tracksArray, folderPath, trackSlug, Object.values(folders));

    // Parse step parameter if present
    let stepName: string | null = null;
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      stepName = params.get('step');
    }

    // If we have a step name and found the track, find the step index
    if (stepName && targetTrack?.isMultitrack && targetTrack.steps) {
      const stepSlug = trackNameToSlug(stepName);
      targetStepIndex = targetTrack.steps.findIndex((step) => trackNameToSlug(step.name) === stepSlug);

      if (targetStepIndex === -1) {
        console.warn('SupabaseFileManager - step not found:', stepName, 'defaulting to first step');
        targetStepIndex = 0;
      }
    }

    // If we found a target track, load it (even if it's the same track, we might need to switch steps)
    if (targetTrack) {
      const needsLoad =
        selectedTrack !== targetTrack.id || (targetStepIndex !== null && targetTrack.activeStep !== targetStepIndex);

      if (needsLoad) {
        // If there's a step parameter and track is multitrack, load that step
        if (
          targetStepIndex !== null &&
          targetTrack.isMultitrack &&
          targetTrack.steps &&
          targetTrack.steps[targetStepIndex]
        ) {
          const trackWithStep = {
            ...targetTrack,
            activeStep: targetStepIndex,
            code: targetTrack.steps[targetStepIndex].code,
          };

          console.log('SupabaseFileManager - updating track state with activeStep:', targetStepIndex);

          // Update the track state with the new activeStep
          setTracks((prev) => ({
            ...prev,
            [targetTrack.id]: trackWithStep,
          }));

          setSelectedTrack(targetTrack.id);
          setSelectedStepTrack(targetTrack.id);
          loadTrack(trackWithStep);
        } else {
          setSelectedTrack(targetTrack.id);
          loadTrack(targetTrack);
        }
      } else {
        // console.log('SupabaseFileManager - track already loaded with correct step:', targetTrack.name);
      }
    } else {
      console.log('SupabaseFileManager - no track found for activePattern:', activePattern);
    }
  }, [
    activePattern,
    isInitialized,
    selectedTrack,
    loadTrack,
    tracks,
    folders,
    user,
    selectedStepTrack,
    setSelectedStepTrack,
    setTracks,
  ]);

  /** Local state and the autosave baseline, after `text` for `stepIndex` reached the server. */
  const markSaved = useCallback(
    (trackId: string, text: string, stepIndex: number, sent: { stepChange: number; at: number }) => {
      const now = new Date().toISOString();
      const wasActive = (track: Track) => !hasSteps(track as never) || activeStepIndex(track as never) === stepIndex;
      const saved = tracksRef.current[trackId];
      // A step change since this was sent carried newer text in the steps, and its own save follows.
      // This answer is about an older state, so it must not put that text back.
      const overtaken = (stepChangeCountRef.current.get(trackId) ?? 0) !== sent.stepChange;
      const stillOnIt = saved ? wasActive(saved) && !overtaken : false;
      setTracks((prev) => {
        const track = prev[trackId];
        if (!track) return prev;
        if (overtaken) return { ...prev, [trackId]: { ...track, modified: now } as Track };
        return {
          ...prev,
          [trackId]: {
            ...track,
            ...(wasActive(track) ? { code: text } : {}),
            ...(hasSteps(track as never) ? { steps: stepsWithText(track.steps as never, stepIndex, text, now) } : {}),
            modified: now,
          } as Track,
        };
      });
      if (stillOnIt) {
        const autosaveContext = getTrackAutosaveContext(trackId);
        autosaveContext.lastSavedCode = text;
        autosaveContext.lastSavedTimestamp = Date.now();
        if (selectedTrackRef.current === trackId) lastSavedCodeRef.current = text;
      }
      if ((stepChangeCountRef.current.get(trackId) ?? 0) === sent.stepChange) {
        unsavedStepChangesRef.current.delete(trackId);
      }
      conflictRef.current?.textSaved(trackId, text, sent.at, { leaving: leavingRef.current });
    },
    [getTrackAutosaveContext],
  );

  const saveSpecificTrack = useCallback(
    async (trackId: string, showToast: boolean = true) => {
      // In read-only mode (admin viewing another user), never save
      if (readOnly) {
        console.log('SupabaseFileManager - saveSpecificTrack: read-only mode, skipping save');
        return false;
      }

      if (!trackId || !user) {
        console.warn('SupabaseFileManager - saveSpecificTrack: not authenticated or invalid track ID:', trackId);
        return false;
      }

      // STRICT VALIDATION: Ensure we're still on the same track
      if (selectedTrackRef.current !== trackId) {
        console.log('SupabaseFileManager - saveSpecificTrack: track changed, skipping autosave for:', trackId);
        return false;
      }

      const trackAtStart = tracksRef.current[trackId];
      if (!trackAtStart) {
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

      const currentCode = editorText();

      // A conflict is open for this track: nothing is written until the user chooses. This is where
      // autosave, Cmd+S, save-before-switch and emergency save all meet, and the text is kept.
      if (trackVersions.isPaused(trackId)) {
        conflictRef.current?.savePaused(trackId, currentCode);
        return false;
      }

      if (!currentCode.trim()) {
        if (showToast) toastActions.warning(t('files:noCodeToSave'));
        return false;
      }

      // Use track-specific last saved code instead of global reference. A track opened by the page
      // load has none yet: the editor holding its text is no change either, and must write nothing.
      const stepChanges = unsavedStepChangesRef.current.has(trackId);
      const unchanged =
        currentCode === autosaveContext.lastSavedCode ||
        (autosaveContext.lastSavedTimestamp === 0 && currentCode === trackAtStart.code);
      if (unchanged && !stepChanges) {
        console.log('SupabaseFileManager - saveSpecificTrack: no changes for track:', trackId);
        return false;
      }

      // STRICT CODE VALIDATION: Ensure code matches what we expect for this track
      const expectedCode = trackAtStart.code;
      if (autosaveContext.lastSavedCode !== expectedCode && autosaveContext.lastSavedCode !== '') {
        console.error('SupabaseFileManager - saveSpecificTrack: CRITICAL - code mismatch detected!', {
          trackId,
          trackName: trackAtStart.name,
          expectedLength: expectedCode.length,
          contextLength: autosaveContext.lastSavedCode.length,
          currentLength: currentCode.length,
        });
        return false;
      }

      // Mark as autosaving to prevent concurrent operations
      autosaveContext.isAutosaving = true;

      // Which step this text is, before anything below can wait.
      const stepIndex = activeStepIndex(trackAtStart as never);

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

            // Update the editor with formatted code if it's different. Only if it's still this text in
            // this step: formatting waited, and the user may have typed or moved on.
            if (
              codeToSave !== currentCode &&
              selectedTrackRef.current === trackId &&
              activeStepIndex(tracksRef.current[trackId] as never) === stepIndex &&
              context.editorRef?.current?.code === currentCode
            ) {
              context.editorRef.current.setCode?.(codeToSave);
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

      // The step or the track may have changed during that wait. A step switch carried this text
      // itself, so it isn't lost; written now, it would land in the wrong step.
      const liveTrack = tracksRef.current[trackId];
      if (!liveTrack || (hasSteps(liveTrack as never) && activeStepIndex(liveTrack as never) !== stepIndex)) {
        autosaveContext.isAutosaving = false;
        return false;
      }

      console.log('SupabaseFileManager - saving to Supabase:', liveTrack.name, 'ID:', trackId);

      const sent = { stepChange: stepChangeCountRef.current.get(trackId) ?? 0, at: Date.now() };
      try {
        // Update in Supabase directly
        const { data, error } = await db.tracks.update(trackId, {
          ...(saveFieldsFor(liveTrack as never, codeToSave, stepIndex) as Partial<Track>),
          modified: new Date().toISOString(),
        });

        if (error) {
          throw error;
        }

        markSaved(trackId, codeToSave, stepIndex, sent);

        if (showToast) {
          toastActions.success(t('files:trackSaved'));
          setSaveStatus('Saved!');
          setTimeout(() => setSaveStatus(''), 2000);
        }

        console.log('SupabaseFileManager - saveSpecificTrack: SUCCESS for track:', trackId);
        return true;
      } catch (error) {
        // Not a failed save: the notice takes over, with the text that was being written.
        if (error instanceof VersionConflictError) {
          conflictRef.current?.saveRefused(trackId, 'changed', codeToSave, stepIndex);
          return false;
        }
        if (error instanceof ApiError && error.status === 404) {
          conflictRef.current?.saveRefused(trackId, 'deleted', codeToSave, stepIndex);
          return false;
        }
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
    },
    [context, t, user, getTrackAutosaveContext, markSaved, readOnly],
  );

  /**
   * A step operation (switch, add, rename, delete, convert). `change` gets the track with the editor's
   * text already in its active step, and returns the fields that change. Local state moves at once and
   * the server follows through the same queue and version check as every other save. Returns the new
   * track, or null when it's refused: while a conflict is open the track can't change under the choice.
   */
  const applyStepChange = useCallback(
    (trackId: string, change: (track: Track) => Partial<Track>, { quiet = false } = {}): Track | null => {
      const track = tracksRef.current[trackId];
      if (!track) return null;
      if (readOnly) {
        const next = { ...track, ...change(track) };
        tracksRef.current = { ...tracksRef.current, [trackId]: next };
        setTracks(tracksRef.current);
        return next;
      }
      if (trackVersions.isPaused(trackId)) {
        toastActions.warning(t('files:trackConflict.message'));
        return null;
      }

      const isOpen = selectedTrackRef.current === trackId;
      const typed = editorText();
      const withText =
        isOpen && hasSteps(track as never) && typed.trim()
          ? ({ ...track, ...saveFieldsFor(track as never, typed) } as Track)
          : track;
      const next: Track = {
        ...withText,
        ...change(withText),
        ...(quiet ? {} : { modified: new Date().toISOString() }),
      };

      tracksRef.current = { ...tracksRef.current, [trackId]: next };
      setTracks((prev) => (prev[trackId] ? { ...prev, [trackId]: next } : prev));
      if (tracksStore.get().tracks[trackId]) tracksActions.updateTrack(trackId, next);

      if (isOpen) {
        const autosaveContext = getTrackAutosaveContext(trackId);
        // Autosave compares the editor with this, so it follows the track's text.
        autosaveContext.lastSavedCode = next.code;
        autosaveContext.lastSavedTimestamp = Date.now();
      }

      if (quiet) return next;

      const changeCount = (stepChangeCountRef.current.get(trackId) ?? 0) + 1;
      stepChangeCountRef.current.set(trackId, changeCount);
      unsavedStepChangesRef.current.add(trackId);
      const fields: Partial<Track> = {
        code: next.code,
        steps: next.steps,
        activeStep: activeStepIndex(next as never),
        isMultitrack: next.isMultitrack,
        modified: next.modified,
      };
      const sentAt = Date.now();
      void db.tracks.update(trackId, fields).then(({ error }) => {
        if (!error) {
          // Later changes have their own request, which will clear this.
          if (stepChangeCountRef.current.get(trackId) === changeCount) unsavedStepChangesRef.current.delete(trackId);
          conflictRef.current?.textSaved(trackId, next.code, sentAt);
          return;
        }
        if (error instanceof VersionConflictError) {
          conflictRef.current?.saveRefused(trackId, 'changed', next.code);
        } else if (error instanceof ApiError && error.status === 404) {
          conflictRef.current?.saveRefused(trackId, 'deleted', next.code);
        } else {
          // Kept in unsavedStepChangesRef: the next autosave sends it again.
          console.error('SupabaseFileManager - step change not saved:', error);
          toastActions.error(t('files:errors.saveFailed'));
        }
      });
      return next;
    },
    [context, readOnly, t, getTrackAutosaveContext],
  );

  // A page load puts the track in the editor without loadTrack. Page exits only trust a track once the
  // editor has been seen holding its text; before that it may hold anything, and nothing has been typed.
  useEffect(() => {
    if (readOnly || !selectedTrack) return;
    const autosaveContext = getTrackAutosaveContext(selectedTrack);
    if (autosaveContext.lastSavedTimestamp) {
      setTrackInEditor(selectedTrack);
      return;
    }
    const watch = setInterval(() => {
      const code = context.editorRef?.current?.code;
      if (code !== undefined && code === tracksRef.current[selectedTrack]?.code) {
        autosaveContext.lastSavedCode = code;
        autosaveContext.lastSavedTimestamp = Date.now();
        setTrackInEditor(selectedTrack);
        clearInterval(watch);
      }
    }, EDITOR_LOADED_CHECK_MS);
    return () => clearInterval(watch);
  }, [selectedTrack, readOnly, context, getTrackAutosaveContext]);

  /** The editor's text, if it differs from what the server has for the open track. */
  const unsavedEditFor = useCallback(() => {
    const trackId = selectedTrackRef.current;
    const track = trackId ? tracksRef.current[trackId] : undefined;
    if (readOnly || !trackId || !track) return null;
    const autosaveContext = trackAutosaveContextsRef.current.get(trackId);
    // Only a track that has been loaded into the editor: until then the editor holds something else.
    if (!autosaveContext?.lastSavedTimestamp) return null;
    const text = editorText();
    if (!text.trim()) return null;
    const changed = text !== autosaveContext.lastSavedCode && text !== track.code;
    return changed || unsavedStepChangesRef.current.has(trackId) ? { trackId, track, text } : null;
  }, [context, readOnly]);

  unsavedEditForRef.current = unsavedEditFor;

  const hasUnsavedEdits = useCallback(() => unsavedEditFor() !== null, [unsavedEditFor]);

  /**
   * The page is going, or may be. Synchronous up to the request, and no auto-format: that imports code
   * first, which wouldn't finish. A draft goes down before anything is sent, so the text is safe if
   * the request is cancelled, is too large for keepalive, or is refused; the next open clears the draft
   * if the server has the text, and offers it if not. True if the text is safe.
   */
  const saveForUnload = useCallback(
    ({ leaving = false }: { leaving?: boolean } = {}): boolean => {
      const trackId = selectedTrackRef.current;
      if (readOnly || !trackId) return true;
      if (leaving) leavingRef.current = true;
      const text = editorText();
      if (trackVersions.isPaused(trackId)) {
        conflictRef.current?.savePaused(trackId, text);
        return true;
      }
      const edit = unsavedEditFor();
      if (!edit) return true;

      const stepIndex = activeStepIndex(edit.track as never);
      const stored = conflictRef.current?.keepDraft(trackId, text, { inEditor: true, stepIndex }) ?? false;
      const sentInfo = { stepChange: stepChangeCountRef.current.get(trackId) ?? 0, at: Date.now() };
      let settled: () => void = () => {};
      const answered = new Promise<void>((resolve) => (settled = resolve));
      const sent = secureApi.saveOnUnload(
        trackId,
        {
          ...(saveFieldsFor(edit.track as never, text, stepIndex) as Partial<Track>),
          modified: new Date().toISOString(),
        },
        ({ saved, conflict }) => {
          // Only if the page stayed: a hidden tab that came back, or a sign-out waiting for this.
          if (saved) markSaved(trackId, text, stepIndex, sentInfo);
          else if (conflict) conflictRef.current?.saveRefused(trackId, 'changed', text, stepIndex);
          settled();
        },
      );
      if (sent === 'sent') unloadSaveRef.current = answered;
      return stored || sent === 'sent';
    },
    [context, readOnly, unsavedEditFor, markSaved],
  );

  // A page restored from the back/forward cache is staying after all.
  useEffect(() => {
    const staying = () => {
      leavingRef.current = false;
    };
    window.addEventListener('pageshow', staying);
    return () => window.removeEventListener('pageshow', staying);
  }, []);

  const saveCurrentTrack = useCallback(
    async (showToast: boolean = true) => {
      if (!selectedTrack || !user) return false;
      return await saveSpecificTrack(selectedTrack, showToast);
    },
    [selectedTrack, user, saveSpecificTrack],
  );

  /**
   * Schedule autosave for a specific track with strict isolation
   */
  const scheduleTrackAutosave = useCallback(
    (trackId: string) => {
      // Don't schedule autosave in read-only mode
      if (readOnly || !isAutosaveEnabled || !trackId || !user) return;

      const autosaveContext = getTrackAutosaveContext(trackId);

      // One is on its way. The check below runs every 2 s, so restarting it here would mean an interval
      // over 2 s (the default is 30 s) never arrives.
      if (autosaveContext.timer) return;

      // Don't schedule if already autosaving
      if (autosaveContext.isAutosaving) {
        console.log('SupabaseFileManager - scheduleTrackAutosave: already autosaving, skipping:', trackId);
        return;
      }

      autosaveContext.timer = setTimeout(async () => {
        autosaveContext.timer = null;
        // Double-check that we're still on the same track when timer fires (URL-based)
        const currentTrackIdFromURL = getCurrentTrackIdFromURL(tracksRef.current, folders);

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
            currentFromURL: currentTrackIdFromURL,
          });
        }
      }, autosaveInterval);
    },
    [
      isAutosaveEnabled,
      user,
      autosaveInterval,
      selectedTrack,
      folders,
      getTrackAutosaveContext,
      clearTrackAutosaveTimer,
      saveSpecificTrack,
      readOnly,
    ],
  );

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

  const createTrack = useCallback(
    async (
      name: string,
      code: string = '',
      folderOrEvent?: string | React.SyntheticEvent,
      isMultitrack?: boolean,
      steps?: any[],
      activeStep?: number,
    ) => {
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

      console.log('SupabaseFileManager - createTrack called:', {
        name,
        folder,
        isMultitrack,
        stepsCount: steps?.length,
      });

      try {
        // `code` follows the active step, whatever an imported file said.
        const trackData = consistentNewTrack({
          name,
          code,
          folder: folder || null, // Convert empty string/undefined to null for root folder
          isMultitrack,
          steps,
          activeStep,
        });

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
          trackVersions.seed([result.track]);
          setTracks((prev) => ({ ...prev, [result.track.id]: result.track }));
          toastActions.success(t('files:trackCreated'));
          return result.track;
        }

        return null;
      } catch (error) {
        console.error('SupabaseFileManager - Error creating track:', error);
        toastActions.error(
          t('files:errors.createTrackFailed') + ': ' + (error instanceof Error ? error.message : 'Unknown error'),
        );
        setSyncError(error instanceof Error ? error.message : 'Create failed');
        return null;
      }
    },
    [user, checkAuth, t],
  );

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
          undefined, // activeStep
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

  // A second Enter while a create is in flight would pass the server's sibling check too (both
  // requests list the folders before either inserts) and create a same-named twin.
  const folderCreateInFlightRef = useRef(false);

  const createFolder = useCallback(
    async (name: string, path: string, parent?: string) => {
      console.log('SupabaseFileManager - createFolder called:', { name, path, parent });
      if (folderCreateInFlightRef.current) return null;
      folderCreateInFlightRef.current = true;
      try {
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

            // The server checks the name against the folders already under the same parent.
            const nameErrorKeys: Record<string, string> = {
              duplicate: 'files:errors.folderNameTaken',
              empty: 'files:errors.folderNameEmpty',
              slash: 'files:errors.folderNameSlash',
            };
            if (nameErrorKeys[errorData.code]) {
              toastActions.error(t(nameErrorKeys[errorData.code], { name: name.trim() }));
              return null;
            }
            // Parent gone (deleted in another tab) or an id clash: no raw server text in the UI.
            if (response.status === 400 || response.status === 409) {
              toastActions.error(t('files:errors.createFolderFailed'));
              return null;
            }

            throw new Error(errorData.error || errorData.message || 'Failed to create folder');
          }

          const result = await response.json();

          if (result.data) {
            // Update local state
            setFolders((prev) => ({ ...prev, [result.data.id]: result.data }));
            toastActions.success(
              t('files:success.folderCreated', { name: result.data.name }) ||
                `Folder "${result.data.name}" created successfully`,
            );
            console.log('SupabaseFileManager - folder created successfully:', result.data);
            return result.data;
          }

          return null;
        } catch (error) {
          const isNetworkError = error instanceof Error && error.message.includes('fetch');
          const toastMsg = isNetworkError
            ? 'Network error. Please check your connection.'
            : error instanceof Error
              ? error.message
              : 'Failed to create folder';
          handleApiError(error, 'Error creating folder', setSyncError, toastMsg);
          return null;
        }
      } finally {
        folderCreateInFlightRef.current = false;
      }
    },
    [user, t, checkAuth, setFolders],
  );

  const updateFolder = useCallback(
    async (folderId: string, updates: { parent?: string | null; name?: string }) => {
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
            updates,
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

          // A sibling folder (under the new parent, for a move) already has that name or slug.
          if (response.status === 409) {
            // 'track_conflict': a track would collide with one already at the new path.
            toastActions.error(
              errorData.code === 'track_conflict'
                ? t('files:errors.renameFailed')
                : t('files:errors.folderNameTaken', { name: updates.name ?? folders[folderId]?.name ?? '' }),
            );
            return null;
          }

          // The server could not undo every step: its state is unknown, so the caller must
          // reload from the server rather than revert locally.
          if (errorData.code === 'rollback_incomplete') {
            toastActions.error(t('files:errors.renameFailed'));
            return { rollbackIncomplete: true as const };
          }

          throw new Error(errorData.error || 'Failed to update folder');
        }

        const result = await response.json();

        if (result.success && result.folder) {
          // Update local state
          setFolders((prev) => ({
            ...prev,
            [folderId]: {
              ...prev[folderId],
              ...result.folder,
            },
          }));

          console.log('SupabaseFileManager - folder updated successfully:', result.folder);
          return result.folder;
        }

        return null;
      } catch (error) {
        const isNetworkError = error instanceof Error && error.message.includes('fetch');
        const toastMsg = isNetworkError
          ? 'Network error. Please check your connection.'
          : error instanceof Error
            ? error.message
            : 'Failed to update folder';
        handleApiError(error, 'Error updating folder', setSyncError, toastMsg);
        return null;
      }
    },
    [user, t, checkAuth, setFolders, folders],
  );

  const deleteTrack = useCallback(
    async (trackId: string) => {
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

        conflictRef.current?.trackDeletedHere(trackId);

        // Update local state
        setTracks((prev) => {
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
    },
    [user, selectedTrack, t, checkAuth],
  );

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
        trackIds.forEach((id) => conflictRef.current?.trackDeletedHere(id));
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
      const message =
        trackIds.length > 0 && folderIds.length > 0
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
      const currentTrackId = getCurrentTrackIdFromURL(tracksRef.current, folders);
      if (!currentTrackId) {
        console.warn('SupabaseFileManager - checkCodeChanges: Could not determine track from URL, skipping');
        return;
      }

      const currentCode = editorText();
      const autosaveContext = getTrackAutosaveContext(currentTrackId);

      const stepChanges = unsavedStepChangesRef.current.has(currentTrackId);
      if ((currentCode !== autosaveContext.lastSavedCode || stepChanges) && currentCode.trim()) {
        scheduleTrackAutosave(currentTrackId);
      }
    };

    const interval = setInterval(checkCodeChanges, 2000); // Check every 2 seconds
    return () => clearInterval(interval);
  }, [isAutosaveEnabled, context, folders, getTrackAutosaveContext, scheduleTrackAutosave]);

  // Spec 018: another tab or an assistant changed the open track. Read-only views never save, and
  // their reads would find nothing, so they don't watch.
  const knownTrackIds = React.useMemo(
    () => (isInitialized && hasLoadedData ? new Set(Object.keys(tracks)) : null),
    [isInitialized, hasLoadedData, tracks],
  );
  // "Load the new version" keeps the user on their step, if it still exists.
  const localStep = (track: Track, server: { steps: unknown[]; activeStep?: number }) =>
    (track.activeStep ?? 0) < server.steps.length ? track.activeStep : server.activeStep;
  const trackConflict = useTrackConflict({
    userId: user?.id ?? null,
    enabled: !readOnly,
    openTrackId: trackInEditor === selectedTrack ? selectedTrack : null,
    knownTrackIds,
    appDeps: {
      getEditorCode: () => editorText(),
      getLastSavedCode: (id) => getTrackAutosaveContext(id).lastSavedCode,
      onDraftExpired: (draft) => {
        toastActions.warning(t('files:trackConflict.draftExpired', { name: draft.name }));
      },
      getLocalTrack: (id) => tracksRef.current[id],
      setEditorCode: (id, code) => {
        // The same call as opening a track from the library, with no reset: nothing is evaluated.
        void context.handleUpdate({ id, code }, false);
      },
      showDraft: (id, draft) => {
        const local = tracksRef.current[id];
        if (!local) return;
        const next: Track = {
          ...local,
          isMultitrack: draft.isMultitrack,
          ...(draft.isMultitrack ? { steps: draft.steps as Track['steps'], activeStep: draft.stepIndex } : {}),
          code: draft.code,
        };
        tracksRef.current = { ...tracksRef.current, [id]: next };
        setTracks(tracksRef.current);
        void context.handleUpdate({ id, code: draft.code }, false);
        // A reload opens the step in the URL, so it has to name the step this text belongs to.
        const step = next.isMultitrack ? (next.steps?.[draft.stepIndex] as { name?: string } | undefined) : undefined;
        if (step?.name && typeof window !== 'undefined') {
          const url = `${generateTrackUrlPath(next.name, next.folder, folders)}?step=${trackNameToSlug(step.name)}`;
          window.history.replaceState(window.history.state, '', url);
          // The routing effect follows this: left on the old step, it would load that over the draft.
          setActivePattern(url.replace(/^\/repl\//, ''));
        }
      },
      saveCode: async (id, code) => {
        const track = tracksRef.current[id];
        if (!track) throw new Error('Track not found');
        const stepIndex = activeStepIndex(track as never);
        const sent = { stepChange: stepChangeCountRef.current.get(id) ?? 0, at: Date.now() };
        const { error } = await db.tracks.update(id, {
          ...(saveFieldsFor(track as never, code, stepIndex) as Partial<Track>),
          modified: new Date().toISOString(),
        });
        if (error) throw error;
        markSaved(id, code, stepIndex, sent);
      },
      applySynced: (id, code, server) => {
        const local = tracksRef.current[id];
        if (local) {
          tracksRef.current = {
            ...tracksRef.current,
            [id]: {
              ...local,
              code,
              isMultitrack: Boolean(server.isMultitrack),
              steps: server.steps as Track['steps'],
              version: server.version,
              activeStep: server.isMultitrack ? localStep(local, server) : 0,
              modified: new Date().toISOString(),
            },
          };
          setTracks(tracksRef.current);
        }
        unsavedStepChangesRef.current.delete(id);
        const autosaveContext = getTrackAutosaveContext(id);
        clearTrackAutosaveTimer(id);
        autosaveContext.lastSavedCode = code;
        autosaveContext.lastSavedTimestamp = Date.now();
        if (selectedTrackRef.current === id) lastSavedCodeRef.current = code;
      },
      recreate: async (oldId: string, draft: TrackDraft, open: boolean) => {
        // The folder may have gone with it: the root is better than a folder nobody can see.
        const folderExists = Object.values(folders).some((f) => f.id === draft.folder || f.path === draft.folder);
        const folder = folderExists && draft.folder ? draft.folder : undefined;
        // The name may have been taken since. A free one is better than a notice that can't be left.
        const created = await createTrack(
          generateUniqueTrackName(
            draft.name,
            folder,
            Object.fromEntries(Object.entries(tracksRef.current).filter(([id]) => id !== oldId)) as never,
          ),
          draft.code,
          folder,
          draft.isMultitrack,
          draft.steps as Track['steps'],
          draft.stepIndex,
        );
        if (!created) return false;
        cleanupTrackAutosaveContext(oldId);
        setTracks((prev) => {
          const { [oldId]: _gone, ...rest } = prev;
          return { ...rest, [created.id]: { ...created, version: created.version } };
        });
        tracksActions.removeTrack(oldId);
        tracksActions.addTrack(created);
        if (open) {
          const autosaveContext = getTrackAutosaveContext(created.id);
          autosaveContext.lastSavedCode = draft.code;
          autosaveContext.lastSavedTimestamp = Date.now();
          lastSavedCodeRef.current = draft.code;
          // It's the same music under a new id: the next Update is still a hot-swap.
          context.replaceTrackId?.(oldId, created.id);
          setSelectedTrack(created.id);
          // Autosave finds the open track from the URL, which has to follow if the folder is gone.
          const url = generateTrackUrlPath(created.name, created.folder, folders);
          if (typeof window !== 'undefined' && window.location.pathname !== url.split('?')[0]) {
            window.history.replaceState(window.history.state, '', url);
            setActivePattern(url.replace(/^\/repl\//, ''));
          }
          if ((context.editorRef?.current?.code ?? '') !== draft.code) {
            void context.handleUpdate({ id: created.id, code: draft.code }, false);
          }
        }
        return true;
      },
      removeLocal: (id) => {
        cleanupTrackAutosaveContext(id);
        setTracks((prev) => {
          const { [id]: _gone, ...rest } = prev;
          return rest;
        });
        if (tracksStore.get().tracks[id]) tracksActions.removeTrack(id);
        if (selectedTrack === id) setSelectedTrack(null);
      },
    },
  });
  conflictRef.current = trackConflict;

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
    hasUnsavedEdits,
    saveForUnload,
    unloadSaveSettled: () => unloadSaveRef.current,
    applyStepChange,
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

    // Spec 018: the "changed elsewhere" notice
    trackConflict,

    // Translation
    t,
  };
}
