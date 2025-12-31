import { URLParser } from './URLParser';
import { NavigationStateManager, type NavigationState } from './NavigationState';

/**
 * Track routing configuration
 */
export interface TrackRouterConfig {
  onTrackChange?: (trackId: string | null, previousTrackId: string | null, step?: number) => void;
  onNavigationStart?: (trackId: string) => void;
  onNavigationComplete?: (trackId: string) => void;
  onNavigationError?: (error: Error, trackId: string) => void;
}

/**
 * Main track router class for handling URL-based track navigation
 */
export class TrackRouter {
  private navigationState: NavigationStateManager;
  private config: TrackRouterConfig;
  private isInitialized = false;

  constructor(config: TrackRouterConfig = {}) {
    this.config = config;
    this.navigationState = new NavigationStateManager();
    
    // Listen for browser back/forward navigation
    this.setupBrowserHistoryListener();
  }

  /**
   * Initialize the router and restore state from URL
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Get track ID and step from URL
      const trackId = URLParser.getCurrentTrackId();
      const step = URLParser.getCurrentStep();
      
      if (trackId) {
        console.log('TrackRouter: Restoring track from URL:', trackId, step !== null ? `step ${step}` : '');
        await this.navigateToTrack(trackId, { replace: true, skipUrlUpdate: true, step: step || undefined });
      }
      
      this.isInitialized = true;
      console.log('TrackRouter: Initialized successfully');
    } catch (error) {
      console.error('TrackRouter: Initialization failed:', error);
      this.config.onNavigationError?.(error as Error, URLParser.getCurrentTrackId() || '');
    }
  }

  /**
   * Navigate to a specific track with optional step
   */
  async navigateToTrack(
    trackId: string, 
    options: { 
      replace?: boolean; 
      skipUrlUpdate?: boolean;
      skipPlaybackChange?: boolean;
      step?: number;
    } = {}
  ): Promise<void> {
    const { replace = false, skipUrlUpdate = false, skipPlaybackChange = false, step } = options;
    
    try {
      // Start navigation
      this.navigationState.setNavigating(true);
      this.config.onNavigationStart?.(trackId);
      
      const currentState = this.navigationState.getState();
      const previousTrackId = currentState.currentTrackId;
      
      // Update navigation state
      this.navigationState.setCurrentTrack(trackId);
      
      // Update URL if not skipped
      if (!skipUrlUpdate) {
        URLParser.updateTrackInURL(trackId, replace, step);
        this.updatePageTitle(trackId);
      }
      
      // Notify track change
      this.config.onTrackChange?.(trackId, previousTrackId, step);
      
      // Complete navigation
      this.navigationState.setNavigating(false);
      this.config.onNavigationComplete?.(trackId);
      
      console.log('TrackRouter: Successfully navigated to track:', trackId);
    } catch (error) {
      this.navigationState.setNavigating(false);
      console.error('TrackRouter: Navigation failed:', error);
      this.config.onNavigationError?.(error as Error, trackId);
      throw error;
    }
  }

  /**
   * Navigate to previous track
   */
  async navigateToPrevious(): Promise<void> {
    const state = this.navigationState.getState();
    if (state.previousTrackId) {
      await this.navigateToTrack(state.previousTrackId);
    }
  }

  /**
   * Clear current track (navigate to no track)
   */
  async clearCurrentTrack(replace: boolean = true): Promise<void> {
    try {
      this.navigationState.setNavigating(true);
      
      const currentState = this.navigationState.getState();
      const previousTrackId = currentState.currentTrackId;
      
      // Update state
      this.navigationState.setCurrentTrack(null);
      
      // Update URL
      URLParser.clearTrackFromURL(replace);
      this.updatePageTitle(null);
      
      // Notify change
      this.config.onTrackChange?.(null, previousTrackId, undefined);
      
      this.navigationState.setNavigating(false);
      console.log('TrackRouter: Cleared current track');
    } catch (error) {
      this.navigationState.setNavigating(false);
      console.error('TrackRouter: Failed to clear track:', error);
      throw error;
    }
  }

  /**
   * Get current navigation state
   */
  getNavigationState(): NavigationState {
    return this.navigationState.getState();
  }

  /**
   * Subscribe to navigation state changes
   */
  subscribe(listener: (state: NavigationState) => void): () => void {
    return this.navigationState.subscribe(listener);
  }

  /**
   * Set playing track (for playback continuity)
   */
  setPlayingTrack(trackId: string | null): void {
    this.navigationState.setPlayingTrack(trackId);
  }

  /**
   * Check if router is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Setup browser history listener for back/forward navigation
   */
  private setupBrowserHistoryListener(): void {
    window.addEventListener('popstate', async (event) => {
      try {
        const trackId = URLParser.getCurrentTrackId();
        const step = URLParser.getCurrentStep();
        const currentState = this.navigationState.getState();
        
        // Check if track or step changed
        const trackChanged = trackId !== currentState.currentTrackId;
        const stepChanged = step !== null; // If step is in URL, we need to handle it
        
        if (trackChanged || stepChanged) {
          console.log('TrackRouter: Browser navigation detected, navigating to:', trackId, step !== null ? `step ${step}` : '');
          
          if (trackId) {
            await this.navigateToTrack(trackId, { skipUrlUpdate: true, step: step || undefined });
          } else {
            await this.clearCurrentTrack(true);
          }
        }
      } catch (error) {
        console.error('TrackRouter: Browser navigation failed:', error);
        this.config.onNavigationError?.(error as Error, URLParser.getCurrentTrackId() || '');
      }
    });
  }

  /**
   * Update page title based on current track
   */
  private updatePageTitle(trackId: string | null): void {
    try {
      if (trackId) {
        // You can customize this based on your track data
        document.title = `Strudel - Track ${trackId}`;
      } else {
        document.title = 'Strudel';
      }
    } catch (error) {
      console.warn('TrackRouter: Failed to update page title:', error);
    }
  }

  /**
   * Cleanup router resources
   */
  destroy(): void {
    // Remove event listeners and cleanup
    this.navigationState.reset();
    this.isInitialized = false;
    console.log('TrackRouter: Destroyed');
  }
}