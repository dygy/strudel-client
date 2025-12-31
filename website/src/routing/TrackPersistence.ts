import { URLParser } from './URLParser';

/**
 * Track state that can be persisted in URLs
 */
export interface PersistedTrackState {
  trackId: string;
  step?: number;
  mode?: 'edit' | 'view' | 'play';
  timestamp?: number;
}

/**
 * Service for handling track state persistence and restoration from URLs
 */
export class TrackPersistence {
  private static readonly STORAGE_KEY = 'strudel_tracks';
  private static readonly MAX_URL_LENGTH = 2000; // Browser URL length limit

  /**
   * Restore track state from URL parameters
   */
  static restoreFromURL(): PersistedTrackState | null {
    try {
      const params = URLParser.parseQueryParams();
      
      if (!params.track) {
        return null;
      }

      const state: PersistedTrackState = {
        trackId: params.track,
      };

      // Parse optional parameters
      if (params.step && !isNaN(parseInt(params.step))) {
        state.step = parseInt(params.step);
      }

      if (params.mode && ['edit', 'view', 'play'].includes(params.mode)) {
        state.mode = params.mode as 'edit' | 'view' | 'play';
      }

      if (params.timestamp && !isNaN(parseInt(params.timestamp))) {
        state.timestamp = parseInt(params.timestamp);
      }

      return state;
    } catch (error) {
      console.warn('TrackPersistence: Failed to restore from URL:', error);
      return null;
    }
  }

  /**
   * Persist track state to URL
   */
  static persistToURL(state: PersistedTrackState, replace: boolean = false): boolean {
    try {
      const params: Record<string, string> = {
        track: state.trackId,
      };

      if (state.step !== undefined) {
        params.step = state.step.toString();
      }

      if (state.mode) {
        params.mode = state.mode;
      }

      if (state.timestamp) {
        params.timestamp = state.timestamp.toString();
      }

      // Check URL length limit
      const queryString = URLParser.buildQueryString(params);
      const newUrl = `${window.location.pathname}${queryString}${window.location.hash}`;
      
      if (newUrl.length > this.MAX_URL_LENGTH) {
        console.warn('TrackPersistence: URL too long, skipping persistence');
        return false;
      }

      // Update URL with all parameters
      if (replace) {
        window.history.replaceState(null, '', newUrl);
      } else {
        window.history.pushState(null, '', newUrl);
      }
      
      return true;
    } catch (error) {
      console.error('TrackPersistence: Failed to persist to URL:', error);
      return false;
    }
  }

  /**
   * Check if a track exists in local storage
   */
  static trackExists(trackId: string): boolean {
    try {
      if (typeof localStorage === 'undefined') {
        return false;
      }

      const tracksData = localStorage.getItem(this.STORAGE_KEY);
      if (!tracksData) {
        return false;
      }

      const tracks = JSON.parse(tracksData);
      return tracks.hasOwnProperty(trackId);
    } catch (error) {
      console.warn('TrackPersistence: Failed to check track existence:', error);
      return false;
    }
  }

  /**
   * Get track data from local storage
   */
  static getTrackData(trackId: string): any | null {
    try {
      if (typeof localStorage === 'undefined') {
        return null;
      }

      const tracksData = localStorage.getItem(this.STORAGE_KEY);
      if (!tracksData) {
        return null;
      }

      const tracks = JSON.parse(tracksData);
      return tracks[trackId] || null;
    } catch (error) {
      console.warn('TrackPersistence: Failed to get track data:', error);
      return null;
    }
  }

  /**
   * Handle invalid track ID with graceful fallback
   */
  static handleInvalidTrackId(trackId: string): {
    action: 'redirect' | 'create' | 'ignore';
    fallbackTrackId?: string;
    message?: string;
  } {
    // Check if track exists
    if (this.trackExists(trackId)) {
      return { action: 'ignore' }; // Track is valid
    }

    // Try to find similar tracks
    const similarTrack = this.findSimilarTrack(trackId);
    if (similarTrack) {
      return {
        action: 'redirect',
        fallbackTrackId: similarTrack,
        message: `Track "${trackId}" not found. Redirecting to similar track "${similarTrack}".`,
      };
    }

    // Get the most recent track as fallback
    const recentTrack = this.getMostRecentTrack();
    if (recentTrack) {
      return {
        action: 'redirect',
        fallbackTrackId: recentTrack,
        message: `Track "${trackId}" not found. Redirecting to most recent track.`,
      };
    }

    // No tracks available, suggest creating one
    return {
      action: 'create',
      message: `Track "${trackId}" not found and no other tracks available. Consider creating a new track.`,
    };
  }

  /**
   * Find a similar track by name or ID pattern
   */
  private static findSimilarTrack(trackId: string): string | null {
    try {
      if (typeof localStorage === 'undefined') {
        return null;
      }

      const tracksData = localStorage.getItem(this.STORAGE_KEY);
      if (!tracksData) {
        return null;
      }

      const tracks = JSON.parse(tracksData);
      const trackIds = Object.keys(tracks);

      // Look for tracks with similar names or IDs
      const similar = trackIds.find(id => {
        const track = tracks[id];
        return (
          id.toLowerCase().includes(trackId.toLowerCase()) ||
          trackId.toLowerCase().includes(id.toLowerCase()) ||
          (track.name && track.name.toLowerCase().includes(trackId.toLowerCase()))
        );
      });

      return similar || null;
    } catch (error) {
      console.warn('TrackPersistence: Failed to find similar track:', error);
      return null;
    }
  }

  /**
   * Get the most recently modified track
   */
  private static getMostRecentTrack(): string | null {
    try {
      if (typeof localStorage === 'undefined') {
        return null;
      }

      const tracksData = localStorage.getItem(this.STORAGE_KEY);
      if (!tracksData) {
        return null;
      }

      const tracks = JSON.parse(tracksData);
      const trackEntries = Object.entries(tracks);

      if (trackEntries.length === 0) {
        return null;
      }

      // Sort by modified date (most recent first)
      const sortedTracks = trackEntries.sort(([, a]: [string, any], [, b]: [string, any]) => {
        const aModified = new Date(a.modified || a.created || 0).getTime();
        const bModified = new Date(b.modified || b.created || 0).getTime();
        return bModified - aModified;
      });

      return sortedTracks[0][0]; // Return the ID of the most recent track
    } catch (error) {
      console.warn('TrackPersistence: Failed to get most recent track:', error);
      return null;
    }
  }

  /**
   * Update page title based on track data
   */
  static updatePageTitle(trackId: string | null): void {
    try {
      if (!trackId) {
        document.title = 'Strudel';
        return;
      }

      const trackData = this.getTrackData(trackId);
      if (trackData && trackData.name) {
        document.title = `${trackData.name} - Strudel`;
      } else {
        document.title = `Track ${trackId} - Strudel`;
      }
    } catch (error) {
      console.warn('TrackPersistence: Failed to update page title:', error);
    }
  }

  /**
   * Generate a shareable URL for a track
   */
  static generateShareableURL(trackId: string, options?: {
    step?: number;
    mode?: 'edit' | 'view' | 'play';
    includeTimestamp?: boolean;
  }): string {
    try {
      const state: PersistedTrackState = {
        trackId,
        ...options,
      };

      if (options?.includeTimestamp) {
        state.timestamp = Date.now();
      }

      const params: Record<string, string> = {
        track: state.trackId,
      };

      if (state.step !== undefined) {
        params.step = state.step.toString();
      }

      if (state.mode) {
        params.mode = state.mode;
      }

      if (state.timestamp) {
        params.timestamp = state.timestamp.toString();
      }

      const queryString = URLParser.buildQueryString(params);
      return `${window.location.origin}${window.location.pathname}${queryString}`;
    } catch (error) {
      console.error('TrackPersistence: Failed to generate shareable URL:', error);
      return window.location.href;
    }
  }
}