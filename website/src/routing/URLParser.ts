/**
 * Utility class for parsing and managing URL query parameters
 * for track routing navigation
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
   * Get current track ID from URL
   */
  static getCurrentTrackId(): string | null {
    const params = this.parseQueryParams();
    return params.track || null;
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
   * Update URL with new track ID and optional step
   */
  static updateTrackInURL(trackId: string | null, replace: boolean = false, step?: number): void {
    const currentParams = this.parseQueryParams();
    
    if (trackId) {
      currentParams.track = trackId;
      
      // Add step parameter if provided
      if (step !== undefined && step >= 0) {
        currentParams.step = step.toString();
      } else {
        // Remove step parameter if not provided or invalid
        delete currentParams.step;
      }
    } else {
      delete currentParams.track;
      delete currentParams.step;
    }
    
    const queryString = this.buildQueryString(currentParams);
    const newUrl = `${window.location.pathname}${queryString}${window.location.hash}`;
    
    if (replace) {
      window.history.replaceState(null, '', newUrl);
    } else {
      window.history.pushState(null, '', newUrl);
    }
  }

  /**
   * Check if URL has track parameter
   */
  static hasTrackInURL(): boolean {
    return this.getCurrentTrackId() !== null;
  }

  /**
   * Remove track parameter from URL
   */
  static clearTrackFromURL(replace: boolean = true): void {
    this.updateTrackInURL(null, replace);
  }
}