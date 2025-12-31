import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { TrackPersistence, type PersistedTrackState } from '../TrackPersistence';

// Mock localStorage
const mockLocalStorage = {
  data: {} as Record<string, string>,
  getItem: vi.fn((key: string) => mockLocalStorage.data[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage.data[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage.data[key];
  }),
  clear: vi.fn(() => {
    mockLocalStorage.data = {};
  }),
};

// Mock window.location and window.history
const mockLocation = {
  href: 'https://example.com/',
  pathname: '/',
  search: '',
  hash: '',
  origin: 'https://example.com',
};

const mockHistory = {
  pushState: vi.fn(),
  replaceState: vi.fn(),
};

const mockDocument = {
  title: 'Strudel',
};

// Setup global mocks
beforeEach(() => {
  // Create a more complete window mock
  const mockWindow = {
    location: mockLocation,
    history: mockHistory,
  };
  
  vi.stubGlobal('localStorage', mockLocalStorage);
  vi.stubGlobal('window', mockWindow);
  vi.stubGlobal('document', mockDocument);
  
  // Reset mocks
  mockLocalStorage.clear();
  mockHistory.pushState.mockClear();
  mockHistory.replaceState.mockClear();
  
  // Reset location
  mockLocation.href = 'https://example.com/';
  mockLocation.pathname = '/';
  mockLocation.search = '';
  mockLocation.hash = '';
  
  // Reset document
  mockDocument.title = 'Strudel';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TrackPersistence', () => {
  describe('Basic functionality', () => {
    it('should restore null when no track in URL', () => {
      const result = TrackPersistence.restoreFromURL();
      expect(result).toBeNull();
    });

    it('should check track existence in localStorage', () => {
      // Setup mock tracks data
      mockLocalStorage.data['strudel_tracks'] = JSON.stringify({
        'track1': { name: 'Track 1', code: 'test' },
        'track2': { name: 'Track 2', code: 'test2' },
      });

      expect(TrackPersistence.trackExists('track1')).toBe(true);
      expect(TrackPersistence.trackExists('track2')).toBe(true);
      expect(TrackPersistence.trackExists('nonexistent')).toBe(false);
    });

    it('should get track data from localStorage', () => {
      // Setup mock tracks data
      const trackData = { name: 'Test Track', code: 'test code' };
      mockLocalStorage.data['strudel_tracks'] = JSON.stringify({
        'test-track': trackData,
      });

      const result = TrackPersistence.getTrackData('test-track');
      expect(result).toEqual(trackData);
      
      const nonExistent = TrackPersistence.getTrackData('nonexistent');
      expect(nonExistent).toBeNull();
    });
  });

  describe('Property Tests', () => {
    /**
     * Feature: track-routing-navigation, Property 3: Invalid track ID handling
     * For any invalid or malformed track ID in the URL, the system should gracefully 
     * handle the error and show an appropriate default state
     */
    it('should handle invalid track IDs gracefully', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          (invalidTrackId) => {
            // Setup some valid tracks in localStorage
            mockLocalStorage.data['strudel_tracks'] = JSON.stringify({
              'valid-track-1': { 
                name: 'Valid Track 1', 
                code: 'test', 
                created: '2023-01-01T00:00:00.000Z',
                modified: '2023-01-01T00:00:00.000Z'
              },
              'valid-track-2': { 
                name: 'Valid Track 2', 
                code: 'test2', 
                created: '2023-01-02T00:00:00.000Z',
                modified: '2023-01-02T00:00:00.000Z'
              },
            });

            const result = TrackPersistence.handleInvalidTrackId(invalidTrackId);
            
            // Result should have a valid action
            expect(['redirect', 'create', 'ignore']).toContain(result.action);
            
            if (result.action === 'redirect') {
              // Should provide a fallback track ID
              expect(result.fallbackTrackId).toBeDefined();
              expect(typeof result.fallbackTrackId).toBe('string');
              expect(result.message).toBeDefined();
            }
            
            if (result.action === 'create') {
              // Should provide a helpful message
              expect(result.message).toBeDefined();
              expect(result.message).toContain(invalidTrackId);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property test for page title updates
     */
    it('should update page title consistently', () => {
      fc.assert(
        fc.property(
          fc.record({
            trackId: fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            trackName: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
          }),
          ({ trackId, trackName }) => {
            // Setup track data in localStorage
            const trackData = trackName ? { name: trackName, code: 'test' } : { code: 'test' };
            mockLocalStorage.data['strudel_tracks'] = JSON.stringify({
              [trackId]: trackData,
            });

            // Update page title
            TrackPersistence.updatePageTitle(trackId);
            
            // Verify title was updated correctly
            if (trackName) {
              expect(mockDocument.title).toBe(`${trackName} - Strudel`);
            } else {
              expect(mockDocument.title).toBe(`Track ${trackId} - Strudel`);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property test for URL length limits
     */
    it('should respect URL length limits', () => {
      fc.assert(
        fc.property(
          fc.record({
            trackId: fc.string({ minLength: 1, maxLength: 2000 }), // Very long track ID
            step: fc.option(fc.integer({ min: 0, max: 999999 })),
            mode: fc.option(fc.constantFrom('edit', 'view', 'play')),
          }),
          (state) => {
            const result = TrackPersistence.persistToURL(state);
            
            // If persistence succeeded, URL should be within limits
            if (result) {
              const currentUrl = `${mockLocation.pathname}${mockLocation.search}${mockLocation.hash}`;
              expect(currentUrl.length).toBeLessThanOrEqual(2000);
            }
            
            // Result should be boolean
            expect(typeof result).toBe('boolean');
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});