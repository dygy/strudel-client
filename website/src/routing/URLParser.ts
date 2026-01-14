import { findTrackBySlug, trackNameToSlug } from '@src/lib/slugUtils';

/**
 * Utility class for parsing and managing URL parameters
 * for track routing navigation with name-based routing support
 */
export class URLParser {
  /**
   * Parse query parameters from URL
   */
  static parseQueryParams(url?: string): Record<string, string> {
    const urlToParse = url || window.location.href;
    const urlObj = new URL(urlToParse);
    const params: Record<string, string> = {};
    
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    
    return params;
  }

  /**
   * Build query string from parameters
   */
  static buildQueryString(params: Record<string, string | null | undefined>): string {
    const searchParams = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        searchParams.set(key, value);
      }
    });
    
    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
  }

  /**
   * Get current track identifier from URL (could be ID or name slug)
   */
  static getCurrentTrackIdentifier(): string | null {
    // Check path-based routing first: /repl/track-name
    const pathMatch = window.location.pathname.match(/^\/repl\/([^\/]+)$/);
    if (pathMatch) {
      return decodeURIComponent(pathMatch[1]);
    }
    
    // Fallback to query parameter for backward compatibility
    const params = this.parseQueryParams();
    return params.track || null;
  }

  /**
   * Find track by current URL identifier
   */
  static findCurrentTrack(tracks: Array<{id: string, name: string}>): {id: string, name: string} | null {
    const identifier = this.getCurrentTrackIdentifier();
    if (!identifier || !tracks.length) return null;

    // First try to find by exact ID (for backward compatibility)
    const byId = tracks.find(track => track.id === identifier);
    if (byId) return byId;

    // Then try to find by name slug
    return findTrackBySlug(tracks, identifier);
  }

  /**
   * Get current step from URL
   */
  static getCurrentStep(): number | null {
    const params = this.parseQueryParams();
    const step = params.step;
    if (step && !isNaN(parseInt(step))) {
      const stepNum = parseInt(step);
      // Only return valid step numbers (>= 0)
      return stepNum >= 0 ? stepNum : null;
    }
    return null;
  }

  /**
   * Update URL with track name (converted to slug) and optional step
   */
  static updateTrackInURL(trackNameOrUrl: string | null, replace: boolean = false, step?: number): void {
    let newUrl: string;
    
    if (trackNameOrUrl) {
      // If it's already a full URL path, use it directly
      if (trackNameOrUrl.startsWith('/repl/')) {
        newUrl = trackNameOrUrl;
      } else {
        // Otherwise, treat it as a track name and convert to slug
        const slug = trackNameToSlug(trackNameOrUrl);
        newUrl = `/repl/${encodeURIComponent(slug)}`;
      }
      
      // Add step parameter as query if provided
      if (step !== undefined && step >= 0) {
        newUrl += `?step=${step}`;
      }
      
      // Preserve hash
      if (window.location.hash) {
        newUrl += window.location.hash;
      }
    } else {
      // No track, go to main repl
      newUrl = '/repl';
      
      // Preserve hash
      if (window.location.hash) {
        newUrl += window.location.hash;
      }
    }
    
    if (replace) {
      window.history.replaceState(null, '', newUrl);
    } else {
      window.history.pushState(null, '', newUrl);
    }
  }

  /**
   * Navigate to track using smooth client-side navigation (no page reload)
   */
  static navigateToTrack(trackName: string): void {
    const slug = trackNameToSlug(trackName);
    const url = `/repl/${encodeURIComponent(slug)}`;
    
    // Use smooth navigation instead of page reload
    window.history.pushState({ trackName }, '', url);
    
    // Dispatch navigation event for the app to handle
    window.dispatchEvent(new CustomEvent('strudel-url-navigation', {
      detail: { trackName, url }
    }));
  }

  /**
   * Check if URL has track parameter (path or query)
   */
  static hasTrackInURL(): boolean {
    return this.getCurrentTrackIdentifier() !== null;
  }

  /**
   * Remove track parameter from URL
   */
  static clearTrackFromURL(replace: boolean = true): void {
    this.updateTrackInURL(null, replace);
  }

  // Legacy methods for backward compatibility
  /**
   * @deprecated Use getCurrentTrackIdentifier() instead
   */
  static getCurrentTrackId(): string | null {
    return this.getCurrentTrackIdentifier();
  }
}