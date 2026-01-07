/**
 * Centralized Tracks Store
 * Single source of truth for tracks and folders data
 * Handles SSR initialization and API updates
 */

import { atom } from 'nanostores';
import { TreeDataTransformer } from '../lib/TreeDataTransformer';
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
}

// Initial state
const initialState: TracksState = {
  tracks: {},
  folders: {},
  isLoading: false,
  isInitialized: false,
  selectedTrack: null,
  error: null,
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
      });
    } catch (error) {
      console.error('TracksStore - Error loading from API:', error);
      tracksStore.set({
        ...currentState,
        isLoading: false,
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
    tracksStore.set(initialState);
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
