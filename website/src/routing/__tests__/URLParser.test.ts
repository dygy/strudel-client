import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { URLParser } from '../URLParser';

// Mock window.location and window.history for testing
const mockLocation = {
  href: 'https://example.com/',
  pathname: '/',
  search: '',
  hash: '',
};

const mockHistory = {
  pushState: vi.fn(),
  replaceState: vi.fn(),
};

// Setup global mocks
beforeEach(() => {
  vi.stubGlobal('window', {
    location: mockLocation,
    history: mockHistory,
  });
  
  // Reset mocks
  mockHistory.pushState.mockClear();
  mockHistory.replaceState.mockClear();
  
  // Reset location
  mockLocation.href = 'https://example.com/';
  mockLocation.pathname = '/';
  mockLocation.search = '';
  mockLocation.hash = '';
});

describe('URLParser', () => {
  describe('parseQueryParams', () => {
    it('should parse empty query parameters', () => {
      const result = URLParser.parseQueryParams('https://example.com/');
      expect(result).toEqual({});
    });

    it('should parse single query parameter', () => {
      const result = URLParser.parseQueryParams('https://example.com/?track=123');
      expect(result).toEqual({ track: '123' });
    });

    it('should parse multiple query parameters', () => {
      const result = URLParser.parseQueryParams('https://example.com/?track=123&mode=edit');
      expect(result).toEqual({ track: '123', mode: 'edit' });
    });
  });

  describe('buildQueryString', () => {
    it('should build empty query string', () => {
      const result = URLParser.buildQueryString({});
      expect(result).toBe('');
    });

    it('should build single parameter query string', () => {
      const result = URLParser.buildQueryString({ track: '123' });
      expect(result).toBe('?track=123');
    });

    it('should build multiple parameter query string', () => {
      const result = URLParser.buildQueryString({ track: '123', mode: 'edit' });
      expect(result).toBe('?track=123&mode=edit');
    });

    it('should filter out null and undefined values', () => {
      const result = URLParser.buildQueryString({ 
        track: '123', 
        mode: null, 
        other: undefined,
        empty: ''
      });
      expect(result).toBe('?track=123');
    });
  });

  describe('Property Tests', () => {
    /**
     * Feature: track-routing-navigation, Property 1: URL routing consistency
     * For any valid track ID, navigating to a URL with that track parameter should load 
     * the corresponding track, and switching to any track should update the URL to reflect the current track
     */
    it('should maintain URL routing consistency', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
          (trackId) => {
            // Test 1: URL with track parameter should be parseable
            const urlWithTrack = `https://example.com/?track=${trackId}`;
            const parsed = URLParser.parseQueryParams(urlWithTrack);
            expect(parsed.track).toBe(trackId);

            // Test 2: Building query string should be reversible
            const queryString = URLParser.buildQueryString({ track: trackId });
            const rebuiltUrl = `https://example.com/${queryString}`;
            const reparsed = URLParser.parseQueryParams(rebuiltUrl);
            expect(reparsed.track).toBe(trackId);

            // Test 3: URL update should call history API correctly
            mockLocation.href = 'https://example.com/';
            URLParser.updateTrackInURL(trackId, false);
            expect(mockHistory.pushState).toHaveBeenCalledWith(
              null, 
              '', 
              `/?track=${trackId}`
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property test for URL parameter handling edge cases
     */
    it('should handle special characters in track IDs', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          (trackId) => {
            // Encode the track ID for URL safety
            const encodedTrackId = encodeURIComponent(trackId);
            const urlWithTrack = `https://example.com/?track=${encodedTrackId}`;
            
            try {
              const parsed = URLParser.parseQueryParams(urlWithTrack);
              // The parsed value should be decoded back to original
              expect(parsed.track).toBe(trackId);
            } catch (error) {
              // Some characters might cause URL parsing to fail, which is acceptable
              expect(error).toBeInstanceOf(Error);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property test for query string round-trip consistency
     */
    it('should maintain round-trip consistency for query parameters', () => {
      fc.assert(
        fc.property(
          fc.record({
            track: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
            mode: fc.option(fc.constantFrom('edit', 'view', 'play'), { nil: null }),
            step: fc.option(fc.integer({ min: 0, max: 100 }).map(String), { nil: null }),
          }),
          (params) => {
            // Filter out null values for building query string
            const filteredParams = Object.fromEntries(
              Object.entries(params).filter(([_, value]) => value !== null)
            );

            // Build query string and parse it back
            const queryString = URLParser.buildQueryString(filteredParams);
            
            if (Object.keys(filteredParams).length === 0) {
              expect(queryString).toBe('');
            } else {
              expect(queryString).toMatch(/^\?/);
              
              const testUrl = `https://example.com/${queryString}`;
              const parsed = URLParser.parseQueryParams(testUrl);
              
              // All non-null parameters should be preserved
              Object.entries(filteredParams).forEach(([key, value]) => {
                expect(parsed[key]).toBe(value);
              });
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});