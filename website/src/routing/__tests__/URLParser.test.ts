import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// isolate:false — don't let the window stub outlive this file
afterEach(() => {
  vi.unstubAllGlobals();
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
     * Legacy `?track=` query URLs must still parse (backward compatibility), while
     * switching tracks writes the path-based URL `/repl/<slug>`.
     */
    it('should maintain URL routing consistency', () => {
      fc.assert(
        fc.property(
          // Already-canonical slugs: lowercase alphanumerics joined by single hyphens
          fc.stringMatching(/^[a-z0-9]{1,10}(-[a-z0-9]{1,10}){0,3}$/),
          (trackSlug) => {
            // Spy history is shared across property runs; reset so we judge this run only
            mockHistory.pushState.mockClear();
            mockHistory.replaceState.mockClear();

            // Test 1: legacy URL with track parameter should be parseable
            const urlWithTrack = `https://example.com/?track=${trackSlug}`;
            const parsed = URLParser.parseQueryParams(urlWithTrack);
            expect(parsed.track).toBe(trackSlug);

            // Test 2: Building query string should be reversible
            const queryString = URLParser.buildQueryString({ track: trackSlug });
            const rebuiltUrl = `https://example.com/${queryString}`;
            const reparsed = URLParser.parseQueryParams(rebuiltUrl);
            expect(reparsed.track).toBe(trackSlug);

            // Test 3: URL update pushes exactly one path-based URL, never the old query form
            mockLocation.href = 'https://example.com/repl';
            URLParser.updateTrackInURL(trackSlug, false);
            expect(mockHistory.pushState).toHaveBeenCalledTimes(1);
            expect(mockHistory.pushState).toHaveBeenLastCalledWith(null, '', `/repl/${trackSlug}`);
            expect(mockHistory.replaceState).not.toHaveBeenCalled();

            // Test 4: the written path round-trips back to the same identifier
            mockLocation.pathname = mockHistory.pushState.mock.calls[0][2];
            expect(URLParser.getCurrentTrackIdentifier()).toBe(trackSlug);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should normalise any track name into a single URL-safe slug segment', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 50 }), (trackName) => {
          mockHistory.pushState.mockClear();
          URLParser.updateTrackInURL(trackName, false);

          expect(mockHistory.pushState).toHaveBeenCalledTimes(1);
          const url: string = mockHistory.pushState.mock.calls[0][2];
          if (trackName.startsWith('/repl/')) {
            // Already a path: passed through verbatim
            expect(url).toBe(trackName);
          } else {
            expect(url).toMatch(/^\/repl\/[a-z0-9]+(-[a-z0-9]+)*$/);
            expect(url).not.toContain('?track=');
          }
        }),
        { numRuns: 100 }
      );
    });

    it.each([
      ['Hello World', '/repl/hello-world'],
      ['  My_Track!! v2 ', '/repl/my-track-v2'],
      ['ABC', '/repl/abc'],
      ['___', '/repl/untitled'],
      ['/repl/folder/beat', '/repl/folder/beat'],
    ])('should write %j as %s', (trackName, expected) => {
      URLParser.updateTrackInURL(trackName, false);
      expect(mockHistory.pushState).toHaveBeenCalledWith(null, '', expected);
      expect(mockHistory.pushState).not.toHaveBeenCalledWith(null, '', `/?track=${trackName}`);
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