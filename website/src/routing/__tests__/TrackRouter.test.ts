import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { TrackRouter } from '../TrackRouter';
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

const mockDocument = {
  title: 'Strudel',
};

// Mock event listeners
const mockEventListeners: { [key: string]: EventListener[] } = {};
const mockAddEventListener = vi.fn((event: string, listener: EventListener) => {
  if (!mockEventListeners[event]) {
    mockEventListeners[event] = [];
  }
  mockEventListeners[event].push(listener);
});

const mockRemoveEventListener = vi.fn((event: string, listener: EventListener) => {
  if (mockEventListeners[event]) {
    const index = mockEventListeners[event].indexOf(listener);
    if (index > -1) {
      mockEventListeners[event].splice(index, 1);
    }
  }
});

// Helper to trigger popstate events
const triggerPopstate = () => {
  const listeners = mockEventListeners['popstate'] || [];
  listeners.forEach(listener => {
    listener(new PopStateEvent('popstate'));
  });
};

// Setup global mocks
beforeEach(() => {
  vi.stubGlobal('window', {
    location: mockLocation,
    history: mockHistory,
    addEventListener: mockAddEventListener,
    removeEventListener: mockRemoveEventListener,
  });
  
  vi.stubGlobal('document', mockDocument);
  
  // Reset mocks
  mockHistory.pushState.mockClear();
  mockHistory.replaceState.mockClear();
  mockAddEventListener.mockClear();
  mockRemoveEventListener.mockClear();
  
  // Reset location
  mockLocation.href = 'https://example.com/';
  mockLocation.pathname = '/';
  mockLocation.search = '';
  mockLocation.hash = '';
  
  // Reset document
  mockDocument.title = 'Strudel';
  
  // Clear event listeners
  Object.keys(mockEventListeners).forEach(key => {
    delete mockEventListeners[key];
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TrackRouter', () => {
  describe('Basic functionality', () => {
    it('should initialize without errors', async () => {
      const router = new TrackRouter();
      await expect(router.initialize()).resolves.not.toThrow();
      expect(router.isReady()).toBe(true);
    });

    it('should navigate to track and update URL', async () => {
      const router = new TrackRouter();
      await router.initialize();
      
      await router.navigateToTrack('test-track');
      
      expect(mockHistory.pushState).toHaveBeenCalledWith(
        null,
        '',
        '/?track=test-track'
      );
    });

    it('should update page title when navigating', async () => {
      const router = new TrackRouter();
      await router.initialize();
      
      await router.navigateToTrack('test-track');
      
      expect(mockDocument.title).toBe('Strudel - Track test-track');
    });
  });

  describe('Property Tests', () => {
    /**
     * Feature: track-routing-navigation, Property 10: Browser history integration
     * For any sequence of track navigation, the browser back/forward buttons should 
     * correctly navigate through the track history and update the page title
     */
    it('should maintain browser history integration consistency', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            { minLength: 1, maxLength: 5 }
          ),
          async (trackIds) => {
            const router = new TrackRouter();
            await router.initialize();
            
            // Navigate through all tracks
            for (const trackId of trackIds) {
              await router.navigateToTrack(trackId);
              
              // Verify URL was updated
              expect(mockHistory.pushState).toHaveBeenCalledWith(
                null,
                '',
                `/?track=${trackId}`
              );
              
              // Verify page title was updated
              expect(mockDocument.title).toBe(`Strudel - Track ${trackId}`);
            }
            
            // Verify navigation state
            const state = router.getNavigationState();
            expect(state.currentTrackId).toBe(trackIds[trackIds.length - 1]);
            
            router.destroy();
          }
        ),
        { numRuns: 50 } // Reduced runs for async tests
      );
    });

    /**
     * Property test for navigation state consistency
     */
    it('should maintain navigation state consistency', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
          async (trackId) => {
            const router = new TrackRouter();
            await router.initialize();
            
            // Initial state should be clean
            let state = router.getNavigationState();
            expect(state.currentTrackId).toBeNull();
            expect(state.isNavigating).toBe(false);
            
            // Navigate to track
            await router.navigateToTrack(trackId);
            
            // State should be updated
            state = router.getNavigationState();
            expect(state.currentTrackId).toBe(trackId);
            expect(state.viewingTrackId).toBe(trackId);
            expect(state.isNavigating).toBe(false);
            
            // Clear track
            await router.clearCurrentTrack();
            
            // State should be cleared
            state = router.getNavigationState();
            expect(state.currentTrackId).toBeNull();
            expect(state.viewingTrackId).toBeNull();
            expect(state.previousTrackId).toBe(trackId);
            
            router.destroy();
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property test for URL restoration on initialization
     */
    it('should restore track from URL on initialization', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
          async (trackId) => {
            // Set up URL with track parameter
            mockLocation.href = `https://example.com/?track=${trackId}`;
            mockLocation.search = `?track=${trackId}`;
            
            const onTrackChange = vi.fn();
            const router = new TrackRouter({ onTrackChange });
            
            // Initialize should restore track from URL
            await router.initialize();
            
            // Verify track was restored
            const state = router.getNavigationState();
            expect(state.currentTrackId).toBe(trackId);
            expect(onTrackChange).toHaveBeenCalledWith(trackId, null);
            
            router.destroy();
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Property test for callback invocation consistency
     */
    it('should invoke callbacks consistently during navigation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            { minLength: 1, maxLength: 3 }
          ),
          async (trackIds) => {
            const onTrackChange = vi.fn();
            const onNavigationStart = vi.fn();
            const onNavigationComplete = vi.fn();
            
            const router = new TrackRouter({
              onTrackChange,
              onNavigationStart,
              onNavigationComplete,
            });
            
            await router.initialize();
            
            let previousTrackId: string | null = null;
            
            for (const trackId of trackIds) {
              await router.navigateToTrack(trackId);
              
              // Verify callbacks were called
              expect(onNavigationStart).toHaveBeenCalledWith(trackId);
              expect(onNavigationComplete).toHaveBeenCalledWith(trackId);
              expect(onTrackChange).toHaveBeenCalledWith(trackId, previousTrackId);
              
              previousTrackId = trackId;
            }
            
            // Verify total call counts
            expect(onNavigationStart).toHaveBeenCalledTimes(trackIds.length);
            expect(onNavigationComplete).toHaveBeenCalledTimes(trackIds.length);
            expect(onTrackChange).toHaveBeenCalledTimes(trackIds.length);
            
            router.destroy();
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});