/**
 * Tests for path-based routing in URLParser
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { URLParser } from '../URLParser';

// Mock window and location
const mockLocation = {
  pathname: '/repl',
  search: '',
  hash: '',
  href: 'http://localhost:3000/repl'
};

const mockHistory = {
  pushState: vi.fn(),
  replaceState: vi.fn()
};

// Mock window object
Object.defineProperty(global, 'window', {
  value: {
    location: mockLocation,
    history: mockHistory
  },
  writable: true
});

describe('URLParser Path-Based Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.pathname = '/repl';
    mockLocation.search = '';
    mockLocation.hash = '';
    mockLocation.href = 'http://localhost:3000/repl';
  });

  describe('getCurrentTrackId', () => {
    it('should extract track ID from path-based URL', () => {
      mockLocation.pathname = '/repl/track123';
      
      const trackId = URLParser.getCurrentTrackId();
      expect(trackId).toBe('track123');
    });

    it('should return null for base repl path', () => {
      mockLocation.pathname = '/repl';
      
      const trackId = URLParser.getCurrentTrackId();
      expect(trackId).toBeNull();
    });

    it('should handle complex track IDs', () => {
      mockLocation.pathname = '/repl/po4d1tBa_uMHVQm1_Tp8N';
      
      const trackId = URLParser.getCurrentTrackId();
      expect(trackId).toBe('po4d1tBa_uMHVQm1_Tp8N');
    });

    it('should fallback to query parameter for backward compatibility', () => {
      mockLocation.pathname = '/repl';
      mockLocation.search = '?track=legacy-track-id';
      mockLocation.href = 'http://localhost:3000/repl?track=legacy-track-id';
      
      const trackId = URLParser.getCurrentTrackId();
      expect(trackId).toBe('legacy-track-id');
    });

    it('should prioritize path over query parameter', () => {
      mockLocation.pathname = '/repl/path-track-id';
      mockLocation.search = '?track=query-track-id';
      
      const trackId = URLParser.getCurrentTrackId();
      expect(trackId).toBe('path-track-id');
    });

    it('should return null for non-repl paths', () => {
      mockLocation.pathname = '/learn/getting-started';
      
      const trackId = URLParser.getCurrentTrackId();
      expect(trackId).toBeNull();
    });
  });

  describe('updateTrackInURL', () => {
    it('should update URL to path-based format', () => {
      URLParser.updateTrackInURL('new-track-id');
      
      expect(mockHistory.pushState).toHaveBeenCalledWith(
        null, 
        '', 
        '/repl/new-track-id'
      );
    });

    it('should use replace when specified', () => {
      URLParser.updateTrackInURL('new-track-id', true);
      
      expect(mockHistory.replaceState).toHaveBeenCalledWith(
        null, 
        '', 
        '/repl/new-track-id'
      );
    });

    it('should add step as query parameter', () => {
      URLParser.updateTrackInURL('track-id', false, 2);
      
      expect(mockHistory.pushState).toHaveBeenCalledWith(
        null, 
        '', 
        '/repl/track-id?step=2'
      );
    });

    it('should preserve hash', () => {
      mockLocation.hash = '#section1';
      
      URLParser.updateTrackInURL('track-id');
      
      expect(mockHistory.pushState).toHaveBeenCalledWith(
        null, 
        '', 
        '/repl/track-id#section1'
      );
    });

    it('should redirect to base repl when track is null', () => {
      URLParser.updateTrackInURL(null);
      
      expect(mockHistory.pushState).toHaveBeenCalledWith(
        null, 
        '', 
        '/repl'
      );
    });

    it('should handle track with step and hash', () => {
      mockLocation.hash = '#test';
      
      URLParser.updateTrackInURL('track-id', false, 1);
      
      expect(mockHistory.pushState).toHaveBeenCalledWith(
        null, 
        '', 
        '/repl/track-id?step=1#test'
      );
    });
  });

  describe('hasTrackInURL', () => {
    it('should return true for path-based track URL', () => {
      mockLocation.pathname = '/repl/some-track';
      
      expect(URLParser.hasTrackInURL()).toBe(true);
    });

    it('should return true for query-based track URL', () => {
      mockLocation.pathname = '/repl';
      mockLocation.search = '?track=some-track';
      mockLocation.href = 'http://localhost:3000/repl?track=some-track';
      
      expect(URLParser.hasTrackInURL()).toBe(true);
    });

    it('should return false for base repl URL', () => {
      mockLocation.pathname = '/repl';
      mockLocation.search = '';
      
      expect(URLParser.hasTrackInURL()).toBe(false);
    });
  });

  describe('clearTrackFromURL', () => {
    it('should clear track and redirect to base repl', () => {
      URLParser.clearTrackFromURL();
      
      expect(mockHistory.replaceState).toHaveBeenCalledWith(
        null, 
        '', 
        '/repl'
      );
    });

    it('should use push when replace is false', () => {
      URLParser.clearTrackFromURL(false);
      
      expect(mockHistory.pushState).toHaveBeenCalledWith(
        null, 
        '', 
        '/repl'
      );
    });
  });

  describe('URL format migration', () => {
    it('should handle migration from query to path format', () => {
      // Simulate old URL format
      mockLocation.pathname = '/repl';
      mockLocation.search = '?track=old-track-id&step=1';
      mockLocation.href = 'http://localhost:3000/repl?track=old-track-id&step=1';
      
      // Get track ID (should work with old format)
      const trackId = URLParser.getCurrentTrackId();
      expect(trackId).toBe('old-track-id');
      
      // Update to new format
      URLParser.updateTrackInURL(trackId, true, 1);
      
      expect(mockHistory.replaceState).toHaveBeenCalledWith(
        null, 
        '', 
        '/repl/old-track-id?step=1'
      );
    });
  });
});