/**
 * Centralized Tracks Store
 * Single source of truth for tracks and folders data
 * Handles SSR initialization and API updates
 */

import { atom } from 'nanostores';
import { secureApi } from '../lib/secureApi';

// Types
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
  user_id: string;
}

export interface Folder {
  id: string;
  name: string;
  path: string;
  parent: string | null;
  created: string;
  user_id: string;
}

export interface TracksState {
  tracks: Record<string, Track>;
  folders: Record<string, Folder>;
  isLoading: boolean;
  isInitialized: boolean;
  selectedTrack: string | null;
  error: string | null;
  // New coordination fields
  initializationPromise: Promise<void> | null;
  randomTrackSelected: boolean;
  loadingPhase: 'initial' | 'loading' | 'complete' | 'error';
}

// Initial state
const initialState: TracksState = {
  tracks: {},
  folders: {},
  isLoading: false,
  isInitialized: false,
  selectedTrack: null,
  error: null,
  // New coordination fields
  initializationPromise: null,
  randomTrackSelected: false,
  loadingPhase: 'initial',
};

// Store
export const tracksStore = atom<TracksState>(initialState);

/**
 * Helper: Convert hierarchical data to flat format
 */
function convertHierarchicalToFlat(hierarchicalData: any): { tracks: Track[]; folders: Folder[] } {
  if (!hierarchicalData || !hierarchicalData.children) {
    return { tracks: [], folders: [] };
  }

  const tracks: Track[] = [];
  const folders: Folder[] = [];
  const processedIds = new Set<string>();

  const processItems = (items: any[], parentId: string | null = null, parentPath: string | null = null) => {
    for (const item of items) {
      // Skip duplicates using ID
      if (processedIds.has(item.id)) {
        console.warn('TracksStore - Skipping duplicate item ID:', item.id, 'name:', item.name);
        continue;
      }
      processedIds.add(item.id);

      if (item.type === 'track') {
        tracks.push({
          ...item,
          folder: parentPath, // Use parent path for tracks (for backward compatibility)
        });
      } else if (item.type === 'folder') {
        const folderPath = item.path || item.name;
        folders.push({
          ...item,
          path: folderPath,
          parent: parentId, // Use parent ID for folders (proper UUID reference)
        });

        if (item.children && item.children.length > 0) {
          // Pass both parent ID and path for proper hierarchy
          processItems(item.children, item.id, folderPath);
        }
      }
    }
  };

  processItems(hierarchicalData.children);
  return { tracks, folders };
}

// Actions
export const tracksActions = {
  /**
   * Initialize store with SSR data (hierarchical format)
   */
  initializeWithSSR(ssrData: any) {
    if (!ssrData || !ssrData.children) {
      tracksStore.set({
        ...initialState,
        isInitialized: true,
      });
      return;
    }

    // Convert hierarchical SSR data to flat format
    const flatData = convertHierarchicalToFlat(ssrData);

    // Convert arrays to objects with id as key
    const tracksObj = flatData.tracks.reduce((acc: Record<string, Track>, track: Track) => {
      acc[track.id] = track;
      return acc;
    }, {});

    const foldersObj = flatData.folders.reduce((acc: Record<string, Folder>, folder: Folder) => {
      acc[folder.id] = folder;
      return acc;
    }, {});

    console.log(`TracksStore - Initialized with ${Object.keys(tracksObj).length} tracks, ${Object.keys(foldersObj).length} folders`);

    tracksStore.set({
      tracks: tracksObj,
      folders: foldersObj,
      isLoading: false,
      isInitialized: true,
      selectedTrack: null,
      error: null,
      initializationPromise: null,
      randomTrackSelected: false,
      loadingPhase: 'complete',
    });
  },

  /**
   * Load data from API (for client-side updates)
   */
  async loadFromAPI() {
    const currentState = tracksStore.get();
    tracksStore.set({ ...currentState, isLoading: true, error: null });

    try {
      console.log('TracksStore - Loading from API');
      const { tracks, folders } = await secureApi.getTracks();

      // Convert arrays to objects with id as key
      const tracksObj = tracks.reduce((acc: Record<string, Track>, track: Track) => {
        acc[track.id] = track;
        return acc;
      }, {});

      const foldersObj = folders.reduce((acc: Record<string, Folder>, folder: Folder) => {
        acc[folder.id] = folder;
        return acc;
      }, {});

      console.log(`TracksStore - Loaded ${Object.keys(tracksObj).length} tracks, ${Object.keys(foldersObj).length} folders from API`);

      tracksStore.set({
        tracks: tracksObj,
        folders: foldersObj,
        isLoading: false,
        isInitialized: true,
        selectedTrack: currentState.selectedTrack,
        error: null,
        initializationPromise: currentState.initializationPromise,
        randomTrackSelected: currentState.randomTrackSelected,
        loadingPhase: 'complete',
      });
    } catch (error) {
      console.error('TracksStore - Error loading from API:', error);
      tracksStore.set({
        ...currentState,
        isLoading: false,
        loadingPhase: 'error',
        error: error instanceof Error ? error.message : 'Failed to load tracks',
      });
    }
  },

  /**
   * Add a new track
   */
  addTrack(track: Track) {
    const currentState = tracksStore.get();
    tracksStore.set({
      ...currentState,
      tracks: {
        ...currentState.tracks,
        [track.id]: track,
      },
    });
  },

  /**
   * Update an existing track
   */
  updateTrack(trackId: string, updates: Partial<Track>) {
    const currentState = tracksStore.get();
    const existingTrack = currentState.tracks[trackId];

    if (!existingTrack) {
      console.warn(`TracksStore - Track not found: ${trackId}`);
      return;
    }

    const updatedTrack = { ...existingTrack, ...updates };
    tracksStore.set({
      ...currentState,
      tracks: {
        ...currentState.tracks,
        [trackId]: updatedTrack,
      },
    });
    console.log(`TracksStore - Updated track: ${trackId}`);
  },

  /**
   * Remove a track
   */
  removeTrack(trackId: string) {
    const currentState = tracksStore.get();
    const { [trackId]: removed, ...remainingTracks } = currentState.tracks;

    tracksStore.set({
      ...currentState,
      tracks: remainingTracks,
      selectedTrack: currentState.selectedTrack === trackId ? null : currentState.selectedTrack,
    });
    console.log(`TracksStore - Removed track: ${trackId}`);
  },

  /**
   * Add a new folder
   */
  addFolder(folder: Folder) {
    const currentState = tracksStore.get();
    tracksStore.set({
      ...currentState,
      folders: {
        ...currentState.folders,
        [folder.id]: folder,
      },
    });
  },

  /**
   * Remove a folder
   */
  removeFolder(folderId: string) {
    const currentState = tracksStore.get();
    const { [folderId]: removed, ...remainingFolders } = currentState.folders;

    tracksStore.set({
      ...currentState,
      folders: remainingFolders,
    });
    console.log(`TracksStore - Removed folder: ${folderId}`);
  },

  /**
   * Set selected track
   */
  setSelectedTrack(trackId: string | null) {
    const currentState = tracksStore.get();
    tracksStore.set({
      ...currentState,
      selectedTrack: trackId,
    });
  },

  /**
   * Clear all data
   */
  clear() {
    tracksStore.set({
      ...initialState,
      initializationPromise: null,
      randomTrackSelected: false,
      loadingPhase: 'initial',
    });
  },

  /**
   * Get current state (for convenience)
   */
  getState(): TracksState {
    return tracksStore.get();
  },

  /**
   * Check if store has any tracks
   */
  hasTracks(): boolean {
    const state = tracksStore.get();
    return Object.keys(state.tracks).length > 0;
  },

  /**
   * Check if store has any data (tracks or folders)
   */
  hasData(): boolean {
    const state = tracksStore.get();
    return Object.keys(state.tracks).length > 0 || Object.keys(state.folders).length > 0;
  },

  /**
   * Select a random track with smart criteria
   */
  selectRandomTrack(): Track | null {
    const state = tracksStore.get();
    const tracks = Object.values(state.tracks);

    if (tracks.length === 0) {
      return null;
    }

    // Smart criteria: prefer recently modified tracks, exclude empty tracks
    const validTracks = tracks.filter(track =>
      track.code && track.code.trim().length > 0
    );

    if (validTracks.length === 0) {
      // If no valid tracks, return any track
      return tracks[Math.floor(Math.random() * tracks.length)];
    }

    // Weight by modification date (more recent = higher weight)
    const now = Date.now();
    const tracksWithWeights = validTracks.map(track => {
      const modifiedTime = new Date(track.modified).getTime();
      const daysSinceModified = (now - modifiedTime) / (1000 * 60 * 60 * 24);
      // Higher weight for more recently modified tracks
      const weight = Math.max(1, 30 - daysSinceModified);
      return { track, weight };
    });

    // Weighted random selection
    const totalWeight = tracksWithWeights.reduce((sum, item) => sum + item.weight, 0);
    let randomWeight = Math.random() * totalWeight;

    for (const item of tracksWithWeights) {
      randomWeight -= item.weight;
      if (randomWeight <= 0) {
        return item.track;
      }
    }

    // Fallback to first track
    return validTracks[0];
  },

  /**
   * Initialize with coordination and callbacks
   */
  initializeWithCoordination(ssrData: any, onComplete: (randomTrack: Track | null) => void): void {
    const currentState = tracksStore.get();

    // Prevent multiple initializations
    if (currentState.initializationPromise) {
      currentState.initializationPromise.then(() => {
        const state = tracksStore.get();
        const randomTrack = state.randomTrackSelected ? tracksActions.selectRandomTrack() : null;
        onComplete(randomTrack);
      });
      return;
    }

    const initPromise = new Promise<void>((resolve) => {
      tracksStore.set({
        ...currentState,
        loadingPhase: 'loading',
        initializationPromise: null, // Will be set after this
      });

      // Initialize with SSR data
      tracksActions.initializeWithSSR(ssrData);

      // Select random track if tracks are available
      const updatedState = tracksStore.get();
      const randomTrack = tracksActions.selectRandomTrack();

      tracksStore.set({
        ...updatedState,
        randomTrackSelected: randomTrack !== null,
        loadingPhase: 'complete',
        selectedTrack: randomTrack?.id || null,
      });

      onComplete(randomTrack);
      resolve();
    });

    tracksStore.set({
      ...currentState,
      initializationPromise: initPromise,
    });
  },

  /**
   * Wait for initialization to complete
   */
  async waitForInitialization(): Promise<{ hasData: boolean; randomTrack: Track | null }> {
    const state = tracksStore.get();

    if (state.initializationPromise) {
      await state.initializationPromise;
    }

    const finalState = tracksStore.get();
    const randomTrack = finalState.randomTrackSelected ? tracksActions.selectRandomTrack() : null;

    return {
      hasData: tracksActions.hasData(),
      randomTrack,
    };
  },

  /**
   * Set loading phase with timeout handling
   */
  setLoadingPhase(phase: 'initial' | 'loading' | 'complete' | 'error', timeout?: number): void {
    const currentState = tracksStore.get();
    tracksStore.set({
      ...currentState,
      loadingPhase: phase,
    });

    // Handle timeout if specified
    if (timeout && phase === 'loading') {
      setTimeout(() => {
        const state = tracksStore.get();
        if (state.loadingPhase === 'loading') {
          tracksStore.set({
            ...state,
            loadingPhase: 'error',
            error: 'Loading timeout exceeded',
          });
        }
      }, timeout);
    }
  },
};

// Selectors (computed values)
export const tracksSelectors = {
  /**
   * Get all tracks as array
   */
  getTracks(): Track[] {
    return Object.values(tracksStore.get().tracks);
  },

  /**
   * Get all folders as array
   */
  getFolders(): Folder[] {
    return Object.values(tracksStore.get().folders);
  },

  /**
   * Get track by ID
   */
  getTrack(id: string): Track | undefined {
    return tracksStore.get().tracks[id];
  },

  /**
   * Get folder by ID
   */
  getFolder(id: string): Folder | undefined {
    return tracksStore.get().folders[id];
  },

  /**
   * Get selected track
   */
  getSelectedTrack(): Track | undefined {
    const state = tracksStore.get();
    return state.selectedTrack ? state.tracks[state.selectedTrack] : undefined;
  },

  /**
   * Get tracks count
   */
  getTracksCount(): number {
    return Object.keys(tracksStore.get().tracks).length;
  },

  /**
   * Get folders count
   */
  getFoldersCount(): number {
    return Object.keys(tracksStore.get().folders).length;
  },
};
