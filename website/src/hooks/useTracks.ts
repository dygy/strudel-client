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
    initializationPromise: state.initializationPromise,
    randomTrackSelected: state.randomTrackSelected,
    loadingPhase: state.loadingPhase,

    // Actions
    initializeWithSSR: tracksActions.initializeWithSSR,
    initializeWithCoordination: tracksActions.initializeWithCoordination,
    loadFromAPI: tracksActions.loadFromAPI,
    addTrack: tracksActions.addTrack,
    updateTrack: tracksActions.updateTrack,
    removeTrack: tracksActions.removeTrack,
    addFolder: tracksActions.addFolder,
    removeFolder: tracksActions.removeFolder,
    setSelectedTrack: tracksActions.setSelectedTrack,
    clear: tracksActions.clear,
    selectRandomTrack: tracksActions.selectRandomTrack,
    waitForInitialization: tracksActions.waitForInitialization,
    setLoadingPhase: tracksActions.setLoadingPhase,

    // Selectors
    getTrack: tracksSelectors.getTrack,
    getFolder: tracksSelectors.getFolder,
    getSelectedTrack: tracksSelectors.getSelectedTrack,
    getTracksCount: tracksSelectors.getTracksCount,
    getFoldersCount: tracksSelectors.getFoldersCount,
    
    // Reactive computed values based on current state
    hasTracks: Object.keys(state.tracks).length > 0,
    hasData: Object.keys(state.tracks).length > 0 || Object.keys(state.folders).length > 0,

    // Computed values
    tracksArray: Object.values(state.tracks),
    foldersArray: Object.values(state.folders),
  };
}