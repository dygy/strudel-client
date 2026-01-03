/**
 * React hook for tracks store
 * Provides reactive access to tracks data
 */

import { useStore } from '@nanostores/react';
import { tracksStore, tracksActions, tracksSelectors } from '../stores/tracksStore';

export function useTracks() {
  const state = useStore(tracksStore);

  return {
    // State
    tracks: state.tracks,
    folders: state.folders,
    isLoading: state.isLoading,
    isInitialized: state.isInitialized,
    selectedTrack: state.selectedTrack,
    error: state.error,

    // Actions
    initializeWithSSR: tracksActions.initializeWithSSR,
    loadFromAPI: tracksActions.loadFromAPI,
    addTrack: tracksActions.addTrack,
    updateTrack: tracksActions.updateTrack,
    removeTrack: tracksActions.removeTrack,
    addFolder: tracksActions.addFolder,
    removeFolder: tracksActions.removeFolder,
    setSelectedTrack: tracksActions.setSelectedTrack,
    clear: tracksActions.clear,

    // Selectors
    getTrack: tracksSelectors.getTrack,
    getFolder: tracksSelectors.getFolder,
    getSelectedTrack: tracksSelectors.getSelectedTrack,
    getTracksCount: tracksSelectors.getTracksCount,
    getFoldersCount: tracksSelectors.getFoldersCount,
    hasTracks: tracksActions.hasTracks,
    hasData: tracksActions.hasData,

    // Computed values
    tracksArray: Object.values(state.tracks),
    foldersArray: Object.values(state.folders),
  };
}