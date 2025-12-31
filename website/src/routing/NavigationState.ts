/**
 * Navigation state management for track routing
 */
export interface NavigationState {
  currentTrackId: string | null;
  previousTrackId: string | null;
  isNavigating: boolean;
  playingTrackId: string | null; // Track that's currently playing audio
  viewingTrackId: string | null; // Track that's currently being viewed/edited
}

export class NavigationStateManager {
  private state: NavigationState = {
    currentTrackId: null,
    previousTrackId: null,
    isNavigating: false,
    playingTrackId: null,
    viewingTrackId: null,
  };

  private listeners: Array<(state: NavigationState) => void> = [];

  /**
   * Get current navigation state
   */
  getState(): NavigationState {
    return { ...this.state };
  }

  /**
   * Update navigation state
   */
  setState(updates: Partial<NavigationState>): void {
    const previousState = { ...this.state };
    this.state = { ...this.state, ...updates };
    
    // Notify listeners of state change
    this.listeners.forEach(listener => {
      try {
        listener(this.getState());
      } catch (error) {
        console.error('NavigationStateManager: Error in state listener:', error);
      }
    });
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: NavigationState) => void): () => void {
    this.listeners.push(listener);
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Set current track (updates both current and previous)
   */
  setCurrentTrack(trackId: string | null): void {
    this.setState({
      previousTrackId: this.state.currentTrackId,
      currentTrackId: trackId,
      viewingTrackId: trackId,
    });
  }

  /**
   * Set playing track (audio playback)
   */
  setPlayingTrack(trackId: string | null): void {
    this.setState({
      playingTrackId: trackId,
    });
  }

  /**
   * Set navigation loading state
   */
  setNavigating(isNavigating: boolean): void {
    this.setState({
      isNavigating,
    });
  }

  /**
   * Check if a track is currently playing
   */
  isTrackPlaying(trackId: string): boolean {
    return this.state.playingTrackId === trackId;
  }

  /**
   * Check if a track is currently being viewed
   */
  isTrackViewing(trackId: string): boolean {
    return this.state.viewingTrackId === trackId;
  }

  /**
   * Reset navigation state
   */
  reset(): void {
    this.setState({
      currentTrackId: null,
      previousTrackId: null,
      isNavigating: false,
      playingTrackId: null,
      viewingTrackId: null,
    });
  }
}